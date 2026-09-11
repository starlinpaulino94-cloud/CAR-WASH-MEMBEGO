-- =============================================================================
-- REPORTES GERENCIALES · filtros reales, día operativo local y verdad financiera
-- =============================================================================
-- management_report (0029) resolvió lo básico: ventas, márgenes de insumos y
-- gastos por fecha y sucursal. Pero un dueño no pregunta «cuánto vendí»; pregunta
-- «cuánto vendió Pedro en efectivo del 1 al 15 en Bávaro», y para eso hacían
-- falta filtros que la RPC vieja no tenía. Y preguntaba «cuánto me queda de
-- verdad», y la pantalla le respondía con un número que no descontaba comisiones
-- ni nómina pero se llamaba «utilidad».
--
-- Esta migración añade, sin tocar lo que ya existe:
--
--   · sales_report(from, to, filtros)          — ventas con SIETE filtros combinables
--   · sales_report_invoices(from, to, filtros) — el drill-down: las facturas que
--                                                forman cualquier número de arriba
--   · washer_report(from, to, sucursal, id)    — rendimiento del lavador con
--                                                reprocesos, tiempos y ticket
--   · washer_report_orders(from, to, id)       — drill-down: sus órdenes una a una
--   · profit_report(from, to, sucursal)        — estado de resultados HONESTO:
--                                                comisiones y nómina prorrateada
--                                                incluidas, sin doble conteo
--
-- Y corrige dos cosas de las RPC existentes:
--   · washer_performance y qc_rework_index pasan a exigir rol, como el resto.
--   · el corte de día usa la ZONA HORARIA de la empresa (companies.timezone),
--     no la de la sesión de Postgres (UTC): un lavado de las 10 de la noche
--     cae en su día, no en el siguiente.
--
-- Nada de esto cambia una sola fila: son funciones de solo lectura.
-- =============================================================================

-- ─────────────────────────────────────────── Utilidades compartidas (privadas)

-- El día operativo local de una empresa. Convertir un timestamptz a la zona de
-- la empresa ANTES de sacar la fecha es lo que hace que «hoy» sea hoy para quien
-- cierra a medianoche. Sin esto, todo lo de después de las 20:00 (RD, UTC−4) se
-- contaba en el día siguiente.
create or replace function app.dia_operativo(p_ts timestamptz, p_tz text)
returns date
language sql
immutable
as $$
  select (p_ts at time zone coalesce(nullif(p_tz, ''), 'America/Santo_Domingo'))::date
$$;

comment on function app.dia_operativo is
  'La fecha local de un instante en la zona de la empresa. El corte de día de '
  'todos los reportes pasa por aquí para no depender de la zona de la sesión.';

