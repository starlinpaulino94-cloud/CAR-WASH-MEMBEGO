-- ============================================================================
-- 0042 · EDITAR UNA ORDEN DE TRABAJO
--
-- Cancelar una orden ya se podía (0041); corregirla, no. Una recepción que
-- eligió el servicio equivocado, apuntó la categoría de más o escribió mal el
-- nombre del cliente tenía una sola salida: cancelar y volver a registrar, lo
-- que rompe el número de orden, borra el histórico de esa llegada y —si ya
-- había bahía y operarios— los pierde.
--
-- Esto añade la corrección en sitio: cambiar servicios, cantidades, categoría,
-- datos del vehículo, cliente, prioridad y observaciones de una orden que
-- todavía está en el taller, recalculando el importe en el servidor y dejando
-- constancia de lo que cambió.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LAS GUARDAS, Y POR QUÉ CADA UNA
--
--   1. EL ROL. Editar una orden mueve dinero: cambia el total que se va a
--      cobrar. Mismos roles que cancelarla y que anular una factura
--      —propietario, administrador, supervisor, superadmin—, no el mostrador.
--
--   2. NO SE EDITA UNA ORDEN ENTREGADA NI CANCELADA. Son estados terminales:
--      el trabajo se cerró o se deshizo. Cambiar sus renglones reescribiría la
--      historia de algo que ya pasó, y en el caso de `entregado` descuadraría
--      las comisiones que se repartieron sobre los importes de entonces.
--
--   3. NO SE EDITA UNA ORDEN YA FACTURADA. La factura es inmutable por diseño
--      fiscal (NCF/DGII); si la orden que la respalda cambia de importe, la
--      factura pasa a mentir. La misma guarda que cancelar: primero se anula la
--      factura —que emite su nota de crédito— y después se corrige la orden.
--
-- ────────────────────────────────────────────────────────────────────────────
-- EL PRECIO LO PONE EL SERVIDOR, SIEMPRE
--
-- Igual que en `create_work_order`: el navegador manda qué servicios y cuántos,
-- nunca a qué precio. El importe de cada línea se resuelve con
-- `app.resolve_item_price` sobre la categoría (posiblemente nueva) de la orden,
-- y el trigger de las líneas recalcula subtotal, ITBIS y total. Un cliente
-- manipulado no puede rebajarse el lavado.
--
-- ────────────────────────────────────────────────────────────────────────────
-- REEMPLAZO SOLO DE SERVICIOS
--
-- El editor sustituye el conjunto de líneas de SERVICIO. Los renglones de
-- producto o paquete, si algún día los hubiera en una orden, no se tocan: no se
-- muestran en este editor, así que borrarlos sería destruir lo que no se ve.
-- Hoy las órdenes nacen solo con servicios (arrival), de modo que en la
-- práctica se reemplaza todo; la salvaguarda es para no romper el día que deje
-- de ser cierto.
-- ============================================================================

