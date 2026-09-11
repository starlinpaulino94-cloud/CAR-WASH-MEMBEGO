-- =============================================================================
-- INVENTARIO PROFESIONAL · bajo stock correcto, valoración y ficha de producto
-- =============================================================================
-- El filtro de «bajo stock» comparaba stock <= min_stock EN EL NAVEGADOR, sobre
-- la página ya traída. Con 800 productos y 73 en bajo stock, el sistema
-- encontraba solo los que cayeran en la página visible, y la interfaz pedía al
-- usuario «recorra las páginas». Eso no es un producto que se pueda vender.
--
-- La causa raíz: PostgREST no sabe comparar dos columnas entre sí. La solución
-- limpia y escalable es que la comparación viva en la BASE, como una columna
-- calculada que se puede filtrar, contar e indexar como cualquier otra.
--
-- Esta migración:
--   · columnas generadas low_stock y out_of_stock (+ índices) → filtro y conteo
--     correctos en TODO el inventario, no en una página;
--   · inventory_summary(...)  → los KPIs del panel (valor, venta potencial,
--     bajo stock, agotados, negativos, consumo y mermas del periodo);
--   · product_detail(...)     → la ficha: últimas compras, últimos movimientos,
--     consumo, mermas y proveedor habitual.
--
-- Las columnas generadas no cambian ningún dato: se derivan de stock y
-- min_stock que ya existen. Las RPC son de solo lectura.
-- =============================================================================

-- ── Columnas calculadas del estado de existencia ────────────────────────────
-- STORED (no VIRTUAL) para poder indexarlas: el filtro «bajo stock» sobre 800
-- productos tiene que ser un índice, no un recorrido.
alter table public.products
  add column if not exists low_stock boolean
    generated always as (stock <= min_stock) stored;

alter table public.products
  add column if not exists out_of_stock boolean
    generated always as (stock <= 0) stored;

-- Índices parciales: solo interesan las FILAS problemáticas, que son pocas.
create index if not exists products_low_stock_idx
  on public.products (company_id) where low_stock;
create index if not exists products_out_of_stock_idx
  on public.products (company_id) where out_of_stock;

comment on column public.products.low_stock is
  'Calculada: stock <= min_stock. Existe para poder FILTRAR y CONTAR el bajo '
  'stock en la base; antes se comparaba en el navegador sobre la página traída.';