-- ═══════════════════════════════════════════════════════════ 1 · sales_report
--
-- p_filtros: objeto con claves opcionales. Todo lo que venga null o ausente no
-- filtra. Se resuelven así, y el orden de coste importa:
--   branch_id        — columna directa de invoices
--   cashier_id       — invoices.cashier_id
--   payment_method   — existe un cash_movement de esa factura con ese método
--   service_id       — existe un invoice_item de servicio con ese id
--   service_category — existe un invoice_item de servicio cuyo servicio es de esa categoría
--   washer_id        — la factura viene de una orden que ese lavador trabajó
--   status           — 'vigente' | 'anulada' | 'todas' (default vigente)
create or replace function public.sales_report(
  p_from    date,
  p_to      date,
  p_filtros jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_tz       text;
  v_branch   uuid := nullif(p_filtros ->> 'branch_id', '')::uuid;
  v_cashier  uuid := nullif(p_filtros ->> 'cashier_id', '')::uuid;
  v_washer   uuid := nullif(p_filtros ->> 'washer_id', '')::uuid;
  v_service  uuid := nullif(p_filtros ->> 'service_id', '')::uuid;
  v_scat     text := nullif(p_filtros ->> 'service_category', '');
  v_method   text := nullif(p_filtros ->> 'payment_method', '');
  v_result   jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  select timezone into v_tz from public.companies where id = v_company;

  -- El universo de facturas del reporte, con todos los filtros aplicados UNA vez.
  -- Todo lo demás agrega sobre esta CTE, así que KPIs y tablas comparten el
  -- mismo conjunto por construcción: no puede pasar que la tarjeta diga una cosa
  -- y la tabla otra.
  with universo as (
    select i.*
    from public.invoices i
    where i.company_id = v_company
      and app.dia_operativo(i.created_at, v_tz) between p_from and p_to
      and i.ncf_type is distinct from 'B04'          -- las notas de crédito no son ventas
      -- Las anuladas SÍ entran al universo: el KPI «anulado» las cuenta aparte.
      -- Vender y anular ocurrieron en el periodo; esconder las anuladas del KPI
      -- es justo lo que impide detectar un patrón de anulaciones.
      and (v_branch  is null or i.branch_id  = v_branch)
      and (v_cashier is null or i.cashier_id = v_cashier)
      and (v_method  is null or exists (
            select 1 from public.cash_movements cm
            where cm.invoice_id = i.id and cm.method = v_method::app.payment_method))
      and (v_service is null or exists (
            select 1 from public.invoice_items ii
            where ii.invoice_id = i.id and ii.service_id = v_service))
      and (v_scat is null or exists (
            select 1 from public.invoice_items ii
            join public.services s on s.id = ii.service_id
            where ii.invoice_id = i.id and s.category = v_scat))
      and (v_washer is null or exists (
            select 1 from public.work_order_assignees wa
            where wa.work_order_id = i.work_order_id and wa.profile_id = v_washer))
  ),
  -- Renglones de las facturas del universo. Base única: qty·precio − descuento.
  lineas as (
    select ii.*, u.id as inv_id
    from public.invoice_items ii
    join universo u on u.id = ii.invoice_id
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'filtros', p_filtros,
    'kpis', (
      select jsonb_build_object(
        'ventas_cents',      coalesce(sum(total_cents) filter (where not is_annulled), 0),
        'anulado_cents',     coalesce(sum(total_cents) filter (where is_annulled), 0),
        'facturas',          count(*) filter (where not is_annulled),
        'anuladas',          count(*) filter (where is_annulled),
        'descuento_cents',   coalesce(sum(discount_cents) filter (where not is_annulled), 0),
        'impuesto_cents',    coalesce(sum(tax_cents) filter (where not is_annulled), 0),
        'membego_cents',     coalesce((
            select sum(o.membego_benefit_cents) from public.work_orders o
            where o.id in (select work_order_id from universo where not is_annulled
                           and work_order_id is not null)), 0),
        'ticket_promedio_cents',
          case when count(*) filter (where not is_annulled) = 0 then 0
               else (sum(total_cents) filter (where not is_annulled)
                     / count(*) filter (where not is_annulled))::bigint end,
        'clientes',          count(distinct customer_id) filter (where not is_annulled and customer_id is not null),
        'vehiculos',         count(distinct vehicle_plate) filter (where not is_annulled and vehicle_plate <> '')
      )
      from universo
    ),
    -- Vehículos y servicios se cuentan de los renglones, no de las facturas.
    'servicios_vendidos', coalesce((
      select sum(ii.quantity) from lineas ii
      join universo u on u.id = ii.inv_id
      where ii.item_type = 'service' and not u.is_annulled), 0),
    'por_servicio', coalesce((
      select jsonb_agg(jsonb_build_object('service_id', service_id, 'name', name, 'qty', qty, 'sales_cents', amount) order by amount desc)
      from (
        select ii.service_id, ii.name, sum(ii.quantity) qty,
               sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) amount
        from lineas ii join universo u on u.id = ii.inv_id
        where ii.item_type = 'service' and not u.is_annulled
        group by ii.service_id, ii.name) t), '[]'::jsonb),
    'por_producto', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'qty', qty, 'sales_cents', amount) order by amount desc)
      from (
        select ii.product_id, ii.name, sum(ii.quantity) qty,
               sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) amount
        from lineas ii join universo u on u.id = ii.inv_id
        where ii.item_type = 'product' and not u.is_annulled
        group by ii.product_id, ii.name) t), '[]'::jsonb),
    'por_metodo', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'amount_cents', amount) order by amount desc)
      from (
        select cm.method, sum(cm.amount_cents) amount
        from public.cash_movements cm
        join universo u on u.id = cm.invoice_id
        where cm.type = 'inflow'
        group by cm.method) t), '[]'::jsonb),
    'por_cajero', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', cashier_id, 'name', name, 'invoice_count', n, 'sales_cents', amount) order by amount desc)
      from (
        select u.cashier_id, p.full_name name, count(*) n, sum(u.total_cents) amount
        from universo u join public.profiles p on p.id = u.cashier_id
        where not u.is_annulled
        group by u.cashier_id, p.full_name) t), '[]'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'sales_cents', amount, 'facturas', n) order by dia)
      from (
        select app.dia_operativo(u.created_at, v_tz) dia, sum(u.total_cents) amount, count(*) n
        from universo u where not u.is_annulled
        group by 1) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.sales_report(date, date, jsonb) to authenticated;

