-- =============================================================================
-- Pruebas de proveedores y compras (migración 0020)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls) y el producto 'prod' de Alfa (20_billing).
-- =============================================================================

-- ---- Directorio: el admin crea proveedores; el cajero no.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

with s as (
  insert into public.suppliers (company_id, name, phone)
  values (test.var('c_a')::uuid, 'Química del Caribe SRL', '809-555-0100')
  returning id
)
select test.set_var('supplier', (select id::text from s));

select test.check('el propietario crea un proveedor',
  (select count(*) = 1 from public.suppliers where name = 'Química del Caribe SRL'));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede crear proveedores',
  $q$insert into public.suppliers (company_id, name)
     values ((select test.var('c_a'))::uuid, 'Proveedor Pirata')$q$);
select test.expect_error('un cajero no puede registrar compras',
  format($q$select public.register_purchase(%L::uuid,
    '[{"productId":"%s","quantity":1,"unitCostCents":100}]'::jsonb)$q$,
    test.var('supplier'), test.var('prod')));

-- ---- Compra al CONTADO: entra inventario, kardex 'compra', costo actualizado.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.set_var('stock_pre_compra',
  (select stock::text from public.products where id = test.var('prod')::uuid));

select test.set_var('compra1',
  (public.register_purchase(
    test.var('supplier')::uuid,
    format('[{"productId":"%s","quantity":12,"unitCostCents":9500}]', test.var('prod'))::jsonb,
    false, null, 'transferencia', 'FT-0001', 0, 'Reposición mensual'
  )).id::text);

select test.check('la compra al contado queda pagada completa (sin saldo)',
  (select paid_cents = total_cents and total_cents = 12 * 9500
     from public.purchases where id = test.var('compra1')::uuid));

select test.check('la compra ENTRÓ el inventario',
  (select stock from public.products where id = test.var('prod')::uuid)
    = test.var('stock_pre_compra')::integer + 12);

select test.check('la entrada quedó en el kardex como «compra» ligada a la compra',
  (select count(*) = 1 from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'compra'
      and purchase_id = test.var('compra1')::uuid and qty_change = 12));

select test.check('el último costo del producto se actualizó',
  (select cost_cents = 9500 from public.products where id = test.var('prod')::uuid));

select test.check('la compra quedó en la bitácora',
  (select count(*) >= 1 from public.audit_logs
    where action = 'REGISTRAR_COMPRA' and entity_id = test.var('compra1')::uuid));

-- ---- Compra a CRÉDITO: exige vencimiento y abre cuenta por pagar.
select test.expect_error('una compra a crédito sin vencimiento se rechaza',
  format($q$select public.register_purchase(%L::uuid,
    '[{"productId":"%s","quantity":1,"unitCostCents":1000}]'::jsonb, true)$q$,
    test.var('supplier'), test.var('prod')));

select test.set_var('compra2',
  (public.register_purchase(
    test.var('supplier')::uuid,
    format('[{"productId":"%s","quantity":10,"unitCostCents":10000}]', test.var('prod'))::jsonb,
    true, current_date + 30, 'credito', 'FT-0002'
  )).id::text);

select test.check('la compra a crédito abre con saldo completo (cuenta por pagar)',
  (select paid_cents = 0 and total_cents = 100000
     from public.purchases where id = test.var('compra2')::uuid));

-- ---- Abonos: parcial, excedido y liquidación.
select test.check('un abono parcial reduce el saldo',
  (public.pay_supplier(test.var('compra2')::uuid, 40000, 'transferencia', 'AB-1')).paid_cents = 40000);

select test.expect_error('un abono mayor al saldo se rechaza',
  format($q$select public.pay_supplier(%L::uuid, 999999)$q$, test.var('compra2')));

select test.check('la liquidación deja la compra saldada',
  (public.pay_supplier(test.var('compra2')::uuid, 60000, 'transferencia', 'AB-2')).paid_cents = 100000);

select test.check('los abonos quedaron registrados',
  (select count(*) = 2 from public.supplier_payments
    where purchase_id = test.var('compra2')::uuid));

-- ---- Validaciones de tenant.
select test.expect_error('no se puede comprar con renglones de producto ajeno',
  format($q$select public.register_purchase(%L::uuid,
    '[{"productId":"00000000-0000-0000-0000-000000000001","quantity":1,"unitCostCents":100}]'::jsonb)$q$,
    test.var('supplier')));

-- ---- Aislamiento: Beta no ve nada de Alfa y no puede pagarle sus compras.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve los proveedores ajenos',
  (select count(*) = 0 from public.suppliers where name = 'Química del Caribe SRL'));
select test.check('otro car wash no ve las compras ajenas',
  (select count(*) = 0 from public.purchases where id = test.var('compra1')::uuid));
select test.expect_error('otro car wash no puede abonar compras ajenas',
  format($q$select public.pay_supplier(%L::uuid, 100)$q$, test.var('compra2')));

reset role;
