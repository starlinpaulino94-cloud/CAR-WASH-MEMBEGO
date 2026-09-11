-- =============================================================================
-- CAJA: HISTÓRICO FILTRABLE Y RESUMEN GERENCIAL
-- =============================================================================
-- La caja ya registra cada cierre con su arqueo: fondo, esperado, contado,
-- diferencia y las ventas por método. Pero el histórico traía las últimas 20
-- sesiones sin filtros ni totales, así que no respondía «¿cuánto descuadre
-- hubo este mes?, ¿qué cajero acumula faltantes?, ¿cuánto entró en efectivo?».
-- Todo está en cash_sessions; faltaba agregarlo y filtrarlo.
--
--   · cash_summary(...)        — los KPIs: cajas cerradas, ventas por método,
--                               salidas, sobrantes, faltantes y descuadre neto.
--   · cash_sessions_page(...)  — el histórico con cajero, arqueo y filtros.
--
-- La diferencia es CONTADO − ESPERADO: positiva es sobrante, negativa faltante.
-- Solo lectura.
-- =============================================================================

create or replace function public.cash_summary(
  p_branch_id uuid,
  p_from      date default null,
  p_to        date default null,
  p_cashier_id uuid default null
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
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el resumen de caja.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and company_id = v_company) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with sesiones as (
    select * from public.cash_sessions
    where company_id = v_company and branch_id = p_branch_id
      and (p_from is null or p_to is null
           or app.dia_operativo(opened_at, v_tz) between p_from and p_to)
      and (p_cashier_id is null or cashier_id = p_cashier_id)
  )
  select jsonb_build_object(
    'cajas_cerradas', count(*) filter (where status = 'closed'),
    'cajas_abiertas', count(*) filter (where status = 'open'),
    'ventas_cents', coalesce(sum(total_cash_sales_cents + total_card_sales_cents
                                 + total_transfer_sales_cents + total_membego_cents), 0),
    'efectivo_cents', coalesce(sum(total_cash_sales_cents), 0),
    'tarjeta_cents', coalesce(sum(total_card_sales_cents), 0),
    'transferencia_cents', coalesce(sum(total_transfer_sales_cents), 0),
    'membego_cents', coalesce(sum(total_membego_cents), 0),
    'salidas_cents', coalesce(sum(total_outflows_cents), 0),
    -- Sobrantes y faltantes, cada uno por su lado: netearlos escondería que un
    -- faltante grande se tapó con un sobrante de otra caja.
    'sobrantes_cents', coalesce(sum(difference_cents) filter (where difference_cents > 0), 0),
    'faltantes_cents', coalesce(abs(sum(difference_cents) filter (where difference_cents < 0)), 0),
    'descuadre_neto_cents', coalesce(sum(difference_cents) filter (where status = 'closed'), 0)
  ) into v_result
  from sesiones;

  return v_result;
end;
$$;

grant execute on function public.cash_summary(uuid, date, date, uuid) to authenticated;

comment on function public.cash_summary is
  'KPIs de caja: cajas cerradas, ventas por método, salidas, sobrantes y '
  'faltantes por separado y descuadre neto. Diferencia = contado − esperado.';

-- ── Histórico de sesiones ───────────────────────────────────────────────────
create or replace function public.cash_sessions_page(
  p_branch_id uuid,
  p_from       date default null,
  p_to         date default null,
  p_cashier_id uuid default null,
  p_estado     text default null,     -- 'open' | 'closed' | null
  p_diferencia text default null,     -- 'con' | 'sin' | null
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

  create temporary table _cs on commit drop as
  select * from public.cash_sessions
  where company_id = v_company and branch_id = p_branch_id
    and (p_from is null or p_to is null or app.dia_operativo(opened_at, v_tz) between p_from and p_to)
    and (p_cashier_id is null or cashier_id = p_cashier_id)
    and (p_estado is null or status = p_estado::app.cash_session_status)
    and (p_diferencia is null
         or (p_diferencia = 'con' and coalesce(difference_cents, 0) <> 0)
         or (p_diferencia = 'sin' and coalesce(difference_cents, 0) = 0));

  select count(*) into v_total from _cs;

  select coalesce(jsonb_agg(fila order by opened_at desc), '[]'::jsonb)
    into v_rows
  from (
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
    from _cs c order by c.opened_at desc
    limit v_size offset v_page * v_size
  ) t;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

grant execute on function public.cash_sessions_page(uuid, date, date, uuid, text, text, integer, integer) to authenticated;

comment on function public.cash_sessions_page is
  'Histórico de cajas con el cajero, el arqueo (esperado, contado, diferencia) '
  'y las ventas por método, filtrable por periodo, cajero, estado y diferencia.';
