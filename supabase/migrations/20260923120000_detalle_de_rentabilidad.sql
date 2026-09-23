-- =============================================================================
-- EL DETALLE DETRÁS DE CADA MARGEN
--
-- El estado de resultados impreso decía «Lavado Completo · ventas 10,000 ·
-- insumos 1,200 · comisión 1,000 · margen 7,800» y ahí se acababa. Cuando un
-- servicio sale en rojo —y la pantalla ya avisa de cuántos— el papel no da nada
-- con qué averiguar por qué.
--
-- TRES ORÍGENES, NO UNA TABLA
--
-- El margen de un servicio se arma de tres sitios distintos, y esta función
-- devuelve los tres por separado porque ASÍ ES COMO SE CALCULA:
--
--   · ventas      → renglones de factura (item_type = 'service')
--   · insumos     → service_consumptions, cruzando por la orden para la sucursal
--   · comisiones  → commissions, casadas por NOMBRE del servicio
--
-- POR QUÉ NO SE PONEN EN LA MISMA FILA
--
-- Sería más bonito enseñar cada venta con su insumo y su comisión al lado, pero
-- sería FALSO. `profit_report` no atribuye insumos ni comisiones a un renglón
-- de factura concreto: los suma por servicio en todo el periodo —la comisión
-- casando por nombre, ni siquiera por id—. Meterlos en la misma fila inventaría
-- una precisión que el cálculo no tiene, y alguien acabaría tomando una
-- decisión sobre un número que nadie calculó así.
--
-- Van, por tanto, en tres listas bajo cada servicio. Cada una suma su columna
-- del resumen; las tres juntas explican el margen. Es menos vistoso y es lo que
-- de verdad ocurre.
--
-- El tope funciona como en `sales_report_lines`: se corta y se DICE.
-- =============================================================================

create or replace function public.profit_report_lines(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null,
  p_limit     integer default 1500
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
  v_limit   integer := least(greatest(coalesce(p_limit, 1500), 1), 5000);
  v_ventas     jsonb;
  v_insumos    jsonb;
  v_comisiones jsonb;
  v_n_ventas     bigint;
  v_n_insumos    bigint;
  v_n_comisiones bigint;
begin
  -- Mismo portero que `profit_report`: el desglose dice MÁS que el resumen.
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  select timezone into v_tz from public.companies where id = v_company;

  -- ── Ventas: los renglones de servicio, con su factura y quién cobró.
  with ventas as (
    select ii.service_id, ii.name as service_name,
           ii.quantity,
           (ii.quantity * ii.unit_price_cents - ii.discount_cents)::bigint as amount_cents,
           i.invoice_number, i.created_at, i.customer_name, i.vehicle_plate,
           (select pr.full_name from public.profiles pr where pr.id = i.cashier_id) as cashier_name
      from public.invoice_items ii
      join public.invoices i on i.id = ii.invoice_id
     where i.company_id = v_company and not i.is_annulled
       and i.ncf_type is distinct from 'B04'
       and app.dia_operativo(i.created_at, v_tz) between p_from and p_to
       and (p_branch_id is null or i.branch_id = p_branch_id)
       and ii.item_type = 'service'
  )
  select count(*)::bigint,
         coalesce((select jsonb_agg(to_jsonb(v) order by v.service_name, v.created_at)
                     from (select * from ventas order by service_name, created_at limit v_limit) v), '[]'::jsonb)
    into v_n_ventas, v_ventas
    from ventas;

  -- ── Insumos: lo que se consumió, con la orden y el producto.
  with insumos as (
    select sc.service_id,
           (select s.name from public.services s where s.id = sc.service_id) as service_name,
           (select p.name from public.products p where p.id = sc.product_id) as product_name,
           sc.quantity, sc.cost_cents::bigint as cost_cents, sc.created_at,
           o.order_number, o.vehicle_plate
      from public.service_consumptions sc
      join public.work_orders o on o.id = sc.work_order_id
     where sc.company_id = v_company
       and app.dia_operativo(sc.created_at, v_tz) between p_from and p_to
       and (p_branch_id is null or o.branch_id = p_branch_id)
  )
  select count(*)::bigint,
         coalesce((select jsonb_agg(to_jsonb(x) order by x.service_name, x.created_at)
                     from (select * from insumos order by service_name, created_at limit v_limit) x), '[]'::jsonb)
    into v_n_insumos, v_insumos
    from insumos;

  -- ── Comisiones: a quién se le pagó por cada lavado.
  --
  -- Se casan por NOMBRE del servicio porque así las guarda `commissions` y así
  -- las suma `profit_report`. Llevan `service_name` y no `service_id` a
  -- propósito: es la única llave que el cálculo usa, y fingir un id aquí haría
  -- creer que la atribución es más firme de lo que es.
  with comisiones as (
    select c.service_name, c.amount_cents::bigint as amount_cents, c.earned_on,
           c.is_paid,
           (select pr.full_name from public.profiles pr where pr.id = c.profile_id) as lavador,
           (select o.order_number from public.work_orders o where o.id = c.work_order_id) as order_number
      from public.commissions c
     where c.company_id = v_company
       and c.earned_on between p_from and p_to
       and (p_branch_id is null or c.branch_id = p_branch_id)
  )
  select count(*)::bigint,
         coalesce((select jsonb_agg(to_jsonb(y) order by y.service_name, y.earned_on)
                     from (select * from comisiones order by service_name, earned_on limit v_limit) y), '[]'::jsonb)
    into v_n_comisiones, v_comisiones
    from comisiones;

  return jsonb_build_object(
    'ventas', v_ventas,
    'insumos', v_insumos,
    'comisiones', v_comisiones,
    'total_ventas', v_n_ventas,
    'total_insumos', v_n_insumos,
    'total_comisiones', v_n_comisiones,
    'limit', v_limit,
    'truncated', greatest(v_n_ventas, v_n_insumos, v_n_comisiones) > v_limit
  );
end;
$$;

grant execute on function public.profit_report_lines(date, date, uuid, integer) to authenticated;

comment on function public.profit_report_lines is
  'Los renglones detrás del margen por servicio de profit_report, en tres '
  'listas —ventas, insumos y comisiones— porque de tres sitios distintos sale '
  'el cálculo. No se mezclan en una fila: el resumen no atribuye insumos ni '
  'comisiones a una venta concreta.';
