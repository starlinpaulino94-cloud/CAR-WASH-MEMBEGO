-- =============================================================================
-- Pruebas de EDITAR una orden de trabajo (migración 0042)
-- =============================================================================
-- Continúa sobre los datos de 10_rls_tests.sql / 20_billing_tests.sql (var 'serv').
-- Lo que se demuestra:
--   · editar recalcula el importe en el SERVIDOR: el cliente manda servicios y
--     cantidades, nunca precios;
--   · cambiar la categoría vuelve a tarifar sobre la tarifa de esa categoría;
--   · se actualizan cliente, prioridad y observaciones sin tocar el número de
--     orden ni su identidad;
--   · queda en la bitácora, con el total de antes y el de después;
--   · un cajero NO puede editar, ni llamando al API;
--   · una orden sin servicios se rechaza;
--   · una orden CANCELADA no se edita;
--   · una orden FACTURADA no se edita — reescribiría el importe que respalda una
--     factura con NCF ya emitida.
-- =============================================================================

set role postgres;

-- Tarifa de 'serv' para SUV, distinta de la de sedán (100000), para probar que
-- cambiar la categoría vuelve a tarifar.
do $$
begin
  insert into public.service_prices (service_id, vehicle_category, price_cents)
    values (test.var('serv')::uuid, 'suv', 150000)
  on conflict (service_id, vehicle_category) do update set price_cents = 150000;
end $$;

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Una orden nueva sobre la que trabajar: 1 x Lavado sedán = 100000 + ITBIS 18000.
do $$
declare v_o public.work_orders;
begin
  v_o := public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'EDIT001-req',
    p_vehicle_plate    => 'EDIT001',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name', 'Lavado',
                            'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name    => 'Cliente Editable',
    p_customer_phone   => '809-000-0001');
  perform test.set_var('ord_edit', v_o.id::text);
  perform test.set_var('ord_edit_num', v_o.order_number);
end $$;

select test.check('la orden parte de 118000 (1 x 100000 + ITBIS)',
  (select total_cents from public.work_orders where id = test.var('ord_edit')::uuid) = 118000);

-- ---------------------------------------------------- Cantidad: reprecio servidor
select public.edit_work_order(
  p_order_id => test.var('ord_edit')::uuid,
  p_items    => jsonb_build_array(jsonb_build_object(
                  'service_id', test.var('serv'), 'name', 'Lavado',
                  'quantity', 2, 'discount_cents', 0, 'is_membego_covered', false)));

select test.check('subir a cantidad 2 recalcula: 200000 + ITBIS 36000 = 236000',
  (select total_cents from public.work_orders where id = test.var('ord_edit')::uuid) = 236000);
select test.check('el precio unitario lo puso el servidor, no el cliente',
  (select unit_price_cents from public.work_order_items
     where work_order_id = test.var('ord_edit')::uuid and item_type = 'service') = 100000);
select test.check('sigue siendo la misma orden, con el mismo número',
  (select order_number from public.work_orders where id = test.var('ord_edit')::uuid)
    = test.var('ord_edit_num'));

