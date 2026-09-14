-- =============================================================================
-- Borrar una orden de trabajo (mig 20260914140000).
--
-- Once tablas apuntan a `work_orders` y seis se borran en cascada. Dos de esas
-- son dinero: `commissions` (lo que se le debe al lavador) y, del otro lado,
-- `invoices`, que no cae pero se queda apuntando a null y pierde de qué lavado
-- salió. Lo que se prueba aquí es que ninguna de esas dos se pierda en silencio.
--
-- Todo va por la FUNCIÓN, nunca por un `delete` a mano sobre la tabla. Esa
-- distinción ya me costó un fallo en producción: probar la tabla no es probar el
-- botón, porque las tres negativas SOLO existen en el camino de la función.
-- =============================================================================

set role postgres;

do $$
declare
  v_super uuid;
  v_wo_libre uuid;
  v_wo_facturada uuid;
  v_wo_comision uuid;
  v_wo_inventario uuid;
  v_c uuid := test.var('c_a')::uuid;
  v_b uuid := test.var('b_a')::uuid;
  v_prod uuid;
begin
  -- Un superadministrador de la empresa Alfa. No había ninguno en el montaje.
  insert into auth.users (email, raw_user_meta_data)
    values ('super.a@example.com', jsonb_build_object('full_name','Super Alfa'))
    returning id into v_super;
  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles set company_id=v_c, branch_id=v_b, role='superadmin' where id=v_super;
  perform set_config('app.branch_ctx', '', true);
  perform test.set_var('u_super_a', v_super::text);

  -- Cuatro órdenes: una limpia y tres con cada uno de los tres impedimentos.
  insert into public.work_orders (company_id, branch_id, order_number, customer_name, vehicle_plate, vehicle_category, status, total_cents)
    values (v_c, v_b, 'BORRA-1', 'Cliente Borra 1', 'X000001', 'sedan', 'pendiente', 0) returning id into v_wo_libre;
  insert into public.work_orders (company_id, branch_id, order_number, customer_name, vehicle_plate, vehicle_category, status, total_cents)
    values (v_c, v_b, 'BORRA-2', 'Cliente Borra 2', 'X000002', 'sedan', 'listo', 50000) returning id into v_wo_facturada;
  insert into public.work_orders (company_id, branch_id, order_number, customer_name, vehicle_plate, vehicle_category, status, total_cents)
    values (v_c, v_b, 'BORRA-3', 'Cliente Borra 3', 'X000003', 'sedan', 'listo', 50000) returning id into v_wo_comision;
  insert into public.work_orders (company_id, branch_id, order_number, customer_name, vehicle_plate, vehicle_category, status, total_cents)
    values (v_c, v_b, 'BORRA-4', 'Cliente Borra 4', 'X000004', 'sedan', 'listo', 50000) returning id into v_wo_inventario;

  -- Una línea en la orden limpia: tiene que irse en cascada con ella.
  insert into public.work_order_items (company_id, work_order_id, item_type, name, quantity, unit_price_cents)
    values (v_c, v_wo_libre, 'service', 'Lavado', 1, 0);


  -- Factura VIVA sobre la 2.
  insert into public.invoices (company_id, branch_id, work_order_id, invoice_number, customer_name,
                               cashier_id, subtotal_cents, tax_cents, total_cents)
    values (v_c, v_b, v_wo_facturada, 'F-BORRA-2', 'Cliente Borra 2',
            test.var('u_cashier_a')::uuid, 50000, 0, 50000);

  -- Comisión YA PAGADA sobre la 3.
  insert into public.commissions (company_id, branch_id, profile_id, work_order_id, service_name,
                                  base_cents, commission_bps, amount_cents, is_paid, paid_at)
    values (v_c, v_b, test.var('u_cashier_a')::uuid, v_wo_comision, 'Lavado',
            50000, 1000, 5000, true, now());

  -- Movimiento de inventario sobre la 4.
  insert into public.products (company_id, code, name)
    values (v_c, 'SKU-BORRA', 'Champú') returning id into v_prod;
  insert into public.inventory_movements (company_id, branch_id, product_id, work_order_id,
                                          kind, qty_change, qty_before, qty_after)
    values (v_c, v_b, v_prod, v_wo_inventario, 'consumo', -1, 5, 4);

  perform test.set_var('wo_libre',      v_wo_libre::text);
  perform test.set_var('wo_facturada',  v_wo_facturada::text);
  perform test.set_var('wo_comision',   v_wo_comision::text);
  perform test.set_var('wo_inventario', v_wo_inventario::text);