comment on function public.sales_report is
  'Ventas del periodo con siete filtros combinables (sucursal, cajero, lavador, '
  'servicio, categoría, método, estado). KPIs y tablas salen del MISMO universo.';

-- ══════════════════════════════════════════════════ 2 · sales_report_invoices
--
-- El drill-down de Ventas: las facturas que forman cualquier número del reporte,
-- con LOS MISMOS filtros y paginadas. Que «Ventas: 120.000» pueda abrirse hasta
-- las facturas que lo componen es el principio de esta fase — un KPI que no se
-- puede desarmar es un KPI en el que no se puede confiar.
create or replace function public.sales_report_invoices(
  p_from    date,
  p_to      date,
  p_filtros jsonb default '{}'::jsonb,
  p_page    integer default 0,
  p_size    integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_tz       text;
  v_branch   uuid := nullif(p_filtros ->> 'branch_id', '')::uuid;
  v_cashier  uuid := nullif(p_filtros ->> 'cashier_id', '')::uuid;
  v_washer   uuid := nullif(p_filtros ->> 'washer_id', '')::uuid;
  v_service  uuid := nullif(p_filtros ->> 'service_id', '')::uuid;
  v_scat     text := nullif(p_filtros ->> 'service_category', '');
  v_method   text := nullif(p_filtros ->> 'payment_method', '');
  v_status   text := coalesce(nullif(p_filtros ->> 'status', ''), 'vigente');
  v_total    bigint;
  v_rows     jsonb;
  v_size     integer := least(greatest(coalesce(p_size, 50), 1), 200);
  v_page     integer := greatest(coalesce(p_page, 0), 0);
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;

  select timezone into v_tz from public.companies where id = v_company;

  -- El mismo universo que sales_report, en una CTE (nada de tabla temporal: la
  -- función es STABLE y crear tablas no lo es). El total se saca con una ventana
  -- para no repetir la consulta.
  with universo as (
    select i.id, i.invoice_number, i.ncf, i.created_at, i.customer_name,
           i.vehicle_plate, i.total_cents, i.is_annulled, i.cashier_id
    from public.invoices i
    where i.company_id = v_company
      and app.dia_operativo(i.created_at, v_tz) between p_from and p_to
      and i.ncf_type is distinct from 'B04'
      and (v_status = 'todas'
           or (v_status = 'vigente'  and not i.is_annulled)
           or (v_status = 'anulada' and i.is_annulled))
      and (v_branch  is null or i.branch_id  = v_branch)
      and (v_cashier is null or i.cashier_id = v_cashier)
      and (v_method  is null or exists (
            select 1 from public.cash_movements cm
            where cm.invoice_id = i.id and cm.method = v_method::app.payment_method))
      and (v_service is null or exists (
            select 1 from public.invoice_items ii
            where ii.invoice_id = i.id and ii.service_id = v_service))
      and (v_scat is null or exists (
            select 1 from public.invoice_items ii
            join public.services s on s.id = ii.service_id
            where ii.invoice_id = i.id and s.category = v_scat))
      and (v_washer is null or exists (
            select 1 from public.work_order_assignees wa
            join public.invoices i2 on i2.id = i.id
            where wa.work_order_id = i2.work_order_id and wa.profile_id = v_washer))
  ),
  contado as (select count(*)::bigint as n from universo),
  pagina as (
    select * from universo order by created_at desc
    limit v_size offset v_page * v_size
  )
  select (select n from contado),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'invoice_number', invoice_number, 'ncf', ncf,
           'created_at', created_at, 'customer_name', customer_name,
           'vehicle_plate', vehicle_plate, 'total_cents', total_cents,
           'is_annulled', is_annulled,
           'cashier_name', (select full_name from public.profiles where id = cashier_id)
         ) order by created_at desc), '[]'::jsonb)
    into v_total, v_rows
    from pagina;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