-- ---------------------------------------------------- Categoría: vuelve a tarifar
select public.edit_work_order(
  p_order_id         => test.var('ord_edit')::uuid,
  p_items            => jsonb_build_array(jsonb_build_object(
                          'service_id', test.var('serv'), 'name', 'Lavado',
                          'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
  p_vehicle_category => 'suv');

select test.check('cambiar a SUV tarifa a 150000 + ITBIS 27000 = 177000',
  (select total_cents from public.work_orders where id = test.var('ord_edit')::uuid) = 177000);
select test.check('y la categoría de la orden quedó en suv',
  (select vehicle_category::text from public.work_orders where id = test.var('ord_edit')::uuid) = 'suv');

-- ---------------------------------------------------- Cabecera: cliente, prioridad, notas
select public.edit_work_order(
  p_order_id       => test.var('ord_edit')::uuid,
  p_items          => jsonb_build_array(jsonb_build_object(
                        'service_id', test.var('serv'), 'name', 'Lavado',
                        'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
  p_vehicle_category => 'suv',
  p_customer_name  => 'Cliente Corregido',
  p_priority       => 'alta',
  p_notes          => 'Cuidado con el parachoques');

select test.check('el nombre del cliente se corrigió',
  (select customer_name from public.work_orders where id = test.var('ord_edit')::uuid) = 'Cliente Corregido');
select test.check('la prioridad se subió a alta',
  (select priority from public.work_orders where id = test.var('ord_edit')::uuid) = 'alta');
select test.check('las observaciones se guardaron',
  (select notes from public.work_orders where id = test.var('ord_edit')::uuid) = 'Cuidado con el parachoques');

-- ---------------------------------------------------- La bitácora
set role postgres;
select test.check('editar queda en la bitácora',
  (select count(*) from public.audit_logs
    where action = 'EDITAR_ORDEN' and entity_id = test.var('ord_edit')) >= 1);
select test.check('con el antes y el después del total en el metadata',
  (select (metadata->'despues'->>'total_cents')::bigint from public.audit_logs
    where action = 'EDITAR_ORDEN' and entity_id = test.var('ord_edit')
    order by occurred_at desc limit 1) = 177000);
set role authenticated;

-- ---------------------------------------------------- Sin servicios se rechaza
select test.expect_error(
  'una orden sin servicios se rechaza',
  $$select public.edit_work_order(test.var('ord_edit')::uuid, '[]'::jsonb)$$
);

-- ---------------------------------------------------- El cajero no edita
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error(
  'un cajero NO puede editar una orden, ni llamando al API',
  $$select public.edit_work_order(
      test.var('ord_edit')::uuid,
      jsonb_build_array(jsonb_build_object(
        'service_id', test.var('serv'), 'name', 'Lavado',
        'quantity', 5, 'discount_cents', 0, 'is_membego_covered', false)))$$
);

set role postgres;
select test.check('y el total de la orden sigue como lo dejó el propietario',
  (select total_cents from public.work_orders where id = test.var('ord_edit')::uuid) = 177000);
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ---------------------------------------------------- Una orden FACTURADA no se edita
do $$
declare v_id uuid;
begin
  v_id := (public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'EDIT002-req',
    p_vehicle_plate    => 'EDIT002',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name', 'Lavado',
                            'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name    => 'Cliente Con Factura')).id;
  perform test.set_var('ord_edit_fac', v_id::text);

  perform public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'EDIT002-fac',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'item_type', 'service', 'service_id', test.var('serv')::uuid,
                            'product_id', null, 'name', 'Lavado', 'quantity', 1,
                            'discount_cents', 0, 'is_membego_covered', false)),
    p_payments         => jsonb_build_array(jsonb_build_object(
                            'method', 'tarjeta', 'amount_cents', 118000)),
    p_vehicle_category => 'sedan',
    p_work_order_id    => v_id,
    p_customer_name    => 'Cliente Con Factura');
end $$;

select test.expect_error(
  'una orden YA FACTURADA no se edita: reescribiría el importe de una factura con NCF',
  $$select public.edit_work_order(
      test.var('ord_edit_fac')::uuid,
      jsonb_build_array(jsonb_build_object(
        'service_id', test.var('serv'), 'name', 'Lavado',
        'quantity', 9, 'discount_cents', 0, 'is_membego_covered', false)))$$
);

-- ---------------------------------------------------- Una orden CANCELADA no se edita
do $$
declare v_id uuid;
begin
  v_id := (public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'EDIT003-req',
    p_vehicle_plate    => 'EDIT003',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name', 'Lavado',
                            'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name    => 'Cliente A Cancelar')).id;
  perform test.set_var('ord_edit_cnl', v_id::text);
  perform public.cancel_work_order(v_id, 'Registrada por error para la prueba');
end $$;

select test.expect_error(
  'una orden CANCELADA no se puede editar',
  $$select public.edit_work_order(
      test.var('ord_edit_cnl')::uuid,
      jsonb_build_array(jsonb_build_object(
        'service_id', test.var('serv'), 'name', 'Lavado',
        'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)))$$
);
