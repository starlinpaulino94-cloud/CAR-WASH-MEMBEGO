-- =============================================================================
-- FICHA 360 DEL PROVEEDOR
-- =============================================================================
-- El directorio de proveedores era una lista de contactos. Un dueño que va a
-- pagar o a negociar pregunta otra cosa: «¿cuánto le he comprado a este, cuánto
-- le debo, tiene algo vencido, cuándo fue la última, qué le compro más?». Todo
-- eso ya está en purchases y purchase_items; faltaba una consulta que lo
-- juntara para una pantalla.
--
--   · supplier_detail(id, from, to)  — la ficha: totales, saldo, vencido,
--                                     última compra, productos más comprados y
--                                     el historial de compras.
--
-- Solo lectura. El «total comprado» y el «saldo» son de SIEMPRE (una relación
-- comercial y una deuda no son del rango); las «compras del periodo» sí.
-- =============================================================================

create or replace function public.supplier_detail(
  p_supplier_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los proveedores.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.suppliers
                 where id = p_supplier_id and company_id = v_company) then
    raise exception 'Proveedor inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    -- Totales de SIEMPRE: la relación y la deuda no dependen del rango.
    'total_comprado_cents', coalesce((
      select sum(total_cents) from public.purchases
      where supplier_id = p_supplier_id and company_id = v_company and status <> 'anulada'), 0),
    'saldo_cents', coalesce((
      select sum(total_cents - paid_cents) from public.purchases
      where supplier_id = p_supplier_id and company_id = v_company
        and paid_cents < total_cents and status <> 'anulada'), 0),
    'vencido_cents', coalesce((
      select sum(total_cents - paid_cents) from public.purchases
      where supplier_id = p_supplier_id and company_id = v_company
        and is_credit and paid_cents < total_cents and status <> 'anulada'
        and due_date is not null and due_date < current_date), 0),
    'compras_total', coalesce((
      select count(*) from public.purchases
      where supplier_id = p_supplier_id and company_id = v_company and status <> 'anulada'), 0),
    'ultima_compra', (
      select purchase_date from public.purchases
      where supplier_id = p_supplier_id and company_id = v_company and status <> 'anulada'
      order by purchase_date desc limit 1),
    -- Del PERIODO, si se pidió: cuánto se le compró en ese rango.
    'periodo_cents', case when p_from is null or p_to is null then null else coalesce((
      select sum(total_cents) from public.purchases
      where supplier_id = p_supplier_id and company_id = v_company and status <> 'anulada'
        and purchase_date between p_from and p_to), 0) end,
    -- Lo que más se le compra, por importe.
    'productos_top', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'total_cents', total) order by total desc)
      from (
        select p.name, sum(pi.quantity) qty, sum(pi.quantity * pi.unit_cost_cents) total
        from public.purchase_items pi
        join public.purchases pu on pu.id = pi.purchase_id
        join public.products p on p.id = pi.product_id
        where pu.supplier_id = p_supplier_id and pi.company_id = v_company and pu.status <> 'anulada'
        group by p.id, p.name
        order by total desc limit 8) t), '[]'::jsonb),
    -- El historial de compras (las últimas 20).
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'invoice_ref', invoice_ref, 'purchase_date', purchase_date,
        'total_cents', total_cents, 'paid_cents', paid_cents, 'is_credit', is_credit,
        'due_date', due_date, 'status', status,
        'vencida', is_credit and paid_cents < total_cents and due_date is not null and due_date < current_date
      ) order by purchase_date desc)
      from (select * from public.purchases
            where supplier_id = p_supplier_id and company_id = v_company
            order by purchase_date desc limit 20) p), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.supplier_detail(uuid, date, date) to authenticated;

comment on function public.supplier_detail is
  'Ficha 360 del proveedor: total comprado y saldo (de siempre), vencido, '
  'última compra, productos más comprados e historial. El rango solo afecta al '
  'importe del periodo.';