grant execute on function public.sales_report_invoices(date, date, jsonb, integer, integer) to authenticated;

comment on function public.sales_report_invoices is
  'Drill-down de sales_report: las facturas del universo filtrado, paginadas.';

-- ═══════════════════════════════════════════════ 3 · guardas que faltaban
--
-- washer_performance y qc_rework_index se dejaron sin comprobación de rol: solo
-- las cubría RLS. Pero un lavador (operario) NO debe ver la producción y las
-- comisiones de sus compañeros. Se les pone la misma guarda que a
-- management_report, redefiniéndolas sin cambiar su cálculo.

create or replace function public.washer_performance(
  p_from date,
  p_to   date
)
returns table (
  profile_id           uuid,
  full_name            text,
  lavados              bigint,
  generado_cents       bigint,
  comision_cents       bigint,
  comision_pagada_cents bigint,
  costo_bps            integer,
  meta_lavados         integer,
  meta_generado_cents  bigint
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if app.current_company_id() is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el rendimiento del personal.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  with ordenes as (
    select a.profile_id, o.id as order_id,
           (select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0)
              from public.work_order_items i
             where i.work_order_id = o.id and i.item_type = 'service')
           / greatest(count(*) over (partition by o.id), 1) as parte_cents
      from public.work_orders o
      join public.work_order_assignees a on a.work_order_id = o.id
     where o.company_id = app.current_company_id()
       and o.status = 'entregado'
       and o.delivered_at::date between p_from and p_to
  ),
  produccion as (
    select ordenes.profile_id, count(distinct order_id) as lavados,
           coalesce(sum(parte_cents), 0) as generado_cents
      from ordenes group by ordenes.profile_id
  ),
  pagos as (
    select c.profile_id,
           coalesce(sum(c.amount_cents), 0) as comision_cents,
           coalesce(sum(c.amount_cents) filter (where c.is_paid), 0) as pagada_cents
      from public.commissions c
     where c.company_id = app.current_company_id()
       and c.earned_on between p_from and p_to
     group by c.profile_id
  ),
  metas as (
    select distinct on (g.profile_id)
           g.profile_id, g.target_washes, g.target_revenue_cents
      from public.washer_goals g
     where g.company_id = app.current_company_id()
       and g.period_from <= p_to and g.period_to >= p_from
     order by g.profile_id, (g.period_to - g.period_from) asc
  )
  select p.id, p.full_name,
         coalesce(pr.lavados, 0)::bigint, coalesce(pr.generado_cents, 0)::bigint,
         coalesce(pg.comision_cents, 0)::bigint, coalesce(pg.pagada_cents, 0)::bigint,
         case when coalesce(pr.generado_cents, 0) > 0
              then round(coalesce(pg.comision_cents, 0)::numeric * 10000 / pr.generado_cents)::integer
              else 0 end,
         m.target_washes, m.target_revenue_cents::bigint
    from public.profiles p
    left join produccion pr on pr.profile_id = p.id
    left join pagos      pg on pg.profile_id = p.id
    left join metas      m  on m.profile_id  = p.id
   where p.company_id = app.current_company_id()
     and p.role in ('operario', 'supervisor')
     and (p.is_active or pr.lavados is not null)
   order by coalesce(pr.generado_cents, 0) desc, p.full_name;
end;
$$;

grant execute on function public.washer_performance(date, date) to authenticated;

-- qc_rework_index gana la misma guarda de rol.
create or replace function public.qc_rework_index(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  if app.current_company_id() is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el control de calidad.'
      using errcode = 'insufficient_privilege';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', washer_id, 'name', coalesce(full_name, '—'),
    'reviews', reviews, 'rejected', rejected,
    'rework_pct', case when reviews = 0 then 0 else round(rejected * 100.0 / reviews)::int end
  ) order by rejected desc), '[]'::jsonb)
  into v_out
  from (
    select r.washer_id, p.full_name, count(*) as reviews,
           count(*) filter (where r.result = 'rechazado') as rejected
    from public.qc_reviews r
    left join public.profiles p on p.id = r.washer_id
    where r.company_id = app.current_company_id()
      and r.created_at >= p_from and r.created_at < p_to + 1
      and r.washer_id is not null
    group by r.washer_id, p.full_name) t;
  return v_out;
