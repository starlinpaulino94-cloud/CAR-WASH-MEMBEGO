-- =============================================================================
-- RESUMEN DE FACTURAS QUE RESPETA LOS FILTROS
-- =============================================================================
-- Los KPIs de Facturación se calculaban trayéndose TODAS las facturas de la
-- sucursal al navegador para sumarlas, y sin pasar el rango de fechas: la
-- pantalla filtraba la tabla por periodo pero las tarjetas de arriba seguían
-- mostrando el histórico completo. Es justo lo que esta fase corrige: el
-- universo de los KPIs y el de la tabla tienen que ser el mismo.
--
--   · invoices_summary(from, to, branch, kind) — facturado, anulado, notas de
--     crédito, ticket promedio y el desglose por método, todo del periodo y
--     agregado en el servidor.
--
-- Solo lectura.
-- =============================================================================

create or replace function public.invoices_summary(
  p_branch_id uuid,
  p_from      date default null,
  p_to        date default null,
  p_kind      text default null   -- 'invoices' | 'credit_notes' | 'annulled' | null
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
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and company_id = v_company) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with facturas as (
    select * from public.invoices i
    where i.company_id = v_company and i.branch_id = p_branch_id
      and (p_from is null or p_to is null
           or app.dia_operativo(i.created_at, v_tz) between p_from and p_to)
      and (p_kind is null or p_kind = 'all'
           or (p_kind = 'invoices'     and i.credits_invoice_id is null)
           or (p_kind = 'credit_notes' and i.credits_invoice_id is not null)
           or (p_kind = 'annulled'     and i.is_annulled))
  )
  select jsonb_build_object(
    -- Facturado: comprobantes vigentes que NO son nota de crédito.
    'facturado_cents', coalesce(sum(total_cents)
      filter (where not is_annulled and credits_invoice_id is null), 0),
    'facturas', count(*) filter (where credits_invoice_id is null and not is_annulled),
    'anulado_cents', coalesce(sum(total_cents) filter (where is_annulled), 0),
    'anuladas', count(*) filter (where is_annulled),
    'notas_credito_cents', coalesce(sum(total_cents) filter (where credits_invoice_id is not null), 0),
    'notas_credito', count(*) filter (where credits_invoice_id is not null),
    'ticket_promedio_cents', (
      select case when count(*) = 0 then 0 else (sum(total_cents) / count(*))::bigint end
      from facturas where not is_annulled and credits_invoice_id is null),
    'por_metodo', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'amount_cents', amount) order by amount desc)
      from (
        select cm.method, sum(cm.amount_cents) amount
        from public.cash_movements cm
        join facturas f on f.id = cm.invoice_id
        where cm.type = 'inflow'
        group by cm.method) t), '[]'::jsonb)
  ) into v_result
  from facturas;

  return v_result;
end;
$$;

grant execute on function public.invoices_summary(uuid, date, date, text) to authenticated;

comment on function public.invoices_summary is
  'KPIs de Facturación del periodo y tipo elegidos: facturado, anulado, notas '
  'de crédito, ticket promedio y desglose por método. Mismo universo que la tabla.';
