-- =============================================================================
-- KARDEX TRAZABLE Y PANEL DE COMPRAS
-- =============================================================================
-- El kardex ya registra cada movimiento, pero la pantalla filtra poco y no
-- conecta un movimiento con el documento que lo originó: ve «Compra» pero no
-- lleva a la compra, ve «Venta» pero no a la factura. La trazabilidad —poder ir
-- del número al registro que lo produjo— es el principio de esta fase, y el
-- kardex es donde más se nota.
--
-- La base ya lo permite: inventory_movements guarda invoice_id, work_order_id y
-- purchase_id. Faltaba una consulta que los resolviera a un número legible y
-- que filtrara por todo lo que un encargado pregunta.
--
--   · kardex_page(...)      — el kardex con ocho filtros y el documento origen
--                            resuelto (factura, orden o compra) + responsable.
--   · purchases_summary(...) — los KPIs de Compras: del periodo, pagadas,
--                            pendiente, vencido, proveedores con saldo.
--
-- Solo lectura. No cambia una fila.
-- =============================================================================

-- ── Kardex paginado y trazable ──────────────────────────────────────────────
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

  create temporary table _kx on commit drop as
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
          or p.code ilike '%' || v_busca || '%');

  select count(*) into v_total from _kx;

  select coalesce(jsonb_agg(fila order by created_at desc), '[]'::jsonb)
    into v_rows
  from (
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
    from _kx k
    order by k.created_at desc
    limit v_size offset v_page * v_size
  ) t;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

grant execute on function public.kardex_page(date, date, uuid, text, text, uuid, uuid, text, integer, integer) to authenticated;

comment on function public.kardex_page is
  'Kardex con filtros de servidor (fecha, producto, categoría, tipo, sucursal, '
  'usuario, texto) y el documento de origen resuelto a su número, para abrirlo.';

-- ── Resumen de compras (KPIs del panel) ─────────────────────────────────────
create or replace function public.purchases_summary(
  p_from      date default null,
  p_to        date default null,
  p_supplier_id uuid default null
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
    raise exception 'Su rol no permite consultar el resumen de compras.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'compras_cents', coalesce(sum(total_cents), 0),
    'compras_count', count(*),
    'pagado_cents', coalesce(sum(paid_cents), 0),
    'pendiente_cents', coalesce(sum(total_cents - paid_cents) filter (where paid_cents < total_cents), 0),
    -- Vencido: crédito con saldo cuya fecha de vencimiento ya pasó.
    'vencido_cents', coalesce(sum(total_cents - paid_cents)
      filter (where is_credit and paid_cents < total_cents
                and due_date is not null and due_date < current_date), 0)
  ) into v_result
  from public.purchases
  where company_id = v_company
    and (p_from is null or p_to is null or purchase_date between p_from and p_to)
    and (p_supplier_id is null or supplier_id = p_supplier_id)
    and status <> 'anulada';

  -- Proveedores con saldo pendiente (vigente, sin importar el rango: es una deuda).
  v_result := v_result || jsonb_build_object(
    'proveedores_con_saldo', coalesce((
      select count(*) from (
        select supplier_id from public.purchases
        where company_id = v_company and supplier_id is not null
          and paid_cents < total_cents and status <> 'anulada'
        group by supplier_id) t), 0));

  return v_result;
end;
$$;

grant execute on function public.purchases_summary(date, date, uuid) to authenticated;

comment on function public.purchases_summary is
  'KPIs de Compras: del periodo, pagado, pendiente, vencido y proveedores con '
  'saldo. El pendiente y el vencido son deudas vigentes, no del rango.';