end;
$$;

grant execute on function public.qc_rework_index(date, date) to authenticated;

-- ═══════════════════════════════════════════════════════════ 4 · washer_report
--
-- El diferenciador del sistema. Reutiliza washer_performance para lo que ya
-- calcula bien (lavados, generado, comisión, metas) y le añade lo que un dueño
-- pide de un lavador y hoy no existe en ningún sitio junto: reprocesos y su
-- porcentaje, aprobación a la primera, tiempo promedio por vehículo y comisión
-- pendiente. Filtra por sucursal y, opcionalmente, por un lavador concreto.
create or replace function public.washer_report(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null,
  p_profile_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_out     jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el rendimiento del personal.'
      using errcode = 'insufficient_privilege';
  end if;

  with base as (
    -- washer_performance ya trae lavados, generado, comisión y metas. No se
    -- reescribe: se reutiliza y se le cuelga lo demás.
    select * from public.washer_performance(p_from, p_to)
  ),
  -- Reprocesos y revisiones por lavador, del control de calidad.
  calidad as (
    select r.washer_id,
           count(*) as revisiones,
           count(*) filter (where r.result = 'rechazado') as reprocesos,
           count(*) filter (where r.result = 'aprobado' and r.attempt = 1) as aprob_primera
      from public.qc_reviews r
     where r.company_id = v_company
       and r.washer_id is not null
       and app.dia_operativo(r.created_at,
             (select timezone from public.companies where id = v_company)) between p_from and p_to
     group by r.washer_id
  ),
  -- Tiempo de ciclo (inicio→entrega) de las órdenes que trabajó, y sucursal.
  tiempos as (
    select a.profile_id,
           avg(extract(epoch from (o.delivered_at - o.started_at)))
             filter (where o.started_at is not null and o.delivered_at is not null) as seg_promedio,
           count(distinct o.id) filter (where p_branch_id is null or o.branch_id = p_branch_id) as lavados_sucursal
      from public.work_orders o
      join public.work_order_assignees a on a.work_order_id = o.id
     where o.company_id = v_company
       and o.status = 'entregado'
       and o.delivered_at::date between p_from and p_to
     group by a.profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', b.profile_id,
    'full_name', b.full_name,
    'lavados', b.lavados,
    'generado_cents', b.generado_cents,
    'ticket_promedio_cents',
      case when b.lavados > 0 then (b.generado_cents / b.lavados)::bigint else 0 end,
    'comision_cents', b.comision_cents,
    'comision_pagada_cents', b.comision_pagada_cents,
    'comision_pendiente_cents', b.comision_cents - b.comision_pagada_cents,
    'costo_bps', b.costo_bps,
    'meta_lavados', b.meta_lavados,
    'meta_generado_cents', b.meta_generado_cents,
    'cumplimiento_lavados_pct',
      case when coalesce(b.meta_lavados, 0) > 0
           then round(b.lavados * 100.0 / b.meta_lavados)::int else null end,
    'cumplimiento_generado_pct',
      case when coalesce(b.meta_generado_cents, 0) > 0
           then round(b.generado_cents * 100.0 / b.meta_generado_cents)::int else null end,
    'revisiones', coalesce(c.revisiones, 0),
    'reprocesos', coalesce(c.reprocesos, 0),
    'reproceso_pct',
      case when coalesce(c.revisiones, 0) > 0
           then round(c.reprocesos * 100.0 / c.revisiones)::int else null end,
    'aprobacion_primera_pct',
      case when coalesce(c.revisiones, 0) > 0
           then round(c.aprob_primera * 100.0 / c.revisiones)::int else null end,
    'segundos_promedio', round(coalesce(t.seg_promedio, 0))::bigint,
    'productividad_dia',
      case when (p_to - p_from + 1) > 0
           then round(b.lavados::numeric / (p_to - p_from + 1), 1) else 0 end
  ) order by b.generado_cents desc), '[]'::jsonb)
  into v_out
  from base b
  left join calidad c on c.washer_id = b.profile_id
  left join tiempos t on t.profile_id = b.profile_id
  where p_profile_id is null or b.profile_id = p_profile_id;

  return jsonb_build_object('from', p_from, 'to', p_to, 'lavadores', v_out);