-- ── Resumen del inventario (KPIs del panel) ─────────────────────────────────
-- Todo en una consulta agregada: traer 800 productos al navegador para sumarlos
-- es justo lo que esta fase evita.
create or replace function public.inventory_summary(
  p_from      date default null,
  p_to        date default null,
  p_branch_id uuid default null
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
  select timezone into v_tz from public.companies where id = v_company;

  select jsonb_build_object(
    -- Valoración: el inventario a COSTO y su venta potencial a PRECIO. Dos
    -- números que el dueño no tenía y que responden «¿cuánto tengo en el almacén?».
    'valor_costo_cents', coalesce(sum(cost_cents * stock) filter (where stock > 0), 0),
    'venta_potencial_cents', coalesce(sum(price_cents * stock) filter (where stock > 0 and is_for_sale), 0),
    'activos', count(*) filter (where is_active),
    'bajo_stock', count(*) filter (where is_active and low_stock and not out_of_stock),
    'agotados', count(*) filter (where is_active and stock = 0),
    'negativos', count(*) filter (where is_active and stock < 0)
  ) into v_result
  from public.products
  where company_id = v_company
    and (p_branch_id is null or branch_id = p_branch_id or branch_id is null);

  -- Consumo de insumos y mermas del periodo, si se pidió rango. Salen del
  -- kardex, que es donde queda registrado con su costo.
  if p_from is not null and p_to is not null then
    v_result := v_result || jsonb_build_object(
      'consumo_cents', coalesce((
        select sum(sc.cost_cents) from public.service_consumptions sc
        join public.work_orders o on o.id = sc.work_order_id
        where sc.company_id = v_company
          and app.dia_operativo(sc.created_at, v_tz) between p_from and p_to
          and (p_branch_id is null or o.branch_id = p_branch_id)), 0),
      -- Merma: el movimiento de kardex de tipo 'merma' valorado al costo del
      -- producto en ese momento (aquí, al costo actual: es una estimación).
      'merma_cents', coalesce((
        select sum(abs(m.qty_change) * pr.cost_cents)
        from public.inventory_movements m
        join public.products pr on pr.id = m.product_id
        where m.company_id = v_company and m.kind = 'merma'
          and app.dia_operativo(m.created_at, v_tz) between p_from and p_to
          and (p_branch_id is null or m.branch_id = p_branch_id)), 0),
      'merma_unidades', coalesce((
        select sum(abs(m.qty_change)) from public.inventory_movements m
        where m.company_id = v_company and m.kind = 'merma'
          and app.dia_operativo(m.created_at, v_tz) between p_from and p_to
          and (p_branch_id is null or m.branch_id = p_branch_id)), 0)
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.inventory_summary(date, date, uuid) to authenticated;

comment on function public.inventory_summary is
  'KPIs del panel de inventario: valoración a costo, venta potencial, conteos '
  'de estado y, con rango, consumo y mermas del periodo.';

-- ── Ficha de un producto ────────────────────────────────────────────────────
-- Todo lo que la ficha necesita en UNA llamada: el producto, sus últimas
-- compras, sus últimos movimientos, su consumo y su proveedor habitual.
create or replace function public.product_detail(p_product_id uuid)
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
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.products
                 where id = p_product_id and company_id = v_company) then
    raise exception 'Producto inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    'ultimas_compras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'purchase_id', pu.id, 'invoice_ref', pu.invoice_ref,
        'supplier_name', s.name, 'purchase_date', pu.purchase_date,
        'quantity', pi.quantity, 'unit_cost_cents', pi.unit_cost_cents
      ) order by pu.purchase_date desc)
      from public.purchase_items pi
      join public.purchases pu on pu.id = pi.purchase_id
      left join public.suppliers s on s.id = pu.supplier_id
      where pi.product_id = p_product_id and pi.company_id = v_company
      limit 10), '[]'::jsonb),
    'ultimos_movimientos', coalesce((
      select jsonb_agg(fila order by created_at desc) from (
        select jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'qty_change', m.qty_change,
          'qty_before', m.qty_before, 'qty_after', m.qty_after,
          'reason', m.reason, 'created_at', m.created_at,
          'invoice_id', m.invoice_id, 'work_order_id', m.work_order_id
        ) as fila, m.created_at
        from public.inventory_movements m
        where m.product_id = p_product_id and m.company_id = v_company
        order by m.created_at desc limit 15) t), '[]'::jsonb),
    -- Consumo de los últimos 30 días: el ritmo al que se gasta, que es lo que
    -- dice si el mínimo está bien puesto.
    'consumo_30d', coalesce((
      select sum(abs(qty_change)) from public.inventory_movements
      where product_id = p_product_id and company_id = v_company
        and kind in ('consumo', 'venta', 'merma')
        and created_at >= now() - interval '30 days'), 0),
    'proveedor_habitual', (
      select s.name from public.purchase_items pi
      join public.purchases pu on pu.id = pi.purchase_id
      join public.suppliers s on s.id = pu.supplier_id
      where pi.product_id = p_product_id and pi.company_id = v_company
      group by s.id, s.name
      order by count(*) desc, max(pu.purchase_date) desc
      limit 1),
    'ultimo_costo_cents', (
      select pi.unit_cost_cents from public.purchase_items pi
      join public.purchases pu on pu.id = pi.purchase_id
      where pi.product_id = p_product_id and pi.company_id = v_company
      order by pu.purchase_date desc limit 1)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.product_detail(uuid) to authenticated;

comment on function public.product_detail is
  'La ficha de un producto en una llamada: últimas compras, últimos '
  'movimientos, consumo de 30 días y proveedor habitual.';
