-- =============================================================================
-- BORRAR UNA ORDEN DE TRABAJO (SOLO SUPERADMIN)
--
-- Hasta aquí una orden solo se podía cancelar, nunca borrar. Cancelar es lo
-- correcto casi siempre: deja el rastro de que ese vehículo entró. Pero una
-- orden abierta por error —la placa del coche de al lado, un doble clic, una
-- prueba— no es historia que valga la pena guardar, y ensucia el contador de
-- pendientes para siempre.
--
-- POR QUÉ ESTO NO PUEDE SER UN `DELETE` SUELTO DESDE LA PANTALLA
--
-- Once tablas apuntan a `work_orders`, y no todas se comportan igual al borrar:
--
--   CASCADE   work_order_items, work_order_assignees, qc_reviews,
--             vehicle_inspections, service_consumptions, commissions
--   SET NULL  invoices, inventory_movements, appointments, claims, bays
--
-- Dos de ellas son dinero. `commissions` se borra en cascada: borrar la orden le
-- quita al lavador su comisión sin decírselo a nadie. `invoices` se queda a
-- null: la factura sobrevive, pero pierde para siempre de qué lavado salió, y
-- con ella el cuadre entre lo facturado y lo trabajado.
--
-- Por eso el borrado va por función, con tres negativas antes de tocar nada:
-- factura viva, comisión ya pagada y consumo de inventario. Cada una explica
-- qué hacer en vez de fallar con un error de clave foránea que no dice nada.
-- =============================================================================

-- Los privilegios por defecto del esquema conceden select/insert/update, no
-- delete. Igual que con `membego_plan_coberturas`, hay que darlo a mano; si no,
-- la función falla con «permission denied for table», que no es la RLS diciendo
-- que no sino la falta del permiso base.
grant delete on public.work_orders to authenticated;

create or replace function public.delete_work_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid := app.current_company_id();
  v_order     public.work_orders%rowtype;
  v_factura   text;
  v_comision  bigint;
  v_consumo   bigint;
begin
  -- `security definer`, así que el rol se comprueba AQUÍ y a mano: la función
  -- salta la RLS, y sin esta línea cualquiera con sesión podría borrar.
  if not app.has_role('superadmin') then
    raise exception 'Solo un superadministrador puede borrar órdenes.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;

  -- El `company_id` va en el WHERE aunque la función sea definer: el superadmin
  -- lo es de SU empresa, no de la base entera.
  select * into v_order
    from public.work_orders
   where id = p_order_id and company_id = v_company;

  if not found then
    raise exception 'La orden no existe o no es de su empresa.'
      using errcode = 'no_data_found';
  end if;

  -- ---------------------------------------------------------------- Factura
  -- Anulada sí: entonces la factura ya no vale y el enlace no se pierde, se
  -- suelta. Viva no: el comprobante quedaría sin decir de qué lavado salió.
  select string_agg(invoice_number, ', ' order by invoice_number)
    into v_factura
    from public.invoices
   where work_order_id = p_order_id and company_id = v_company
     and annulled_at is null;

  if v_factura is not null then
    raise exception
      'La orden % está facturada (%). Anule la factura antes de borrar la orden.',
      v_order.order_number, v_factura
      using errcode = 'restrict_violation';
  end if;

  -- -------------------------------------------------------------- Comisión
  -- `commissions` se borra en cascada. Si ya se le pagó al lavador, borrar la
  -- orden dejaría la nómina cuadrando contra una comisión que ya no existe.
  select count(*) into v_comision
    from public.commissions
   where work_order_id = p_order_id and company_id = v_company and is_paid;

  if v_comision > 0 then
    raise exception
      'La orden % tiene % comisión(es) ya pagadas. No se puede borrar: cancélela.',
      v_order.order_number, v_comision
      using errcode = 'restrict_violation';
  end if;

  -- ------------------------------------------------------------- Inventario
  -- Si ya salió producto del almacén por esta orden, el movimiento se quedaría
  -- sin origen y el kardex no cuadraría contra nada.
  select count(*) into v_consumo
    from public.inventory_movements
   where work_order_id = p_order_id and company_id = v_company;

  if v_consumo > 0 then
    raise exception
      'La orden % ya consumió inventario (% movimiento(s)). No se puede borrar: cancélela.',
      v_order.order_number, v_consumo
      using errcode = 'restrict_violation';
  end if;

  -- El rastro se escribe ANTES del borrado, con todo lo que se va a perder:
  -- después, la fila ya no está para contarlo. Un borrado sin rastro es un
  -- agujero, no una función.
  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, v_order.branch_id, 'BORRAR_ORDEN', 'WorkOrder', p_order_id::text,
    'Orden ' || v_order.order_number
      || coalesce(' · placa ' || v_order.vehicle_plate, '')
      || coalesce(' · ' || v_order.customer_name, '')
      || ' · estado ' || v_order.status
      || ' · ' || v_order.total_cents || ' centavos',
    jsonb_build_object(
      'order_number',  v_order.order_number,
      'vehicle_plate', v_order.vehicle_plate,
      'customer_id',   v_order.customer_id,
      'customer_name', v_order.customer_name,
      'status',        v_order.status,
      'payment_status',v_order.payment_status,
      'total_cents',   v_order.total_cents,
      'arrival_at',    v_order.arrival_at
    )
  );

  delete from public.work_orders
   where id = p_order_id and company_id = v_company;

  if not found then
    raise exception 'No se pudo borrar la orden %.', v_order.order_number
      using errcode = 'internal_error';
  end if;
end;
$$;

revoke all on function public.delete_work_order(uuid) from public, anon;
grant execute on function public.delete_work_order(uuid) to authenticated;

comment on function public.delete_work_order is
  'Borra una orden de trabajo. Solo superadmin, solo de su propia empresa, y '
  'solo si no tiene factura viva, comisión pagada ni consumo de inventario. '
  'Deja constancia en audit_logs de todo lo que se borra.';
