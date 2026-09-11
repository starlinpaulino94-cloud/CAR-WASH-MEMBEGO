-- =============================================================================
-- Cuatro funciones de listado estaban rotas EN PRODUCCIÓN desde el día que se
-- escribieron: `orders_page`, `kardex_page`, `qc_history_page` y
-- `cash_sessions_page` creaban una tabla temporal para no repetir el WHERE
-- entre el conteo y la página de filas.
--
-- PostgreSQL no lo permite. Una función `stable` ejecuta sus sentencias por SPI
-- en modo solo-lectura, y ahí `create table as` aborta con «CREATE TABLE AS is
-- not allowed in a non-volatile function». No es un aviso ni un caso raro:
-- falla SIEMPRE, en la primera llamada, y la pantalla queda en «No se pudieron
-- cargar las órdenes».
--
-- La tabla temporal existía para un motivo legítimo —contar y paginar el mismo
-- conjunto sin escribir el filtro dos veces— y un CTE hace exactamente eso en
-- una sola sentencia, sin escribir nada y sin dejar de ser `stable`. La
-- alternativa de marcarlas `volatile` también habría corrido, pero es cambiar
-- la verdad declarada sobre la función para esquivar el mensaje: estas
-- funciones LEEN, y decir lo contrario a PostgreSQL le quita al planificador
-- una garantía real a cambio de nada.
--
-- Se redefinen enteras (`create or replace`) porque el cuerpo cambia; la firma,
-- los permisos y el comentario se conservan idénticos.
-- =============================================================================

-- ── Órdenes ─────────────────────────────────────────────────────────────────
create or replace function public.orders_page(
  p_branch_id  uuid,
  p_from       date default null,
  p_to         date default null,
  p_status     text default null,
  p_washer_id  uuid default null,
  p_service_id uuid default null,
  p_bay_id     uuid default null,
  p_payment    text default null,
  p_search     text default null,
  p_page       integer default 0,
  p_size       integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_tz      text;
  v_total   bigint;
  v_rows    jsonb;
  v_size    integer := least(greatest(coalesce(p_size, 25), 1), 200);
  v_page    integer := greatest(coalesce(p_page, 0), 0);
  v_busca   text := nullif(trim(coalesce(p_search, '')), '');
  -- El estado se convierte a enum AQUÍ, una vez, y no dentro del WHERE.
  --
  -- `p_status` admite dos centinelas que NO son estados: 'all' y 'active'. En
  -- el WHERE el cast vivía en la última rama de un OR, con la idea de que las
  -- ramas anteriores lo evitaran — pero SQL no garantiza cortocircuito: el
  -- planificador puede evaluar la rama del cast igual, y entonces
  -- 'active'::app.order_status revienta con «invalid input value for enum».
  -- Resultado: el filtro «Activas», que es el que trae por defecto la pantalla
  -- de Órdenes, fallaba siempre.
  --
  -- Un CASE de plpgsql sí cortocircuita, así que el cast solo se ejecuta cuando
  -- hay un estado de verdad que convertir; para los centinelas queda null y la
  -- comparación `o.status = v_status` es null —falsa— sin estorbar a las ramas
  -- que sí deciden.
  v_status  app.order_status := case
              when p_status is null or p_status in ('all', 'active') then null
              else p_status::app.order_status end;
  v_payment app.payment_status := case
              when nullif(trim(coalesce(p_payment, '')), '') is null then null
              else p_payment::app.payment_status end;
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and company_id = v_company) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with filtrado as (
    select o.*
      from public.work_orders o
     where o.company_id = v_company and o.branch_id = p_branch_id
       and (p_from is null or p_to is null
            or app.dia_operativo(o.arrival_at, v_tz) between p_from and p_to)
       and (p_status is null or p_status = 'all'
            or (p_status = 'active' and o.status in
                ('pendiente','en_espera','asignada','en_proceso','control_calidad','listo'))
            or o.status = v_status)
       and (p_bay_id is null or o.bay_id = p_bay_id)
       and (v_payment is null or o.payment_status = v_payment)
       and (p_washer_id is null or exists (
             select 1 from public.work_order_assignees a
             where a.work_order_id = o.id and a.profile_id = p_washer_id))
       and (p_service_id is null or exists (
             select 1 from public.work_order_items i
             where i.work_order_id = o.id and i.service_id = p_service_id))
       and (v_busca is null
            or o.order_number ilike '%' || v_busca || '%'
            or o.vehicle_plate ilike '%' || v_busca || '%'
            or o.customer_name ilike '%' || v_busca || '%')
  ),
  pagina as (
    select jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'vehicle_plate', o.vehicle_plate, 'vehicle_make_model', o.vehicle_make_model,
      'customer_name', o.customer_name, 'status', o.status,
      'priority', o.priority, 'payment_status', o.payment_status,
      'total_cents', o.total_cents,
      'arrival_at', o.arrival_at, 'started_at', o.started_at,
      'finished_at', o.finished_at, 'delivered_at', o.delivered_at,
      'estimated_ready_at', o.estimated_ready_at,
      'es_membego', o.membego_customer_id is not null,
      'bay_name', (select name from public.bays where id = o.bay_id),
      'lavadores', (select string_agg(p.full_name, ', ')
                      from public.work_order_assignees a
                      join public.profiles p on p.id = a.profile_id
                     where a.work_order_id = o.id),
      'sin_lavador', not exists (select 1 from public.work_order_assignees a where a.work_order_id = o.id),
      -- Espera: de la llegada al inicio del lavado (o hasta ahora si no ha
      -- empezado y sigue activa). Duración: del inicio a la entrega.
      'espera_seg', case when o.started_at is not null
                         then extract(epoch from (o.started_at - o.arrival_at))::bigint
                         when o.status in ('pendiente','en_espera','asignada')
                         then extract(epoch from (now() - o.arrival_at))::bigint
                         else null end,
      'duracion_seg', case when o.started_at is not null and o.delivered_at is not null
                           then extract(epoch from (o.delivered_at - o.started_at))::bigint
                           when o.started_at is not null and o.finished_at is not null
                           then extract(epoch from (o.finished_at - o.started_at))::bigint
                           else null end,
      -- Banderas operativas. Son condiciones verificables, no corazonadas.
      'atrasada', o.estimated_ready_at is not null
                  and o.status not in ('entregado','cancelado','listo')
                  and now() > o.estimated_ready_at,
      'lista_sin_entregar', o.status = 'listo'
    ) as fila, o.arrival_at
    from filtrado o
    order by o.arrival_at desc
    limit v_size offset v_page * v_size
  )
  select (select count(*) from filtrado),
         (select coalesce(jsonb_agg(fila order by arrival_at desc), '[]'::jsonb) from pagina)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

