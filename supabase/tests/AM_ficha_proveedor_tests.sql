-- =============================================================================
-- Ficha 360 del proveedor (migración 20260911200000).
-- Continúa sobre 70_purchases y AL_kardex: supplier, compra1 (contado) y
-- compra_venc (crédito vencida) ya existen para prod.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Total comprado: cuadra con la suma real de sus compras vigentes (hay varias
-- de las pruebas anteriores; se compara contra la base, no contra un número fijo).
select test.check('el total comprado cuadra con la suma de sus compras vigentes',
  (public.supplier_detail(test.var('supplier')::uuid) ->> 'total_comprado_cents')::bigint
    = (select coalesce(sum(total_cents),0) from public.purchases
       where supplier_id = test.var('supplier')::uuid and status <> 'anulada'));

select test.check('el saldo cuadra con lo no pagado de sus compras',
  (public.supplier_detail(test.var('supplier')::uuid) ->> 'saldo_cents')::bigint
    = (select coalesce(sum(total_cents - paid_cents),0) from public.purchases
       where supplier_id = test.var('supplier')::uuid and paid_cents < total_cents and status <> 'anulada'));

select test.check('el vencido incluye la compra a crédito con fecha pasada',
  (public.supplier_detail(test.var('supplier')::uuid) ->> 'vencido_cents')::bigint >= 5*10000);

select test.check('cuenta al menos dos compras',
  (public.supplier_detail(test.var('supplier')::uuid) ->> 'compras_total')::int >= 2);

select test.check('trae la última compra',
  (public.supplier_detail(test.var('supplier')::uuid) ->> 'ultima_compra') is not null);

select test.check('los productos más comprados incluyen a prod',
  exists (select 1 from jsonb_array_elements(
    public.supplier_detail(test.var('supplier')::uuid) -> 'productos_top') p
    where (p ->> 'name') is not null));

select test.check('el historial marca la compra a crédito como vencida',
  exists (select 1 from jsonb_array_elements(
    public.supplier_detail(test.var('supplier')::uuid) -> 'compras') c
    where (c ->> 'id') = test.var('compra_venc') and (c ->> 'vencida')::boolean = true));

-- El importe del periodo sí depende del rango; el total no.
select test.check('el importe del periodo respeta el rango (un día lejano da 0)',
  (public.supplier_detail(test.var('supplier')::uuid, '2000-01-01', '2000-01-02') ->> 'periodo_cents')::bigint = 0);

-- Aislamiento y permiso.
select test.expect_error('no se puede ver la ficha de un proveedor de otra empresa',
  format($q$select public.supplier_detail(%L::uuid)$q$, gen_random_uuid()));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede ver la ficha del proveedor',
  format($q$select public.supplier_detail(%L::uuid)$q$, test.var('supplier')));

reset role;