end $$;

-- ── Quién puede ─────────────────────────────────────────────────────────────
-- El propietario es el rol más alto del negocio y AUN ASÍ no borra órdenes:
-- cancelar deja rastro de que el vehículo entró, borrar no. Si esta prueba se
-- cae, es que la lista de roles de la función se ensanchó sin decidirlo.
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select test.expect_error(
  'un propietario NO borra órdenes: para eso está cancelar',
  format('select public.delete_work_order(%L::uuid)', test.var('wo_libre')));

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
select test.expect_error(
  'un cajero tampoco',
  format('select public.delete_work_order(%L::uuid)', test.var('wo_libre')));

-- ── Las tres negativas ──────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', test.var('u_super_a'), false);

select test.expect_error(
  'ni el superadmin borra una orden FACTURADA: la factura perdería su lavado',
  format('select public.delete_work_order(%L::uuid)', test.var('wo_facturada')));

select test.expect_error(
  'ni una con comisión YA PAGADA: se la quitaría al lavador en cascada',
  format('select public.delete_work_order(%L::uuid)', test.var('wo_comision')));

select test.expect_error(
  'ni una que ya consumió inventario: el kardex quedaría sin origen',
  format('select public.delete_work_order(%L::uuid)', test.var('wo_inventario')));

-- Y que la negativa no fue de boquilla: las tres órdenes siguen ahí.
select test.check('las tres órdenes rechazadas siguen existiendo',
  (select count(*) from public.work_orders
    where id in (test.var('wo_facturada')::uuid, test.var('wo_comision')::uuid,
                 test.var('wo_inventario')::uuid)) = 3);

-- ── El caso que sí ──────────────────────────────────────────────────────────
select public.delete_work_order(test.var('wo_libre')::uuid);

select test.check('el superadmin SÍ borra una orden sin factura, sin comisión y sin consumo',
  (select count(*) from public.work_orders where id = test.var('wo_libre')::uuid) = 0);

select test.check('y sus líneas se van con ella, no quedan colgando',
  (select count(*) from public.work_order_items
    where work_order_id = test.var('wo_libre')::uuid) = 0);

-- El rastro es la mitad del trabajo: un borrado sin rastro es un agujero.
set role postgres;
select test.check('queda en la bitácora qué orden se borró, con su placa y su total',
  (select count(*) from public.audit_logs
    where action = 'BORRAR_ORDEN'
      and entity_id = test.var('wo_libre')
      and details like '%BORRA-1%'
      and metadata->>'vehicle_plate' = 'X000001') = 1);

-- ── Otra empresa ────────────────────────────────────────────────────────────
-- La función es `security definer`: salta la RLS. Sin el `company_id` en el
-- WHERE, un superadmin de Beta borraría órdenes de Alfa. Se comprueba con una
-- orden REAL de Alfa, resuelta como postgres — pedirla bajo la RLS de Beta
-- devolvería null y la prueba pasaría sin probar nada.
do $$
declare
  v_super_b uuid;
  v_wo_a uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('super.b@example.com', jsonb_build_object('full_name','Super Beta'))
    returning id into v_super_b;
  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles set company_id=test.var('c_b')::uuid, branch_id=test.var('branch_b')::uuid,
         role='superadmin' where id=v_super_b;
  perform set_config('app.branch_ctx', '', true);
  perform test.set_var('u_super_b', v_super_b::text);

  insert into public.work_orders (company_id, branch_id, order_number, customer_name, vehicle_plate, vehicle_category, status, total_cents)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'BORRA-5', 'Cliente Borra 5', 'X000005', 'sedan', 'pendiente', 0)
    returning id into v_wo_a;
  perform test.set_var('wo_ajena', v_wo_a::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_super_b'), false);
set role authenticated;
select test.expect_error(
  'un superadmin de otra empresa NO borra una orden ajena',
  format('select public.delete_work_order(%L::uuid)', test.var('wo_ajena')));

set role postgres;
select test.check('la orden ajena sigue intacta',
  (select count(*) from public.work_orders where id = test.var('wo_ajena')::uuid) = 1);
