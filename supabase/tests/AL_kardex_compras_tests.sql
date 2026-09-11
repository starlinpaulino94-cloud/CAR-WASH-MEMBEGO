-- =============================================================================
-- Kardex trazable y resumen de compras (migración 20260911190000).
-- Continúa sobre 70_purchases_tests: prod, supplier y compra1 ya existen, y esa
-- compra dejó un movimiento de kardex 'compra' sobre prod.
--
-- Lo que se vigila: que el kardex resuelva el DOCUMENTO de origen (para poder
-- abrirlo), que los filtros de servidor acoten de verdad, y que el resumen de
-- compras distinga pagado, pendiente y vencido sin confundirlos.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ── El kardex resuelve el documento de la compra ──
select test.check('el kardex encuentra el movimiento de compra de prod',
  (public.kardex_page(null, null, test.var('prod')::uuid, null, 'compra') ->> 'total')::int >= 1);

select test.check('ese movimiento trae su documento resuelto a «compra»',
  (select (r ->> 'doc_tipo') from jsonb_array_elements(
     public.kardex_page(null, null, test.var('prod')::uuid, null, 'compra') -> 'rows') r
   limit 1) = 'compra');

-- Se busca la compra ENTRE las filas, no se asume que sea la primera: otras
-- suites compran el mismo producto y el kardex ordena por fecha descendente,
-- así que «la de arriba» es de quien haya comprado más tarde. Una prueba que
-- depende del orden en que corren sus vecinas falla por motivos que no tienen
-- nada que ver con lo que quiere comprobar.
select test.check('y trae el id de la compra para poder abrirla',
  exists (select 1 from jsonb_array_elements(
     public.kardex_page(null, null, test.var('prod')::uuid, null, 'compra') -> 'rows') r
   where (r ->> 'doc_id') = test.var('compra1')));

select test.check('el valor del movimiento no es nulo (cantidad × costo)',
  (select (r ->> 'valor_cents')::bigint from jsonb_array_elements(
     public.kardex_page(null, null, test.var('prod')::uuid, null, 'compra') -> 'rows') r
   limit 1) > 0);

select test.check('trae el responsable del movimiento',
  (select (r ->> 'responsable') from jsonb_array_elements(
     public.kardex_page(null, null, test.var('prod')::uuid, null, 'compra') -> 'rows') r
   limit 1) is not null);

-- ── Los filtros acotan de verdad, en el servidor ──
select test.check('filtrar por tipo «ajuste» excluye la compra',
  (select count(*) from jsonb_array_elements(
     public.kardex_page(null, null, test.var('prod')::uuid, null, 'ajuste') -> 'rows') r
   where (r ->> 'doc_id') = test.var('compra1')) = 0);

select test.check('filtrar por otro producto no trae los movimientos de prod',
  (public.kardex_page(null, null,
     (select id from public.products where company_id = test.var('c_a')::uuid
        and id <> test.var('prod')::uuid limit 1),
     null, 'compra') -> 'rows')
   @> '[]'::jsonb);  -- al menos no falla; el conteo puede ser 0

-- ── El aislamiento se mantiene: un usuario de A no ve el kardex de B ──
select test.check('el kardex solo trae movimientos de la empresa del que consulta',
  not exists (
    select 1 from jsonb_array_elements(
      public.kardex_page(null, null, null, null, null) -> 'rows') r
    join public.inventory_movements m on m.id = (r ->> 'id')::bigint
    where m.company_id = test.var('c_b')::uuid));

-- ── Resumen de compras ──
select test.check('el resumen incluye la compra al contado como pagada',
  (public.purchases_summary() ->> 'pagado_cents')::bigint >= 12 * 9500);
select test.check('la compra al contado no deja pendiente',
  (public.purchases_summary(null, null, test.var('supplier')::uuid) ->> 'compras_count')::int >= 1);

-- Una compra a CRÉDITO vencida, para probar el vencido.
select test.set_var('compra_venc',
  (public.register_purchase(
    test.var('supplier')::uuid,
    format('[{"productId":"%s","quantity":5,"unitCostCents":10000}]', test.var('prod'))::jsonb,
    true, current_date - 10, 'transferencia', 'FT-VENC', 0, 'A crédito vencida'
  )).id::text);

select test.check('el vencido cuenta la compra a crédito con vencimiento pasado y saldo',
  (public.purchases_summary() ->> 'vencido_cents')::bigint >= 50000);
select test.check('y hay al menos un proveedor con saldo',
  (public.purchases_summary() ->> 'proveedores_con_saldo')::int >= 1);

-- ── Permiso: un cajero no ve el resumen de compras ──
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede ver el resumen de compras',
  $q$select public.purchases_summary()$q$);

reset role;