-- ── Kardex ──────────────────────────────────────────────────────────────────
create or replace function public.kardex_page(
  p_from       date default null,
  p_to         date default null,
  p_product_id uuid default null,
  p_category   text default null,
  p_kind       text default null,
  p_branch_id  uuid default null,
  p_user_id    uuid default null,
  p_search     text default null,
  p_page       integer default 0,
  p_size       integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_tz      text;
  v_total   bigint;
  v_rows    jsonb;
  v_size    integer := least(greatest(coalesce(p_size, 25), 1), 200);
  v_page    integer := greatest(coalesce(p_page, 0), 0);
  v_busca   text := nullif(trim(coalesce(p_search, '')), '');
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with filtrado as (
    select m.id, m.kind, m.qty_change, m.qty_before, m.qty_after, m.reason,
           m.created_at, m.invoice_id, m.work_order_id, m.purchase_id, m.created_by,
           p.name as product_name, p.code as product_code, p.unit as product_unit,
           p.cost_cents
      from public.inventory_movements m
      join public.products p on p.id = m.product_id
     where m.company_id = v_company
       and (p_from is null or p_to is null
            or app.dia_operativo(m.created_at, v_tz) between p_from and p_to)
       and (p_product_id is null or m.product_id = p_product_id)
       and (p_category is null or p.category = p_category)
       and (p_kind is null or m.kind = p_kind::app.inventory_movement_kind)
       and (p_branch_id is null or m.branch_id = p_branch_id)
       and (p_user_id is null or m.created_by = p_user_id)
       and (v_busca is null
            or p.name ilike '%' || v_busca || '%'
            or p.code ilike '%' || v_busca || '%')
  ),
  pagina as (
    select jsonb_build_object(
      'id', k.id, 'kind', k.kind, 'qty_change', k.qty_change,
      'qty_before', k.qty_before, 'qty_after', k.qty_after,
      'reason', k.reason, 'created_at', k.created_at,
      'product_name', k.product_name, 'product_code', k.product_code, 'product_unit', k.product_unit,
      -- Valor del movimiento al costo actual del producto: una estimación, pero
      -- suficiente para dimensionar una merma o una entrada de un vistazo.
      'valor_cents', abs(k.qty_change) * k.cost_cents,
      -- El documento de origen, ya resuelto a algo que se puede leer Y abrir.
      'doc_tipo', case when k.invoice_id is not null then 'factura'
                       when k.purchase_id is not null then 'compra'
                       when k.work_order_id is not null then 'orden' else null end,
      'doc_id', coalesce(k.invoice_id, k.purchase_id, k.work_order_id),
      'doc_ref', coalesce(
        (select invoice_number from public.invoices where id = k.invoice_id),
        (select coalesce(nullif(invoice_ref, ''), 'Compra') from public.purchases where id = k.purchase_id),
        (select order_number from public.work_orders where id = k.work_order_id)),
      'responsable', (select full_name from public.profiles where id = k.created_by)
    ) as fila, k.created_at
    from filtrado k
    order by k.created_at desc
    limit v_size offset v_page * v_size
  )
  select (select count(*) from filtrado),
         (select coalesce(jsonb_agg(fila order by created_at desc), '[]'::jsonb) from pagina)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

-- ── Historial de calidad ────────────────────────────────────────────────────
create or replace function public.qc_history_page(
  p_from      date default null,
  p_to        date default null,
  p_washer_id uuid default null,
  p_result    text default null,
  p_page      integer default 0,
  p_size      integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_tz      text;
  v_total   bigint;
  v_rows    jsonb;
  v_size    integer := least(greatest(coalesce(p_size, 25), 1), 200);
  v_page    integer := greatest(coalesce(p_page, 0), 0);
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el control de calidad.'
      using errcode = 'insufficient_privilege';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with filtrado as (
    select r.id, r.attempt, r.result, r.reject_reason, r.created_at,
           r.washer_id, r.reviewer_id, r.work_order_id,
           o.order_number, o.vehicle_plate
      from public.qc_reviews r
      join public.work_orders o on o.id = r.work_order_id
     where r.company_id = v_company
       and (p_from is null or p_to is null
            or app.dia_operativo(r.created_at, v_tz) between p_from and p_to)
       and (p_washer_id is null or r.washer_id = p_washer_id)
       and (p_result is null or r.result = p_result::app.qc_result)
  ),
  pagina as (
    select jsonb_build_object(
      'id', q.id, 'order_number', q.order_number, 'vehicle_plate', q.vehicle_plate,
      'attempt', q.attempt, 'result', q.result, 'reject_reason', q.reject_reason,
      'created_at', q.created_at,
      'washer', (select full_name from public.profiles where id = q.washer_id),
      'reviewer', (select full_name from public.profiles where id = q.reviewer_id),
      -- La orden ya viene en el filtro, así que los servicios se cuelgan de
      -- ella directamente. Antes se volvía a buscar el `work_order_id` en
      -- `qc_reviews` por el id de la propia fila: una vuelta de más al mismo
      -- dato que ya estaba a mano.
      'servicios', (select string_agg(i.name, ', ')
                      from public.work_order_items i
                     where i.work_order_id = q.work_order_id
                       and i.item_type = 'service')
    ) as fila, q.created_at
    from filtrado q
    order by q.created_at desc
    limit v_size offset v_page * v_size
  )
  select (select count(*) from filtrado),
         (select coalesce(jsonb_agg(fila order by created_at desc), '[]'::jsonb) from pagina)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

-- ── Histórico de cajas ──────────────────────────────────────────────────────
create or replace function public.cash_sessions_page(
  p_branch_id uuid,
  p_from       date default null,
  p_to         date default null,
  p_cashier_id uuid default null,
  p_estado     text default null,
  p_diferencia text default null,
  p_page       integer default 0,
  p_size       integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_tz      text;
  v_total   bigint;
  v_rows    jsonb;
  v_size    integer := least(greatest(coalesce(p_size, 25), 1), 200);
  v_page    integer := greatest(coalesce(p_page, 0), 0);
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el histórico de caja.'
      using errcode = 'insufficient_privilege';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with filtrado as (
    select * from public.cash_sessions
     where company_id = v_company and branch_id = p_branch_id
       and (p_from is null or p_to is null or app.dia_operativo(opened_at, v_tz) between p_from and p_to)
       and (p_cashier_id is null or cashier_id = p_cashier_id)
       and (p_estado is null or status = p_estado::app.cash_session_status)
       and (p_diferencia is null
            or (p_diferencia = 'con' and coalesce(difference_cents, 0) <> 0)
            or (p_diferencia = 'sin' and coalesce(difference_cents, 0) = 0))
  ),
  pagina as (
    select jsonb_build_object(
      'id', c.id, 'status', c.status,
      'opened_at', c.opened_at, 'closed_at', c.closed_at,
      'cashier', (select full_name from public.profiles where id = c.cashier_id),
      'initial_amount_cents', c.initial_amount_cents,
      'expected_cash_cents', c.expected_cash_cents,
      'counted_cash_cents', c.counted_cash_cents,
      'difference_cents', c.difference_cents,
      'ventas_cents', c.total_cash_sales_cents + c.total_card_sales_cents
                      + c.total_transfer_sales_cents + c.total_membego_cents,
      'efectivo_cents', c.total_cash_sales_cents,
      'tarjeta_cents', c.total_card_sales_cents,
      'transferencia_cents', c.total_transfer_sales_cents,
      'membego_cents', c.total_membego_cents,
      'salidas_cents', c.total_outflows_cents
    ) as fila, c.opened_at
    from filtrado c
    order by c.opened_at desc
    limit v_size offset v_page * v_size
  )
  select (select count(*) from filtrado),
         (select coalesce(jsonb_agg(fila order by opened_at desc), '[]'::jsonb) from pagina)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

-- ── El reparto entre lavadores, en centavos enteros ─────────────────────────
-- Ver el comentario dentro de la función. Esta prueba existía desde la Fase 2
-- y venía fallando en silencio porque su archivo abortaba antes de llegar.
create or replace function public.washer_report_orders(
  p_from       date,
  p_to         date,
  p_profile_id uuid,
  p_page       integer default 0,
  p_size       integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_total   bigint;
  v_rows    jsonb;
  v_size    integer := least(greatest(coalesce(p_size, 50), 1), 200);
  v_page    integer := greatest(coalesce(p_page, 0), 0);
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el rendimiento del personal.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total
    from public.work_orders o
    join public.work_order_assignees a on a.work_order_id = o.id
   where o.company_id = v_company and a.profile_id = p_profile_id
     and o.status = 'entregado'
     and o.delivered_at::date between p_from and p_to;

  select coalesce(jsonb_agg(fila order by delivered_at desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'delivered_at', o.delivered_at,
      'vehicle_plate', o.vehicle_plate,
      'vehicle_make_model', o.vehicle_make_model,
      'servicios', (select string_agg(i.name, ', ')
                      from public.work_order_items i
                     where i.work_order_id = o.id and i.item_type = 'service'),
      'servicios_cents', (select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0)
                            from public.work_order_items i
                           where i.work_order_id = o.id and i.item_type = 'service'),
      -- Su parte: lo facturado en servicios repartido entre los asignados.
      -- `sum()` sobre bigint devuelve NUMERIC, y dividirlo dejaba centavos con
      -- decimales: 50000.000000000000, o 3333.333… al repartir entre tres. El
      -- dinero de este sistema son centavos ENTEROS; un céntimo fraccionario no
      -- existe y además hacía que las partes no sumaran el total. Se baja a
      -- bigint ANTES de dividir, así la división es entera.
      'parte_cents', (select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0)::bigint
                        from public.work_order_items i
                       where i.work_order_id = o.id and i.item_type = 'service')
                     / greatest((select count(*) from public.work_order_assignees x where x.work_order_id = o.id), 1)::bigint,
      'comision_cents', (select coalesce(sum(c.amount_cents), 0)
                           from public.commissions c
                          where c.work_order_id = o.id and c.profile_id = p_profile_id),
      'compartida', (select count(*) > 1 from public.work_order_assignees x where x.work_order_id = o.id),
      'otros_lavadores', (select string_agg(pp.full_name, ', ')
                            from public.work_order_assignees x
                            join public.profiles pp on pp.id = x.profile_id
                           where x.work_order_id = o.id and x.profile_id <> p_profile_id),
      'calidad', (select r.result::text from public.qc_reviews r
                   where r.work_order_id = o.id order by r.attempt desc limit 1)
    ) as fila,
    o.delivered_at
    from public.work_orders o
    join public.work_order_assignees a on a.work_order_id = o.id
   where o.company_id = v_company and a.profile_id = p_profile_id
     and o.status = 'entregado'
     and o.delivered_at::date between p_from and p_to
   order by o.delivered_at desc
   limit v_size offset v_page * v_size
  ) t;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

-- ── La constancia de un cambio de pago vuelve a decir el pago ───────────────
create or replace function public.set_employee_pay(
  p_profile_id              uuid,
  p_payroll_type            app.payroll_type,
  p_base_salary_cents       bigint  default 0,
  p_hourly_rate_cents       bigint  default 0,
  p_commission_bps          integer default null,
  p_commission_kind         app.commission_kind default 'porcentaje',
  p_commission_amount_cents bigint  default 0
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_profile public.profiles;
begin
  -- Los guardas del original se conservan TAL CUAL —incluido el rol contador y
  -- las dos validaciones de tipo de pago—: esta función solo AÑADE el tipo de
  -- comisión y su monto. Reescribirla y perder un guarda por el camino sería
  -- abrir un agujero en la ruta del dinero sin que nadie lo note.
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite fijar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_base_salary_cents, 0) < 0 or coalesce(p_hourly_rate_cents, 0) < 0 then
    raise exception 'El importe no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if p_commission_bps is not null and (p_commission_bps < 0 or p_commission_bps > 10000) then
    raise exception 'La comisión debe estar entre 0 y 10000 puntos base.'
      using errcode = 'check_violation';
  end if;
  if p_payroll_type = 'mensual' and coalesce(p_base_salary_cents, 0) = 0 then
    raise exception 'Un sueldo mensual necesita importe.' using errcode = 'check_violation';
  end if;
  if p_payroll_type = 'por_hora' and coalesce(p_hourly_rate_cents, 0) = 0 then
    raise exception 'El pago por hora necesita tarifa.' using errcode = 'check_violation';
  end if;
  -- Lo nuevo: el monto fijo tampoco puede ser negativo, y si se elige pagar por
  -- monto hay que decir cuánto.
  if coalesce(p_commission_amount_cents, 0) < 0 then
    raise exception 'El importe no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if p_commission_kind = 'monto' and coalesce(p_commission_amount_cents, 0) = 0 then
    raise exception 'Una comisión por monto necesita el importe por lavado.'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.payroll_ctx', 'ok', true);
  update public.profiles
     set payroll_type            = p_payroll_type,
         base_salary_cents       = coalesce(p_base_salary_cents, 0),
         hourly_rate_cents       = coalesce(p_hourly_rate_cents, 0),
         commission_bps          = coalesce(p_commission_bps, commission_bps),
         commission_kind         = p_commission_kind,
         commission_amount_cents = coalesce(p_commission_amount_cents, 0)
   where id = p_profile_id and company_id = v_company
  returning * into v_profile;
  perform set_config('app.payroll_ctx', '', true);

  if v_profile.id is null then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- La constancia tiene que decir QUÉ quedó fijado, no solo que alguien tocó
  -- algo. Al reescribir esta función para las comisiones se perdieron el sueldo
  -- base, la tarifa por hora, la sucursal y el `metadata`: quedaba un registro
  -- de «cambio de pago» que no decía el pago. Se restituyen; la comisión, que
  -- es lo que añadió aquella versión, se conserva tal cual.
  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_profile.branch_id, 'FIJAR_PAGO_EMPLEADO', 'Profile', p_profile_id::text,
          format('%s · %s · base %s · hora %s · comisión %s',
                 v_profile.full_name, v_profile.payroll_type,
                 v_profile.base_salary_cents, v_profile.hourly_rate_cents,
                 case when p_commission_kind = 'monto'
                      then 'RD$' || (coalesce(p_commission_amount_cents,0) / 100.0)::text || ' por lavado'
                      else (coalesce(p_commission_bps, 0) / 100.0)::text || ' %' end),
          jsonb_build_object('payroll_type', v_profile.payroll_type,
                             'base_salary_cents', v_profile.base_salary_cents,
                             'hourly_rate_cents', v_profile.hourly_rate_cents,
                             'commission_bps', v_profile.commission_bps));

  return v_profile;
end;
$$;