end;
$$;

grant execute on function public.washer_report(date, date, uuid, uuid) to authenticated;

comment on function public.washer_report is
  'Rendimiento del lavador: reutiliza washer_performance y añade reprocesos, '
  'aprobación a la primera, tiempo de ciclo, ticket y comisión pendiente.';

-- ═══════════════════════════════════════════ 5 · washer_report_orders (drill)
--
-- Al elegir un lavador, sus órdenes una a una: qué carro, cuándo, qué servicio,
-- cuánto le tocó, su comisión, con quién lo compartió y cómo salió en calidad.
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
      'parte_cents', (select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0)
                        from public.work_order_items i
                       where i.work_order_id = o.id and i.item_type = 'service')
                     / greatest((select count(*) from public.work_order_assignees x where x.work_order_id = o.id), 1),
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

grant execute on function public.washer_report_orders(date, date, uuid, integer, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════ 6 · profit_report
--
-- El estado de resultados que la pantalla vieja fingía tener. En cascada, con
-- cada línea nombrando lo que descuenta, y con DOS cuidados que evitan mentir:
--
--   1. El consumo de insumos se cruza por work_orders para respetar la
--      sucursal (service_consumptions no guarda sucursal). management_report no
--      lo hacía y por eso su utilidad por sucursal salía mal.
--   2. Las comisiones se descuentan UNA sola vez. Están en la línea «comisiones
--      directas» (de la tabla commissions) y TAMBIÉN dentro de la nómina
--      (payroll_items.commissions_cents). Si se restara la nómina completa, se
--      contarían dobles. La línea de nómina resta el bruto MENOS su parte de
--      comisiones, prorrateado por los días que el periodo de nómina solapa con
--      el rango consultado.
--
-- Sigue diciendo «estimado»: no es contabilidad financiera completa. Pero ya no
-- llama utilidad a algo que no descuenta la mano de obra.
create or replace function public.profit_report(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company     uuid := app.current_company_id();
  v_tz          text;
  v_ventas      bigint;   -- subtotal (antes de descuento e impuesto)
  v_descuentos  bigint;
  v_notas       bigint;   -- notas de crédito emitidas en el periodo
  v_ingreso_neto bigint;
  v_insumos     bigint;
  v_comisiones  bigint;
  v_margen_contrib bigint;
  v_gastos      bigint;
  v_nomina      bigint;
  v_resultado   bigint;
  v_margen      jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  select timezone into v_tz from public.companies where id = v_company;

  -- Ventas vigentes (subtotal y descuentos), excluyendo notas de crédito.
  select coalesce(sum(subtotal_cents), 0), coalesce(sum(discount_cents), 0)
    into v_ventas, v_descuentos
    from public.invoices
   where company_id = v_company
     and not is_annulled
     and ncf_type is distinct from 'B04'
     and app.dia_operativo(created_at, v_tz) between p_from and p_to
     and (p_branch_id is null or branch_id = p_branch_id);

  -- Notas de crédito del periodo (valor absoluto restado del ingreso).
  select coalesce(sum(total_cents), 0) into v_notas
    from public.invoices
   where company_id = v_company
     and ncf_type = 'B04'
     and app.dia_operativo(created_at, v_tz) between p_from and p_to
     and (p_branch_id is null or branch_id = p_branch_id);

  v_ingreso_neto := v_ventas - v_descuentos - v_notas;

  -- Insumos consumidos, cruzando por la orden para respetar la sucursal.
  select coalesce(sum(sc.cost_cents), 0) into v_insumos
    from public.service_consumptions sc
    join public.work_orders o on o.id = sc.work_order_id
   where sc.company_id = v_company
     and app.dia_operativo(sc.created_at, v_tz) between p_from and p_to
     and (p_branch_id is null or o.branch_id = p_branch_id);

  -- Comisiones directas devengadas en el periodo.
  select coalesce(sum(amount_cents), 0) into v_comisiones
    from public.commissions
   where company_id = v_company
     and earned_on between p_from and p_to
     and (p_branch_id is null or branch_id = p_branch_id);

  v_margen_contrib := v_ingreso_neto - v_insumos - v_comisiones;

  -- Gastos operativos registrados.
  select coalesce(sum(amount_cents), 0) into v_gastos
    from public.expenses
   where company_id = v_company
     and expense_date between p_from and p_to
     and (p_branch_id is null or branch_id = p_branch_id);

  -- Nómina atribuible: por cada periodo de nómina aprobado o pagado que solape
  -- el rango, se toma el bruto MENOS sus comisiones (ya contadas arriba) y se
  -- prorratea por los días de solape. Sumar la nómina completa contaría las
  -- comisiones dos veces.
  select coalesce(sum(
           (pp.gross_cents - coalesce(pc.comisiones, 0))
           * (least(pp.period_to, p_to) - greatest(pp.period_from, p_from) + 1)
           / greatest(pp.period_to - pp.period_from + 1, 1)
         ), 0)
    into v_nomina
    from public.payroll_periods pp
    left join (
      select period_id, sum(commissions_cents) as comisiones
        from public.payroll_items group by period_id
    ) pc on pc.period_id = pp.id
   where pp.company_id = v_company
     and pp.status in ('aprobada', 'pagada')
     and pp.period_from <= p_to and pp.period_to >= p_from
     and (p_branch_id is null or pp.branch_id = p_branch_id or pp.branch_id is null);

  v_resultado := v_margen_contrib - v_gastos - v_nomina;

  -- Margen por servicio (ventas, cantidad, insumos, comisiones, margen).
  select coalesce(jsonb_agg(jsonb_build_object(
           'service_id', service_id, 'name', name,
           'sales_cents', sales_cents, 'qty', qty,
           'consumption_cents', consumo, 'commission_cents', comision,
           'margin_cents', sales_cents - consumo - comision,
           'margin_pct', case when sales_cents > 0
                              then round((sales_cents - consumo - comision) * 100.0 / sales_cents)::int
                              else null end
         ) order by (sales_cents - consumo - comision) desc), '[]'::jsonb)
    into v_margen
  from (
    select ii.service_id, ii.name,
           sum(ii.quantity * ii.unit_price_cents - ii.discount_cents)::bigint as sales_cents,
           sum(ii.quantity)::bigint as qty,
           coalesce((select sum(sc.cost_cents) from public.service_consumptions sc
                      join public.work_orders o2 on o2.id = sc.work_order_id
                     where sc.service_id = ii.service_id and sc.company_id = v_company
                       and app.dia_operativo(sc.created_at, v_tz) between p_from and p_to
                       and (p_branch_id is null or o2.branch_id = p_branch_id)), 0)::bigint as consumo,
           coalesce((select sum(c.amount_cents) from public.commissions c
                      where c.service_name = ii.name and c.company_id = v_company
                        and c.earned_on between p_from and p_to
                        and (p_branch_id is null or c.branch_id = p_branch_id)), 0)::bigint as comision
      from public.invoice_items ii
      join public.invoices i on i.id = ii.invoice_id
     where i.company_id = v_company and not i.is_annulled
       and i.ncf_type is distinct from 'B04'
       and app.dia_operativo(i.created_at, v_tz) between p_from and p_to
       and (p_branch_id is null or i.branch_id = p_branch_id)
       and ii.item_type = 'service'
     group by ii.service_id, ii.name
  ) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'branch_id', p_branch_id,
    'ventas_cents', v_ventas,
    'descuentos_cents', v_descuentos,
    'notas_credito_cents', v_notas,
    'ingreso_neto_cents', v_ingreso_neto,
    'insumos_cents', v_insumos,
    'comisiones_cents', v_comisiones,
    'margen_contribucion_cents', v_margen_contrib,
    'gastos_cents', v_gastos,
    'nomina_cents', v_nomina,
    'resultado_operativo_cents', v_resultado,
    'margen_por_servicio', v_margen
  );
end;
$$;

grant execute on function public.profit_report(date, date, uuid) to authenticated;

comment on function public.profit_report is
  'Estado de resultados estimado en cascada. Insumos por sucursal; comisiones '
  'una sola vez (la nómina entra sin su parte de comisiones). No es utilidad '
  'neta contable y por eso el resultado se rotula estimado.';