create or replace function public.edit_work_order(
  p_order_id         uuid,
  p_items            jsonb,
  p_customer_name    text                default null,
  p_customer_phone   text                default null,
  p_vehicle_make     text                default null,
  p_vehicle_model    text                default null,
  p_vehicle_color    text                default null,
  p_vehicle_category app.vehicle_category default null,
  p_priority         text                default null,
  p_notes            text                default null
)
returns public.work_orders
language plpgsql
-- DEFINER, no INVOKER: reemplazar las líneas exige BORRAR las de servicio, y el
-- rol `authenticated` no tiene DELETE sobre work_order_items (solo insert/update,
-- como necesita create_work_order). En vez de abrir un DELETE genérico —que
-- dejaría a cualquiera borrar renglones de su empresa saltándose el rol—, esta
-- función corre como propietaria y hace ella misma las comprobaciones que
-- reemplazan a RLS: la empresa sale del JWT (`app.current_company_id`), el rol
-- se exige explícitamente, y todo se acota por company_id. El mismo patrón que
-- `app.recalc_work_order_totals`.
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid := app.current_company_id();
  v_order     public.work_orders;
  v_facturas  integer;
  v_category  app.vehicle_category;
  v_item      record;
  v_price     bigint;
  v_result    public.work_orders;
  v_rows      integer;
  v_before    jsonb;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- 1 · El rol. Mover el importe de una orden es una operación de gestión, no
  -- de mostrador. Misma lista que cancelar (0041) y anular facturas.
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite editar órdenes de trabajo'
      using errcode = 'insufficient_privilege';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden necesita al menos un servicio'
      using errcode = 'invalid_parameter_value';
  end if;

  -- FOR UPDATE: dos supervisores editando la misma tarjeta a la vez.
  select * into v_order from public.work_orders
   where id = p_order_id and company_id = v_company
   for update;

  if v_order.id is null then
    raise exception 'Orden inexistente o fuera de su alcance' using errcode = 'no_data_found';
  end if;

  -- 2 · Estados terminales fuera.
  if v_order.status = 'entregado' then
    raise exception 'La orden % ya se entregó: no se puede editar', v_order.order_number
      using errcode = 'check_violation';
  end if;
  if v_order.status = 'cancelado' then
    raise exception 'La orden % está cancelada: no se puede editar', v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- 3 · Si ya hay factura viva, primero se anula esa factura.
  select count(*) into v_facturas from public.invoices
   where work_order_id = p_order_id and company_id = v_company and not is_annulled;
  if v_facturas > 0 then
    raise exception
      'La orden % ya está facturada. Anule primero la factura —se emite su nota de crédito— y después edítela.',
      v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- Instantánea del antes, para la bitácora.
  v_before := jsonb_build_object(
    'total_cents',      v_order.total_cents,
    'vehicle_category', v_order.vehicle_category,
    'lineas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'quantity', quantity, 'unit_price_cents', unit_price_cents)), '[]'::jsonb)
      from public.work_order_items
      where work_order_id = p_order_id and item_type = 'service'
    )
  );

  v_category := coalesce(p_vehicle_category, v_order.vehicle_category);

  -- ------------------------------------------------------- Datos de cabecera
  -- Solo se pisa lo que llega con valor; un parámetro en NULL se deja como
  -- estaba. `customer_name` nunca queda vacío: si lo mandan en blanco, se
  -- respeta lo que había.
  update public.work_orders
     set customer_name    = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customer_name),
         customer_phone   = coalesce(p_customer_phone, customer_phone),
         vehicle_make_model = case
                                when p_vehicle_make is not null or p_vehicle_model is not null
                                then trim(coalesce(p_vehicle_make, '') || ' ' || coalesce(p_vehicle_model, ''))
                                else vehicle_make_model
                              end,
         vehicle_color    = coalesce(p_vehicle_color, vehicle_color),
         vehicle_category = v_category,
         priority         = coalesce(nullif(trim(coalesce(p_priority, '')), ''), priority),
         notes            = case when p_notes is not null then nullif(trim(p_notes), '') else notes end
   where id = p_order_id and company_id = v_company;

  get diagnostics v_rows = row_count;
  -- Defensa por si acaso: ya bloqueamos la fila por (id, company_id) más arriba,
  -- así que esto debería tocar siempre 1. Si tocara 0, algo cambió bajo los pies
  -- y es mejor abortar que seguir a ciegas.
  if v_rows = 0 then
    raise exception 'No se pudo modificar la orden'
      using errcode = 'no_data_found';
  end if;

  -- --------------------------------------------------------- Líneas: reemplazo
  -- Solo las de servicio. Producto y paquete —que hoy no existen en una orden—
  -- se conservan: no se muestran aquí, borrarlas sería destruir lo que no se ve.
  delete from public.work_order_items
   where work_order_id = p_order_id and item_type = 'service';

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      service_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida en "%"', v_item.name using errcode = 'invalid_parameter_value';
    end if;
    if v_item.service_id is null then
      raise exception 'Falta el servicio en una de las líneas' using errcode = 'invalid_parameter_value';
    end if;

    v_price := app.resolve_item_price('service', v_item.service_id, null, v_category);

    insert into public.work_order_items (
      work_order_id, item_type, service_id, name, quantity,
      unit_price_cents, discount_cents, is_membego_covered
    ) values (
      p_order_id, 'service', v_item.service_id, v_item.name, v_item.quantity,
      v_price,
      case when coalesce(v_item.is_membego_covered, false) then 0 else coalesce(v_item.discount_cents, 0) end,
      coalesce(v_item.is_membego_covered, false)
    );
  end loop;

  -- El trigger de las líneas ya recalculó los totales.
  select * into v_result from public.work_orders where id = p_order_id;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_order.branch_id, 'EDITAR_ORDEN', 'WorkOrder', p_order_id::text,
          'Orden ' || v_order.order_number || ' editada · total ' ||
          v_order.total_cents || ' → ' || v_result.total_cents || ' centavos',
          jsonb_build_object(
            'antes', v_before,
            'despues', jsonb_build_object(
              'total_cents',      v_result.total_cents,
              'vehicle_category', v_result.vehicle_category
            )));

  return v_result;
end;
$$;

revoke all on function public.edit_work_order(
  uuid, jsonb, text, text, text, text, text, app.vehicle_category, text, text) from public;
grant execute on function public.edit_work_order(
  uuid, jsonb, text, text, text, text, text, app.vehicle_category, text, text) to authenticated;

comment on function public.edit_work_order is
  'Corrige una orden en el taller: servicios, categoría, datos del vehículo, cliente, prioridad y notas. '
  'El precio lo pone el servidor. Rechaza órdenes entregadas, canceladas o facturadas. Todo queda en la bitácora.';
