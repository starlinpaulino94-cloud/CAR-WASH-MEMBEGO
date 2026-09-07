-- =============================================================================
-- Asignar el LAVADOR en la llegada (migración 20260907170000).
-- Continúa sobre los datos de 10_rls_tests.sql y 30_orders_tests.sql (que dejó
-- dos operarios: 'op1' y 'op2').
--
-- Lo que se protege aquí es quién puede acabar cobrando una comisión: los
-- asignados en la llegada son exactamente los que, al entregar la orden,
-- reparten el importe. Colar un id ajeno o de alguien dado de baja no es un
-- detalle de validación — es dinero a quien no trabajó.
-- =============================================================================

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- ------------------------------------------------- Llegada CON lavador
do $$
declare v_o public.work_orders; v_n integer;
begin
  v_o := public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'wo-lav-1',
    p_vehicle_plate    => 'LAV-001',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name','Lavado',
                            'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name    => 'Cliente Con Lavador',
    p_assignees        => array[test.var('op1')::uuid]);

  perform test.check('con lavador asignado la orden nace ASIGNADA, no pendiente',
    v_o.status = 'asignada', v_o.status::text);

  select count(*) into v_n from public.work_order_assignees where work_order_id = v_o.id;
  perform test.check('el lavador queda asignado a la orden desde la llegada', v_n = 1, v_n::text);

  perform test.set_var('wo_lav', v_o.id::text);
end $$;

-- ------------------------------------------------- Llegada SIN lavador
do $$
declare v_o public.work_orders; v_n integer;
begin
  v_o := public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'wo-lav-2',
    p_vehicle_plate    => 'LAV-002',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name','Lavado',
                            'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name    => 'Cliente Sin Lavador');

  -- Recibir el carro y decidir después sigue siendo válido: la recepción no
  -- puede quedarse bloqueada porque aún no se sepa quién lo lava.
  perform test.check('sin lavador la llegada sigue siendo válida y nace pendiente',
    v_o.status = 'pendiente', v_o.status::text);

  select count(*) into v_n from public.work_order_assignees where work_order_id = v_o.id;
  perform test.check('y no inventa asignaciones', v_n = 0, v_n::text);
end $$;

-- ------------------------------------------------- Varios lavadores
do $$
declare v_o public.work_orders; v_n integer;
begin
  v_o := public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'wo-lav-3',
    p_vehicle_plate    => 'LAV-003',
    p_vehicle_category => 'suv',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name','Lavado',
                            'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name    => 'Cliente Dos Lavadores',
    -- El mismo dos veces: un doble toque en la lista no puede duplicar a nadie,
    -- o al entregar cobraría comisión por partida doble.
    p_assignees        => array[test.var('op1')::uuid, test.var('op2')::uuid, test.var('op1')::uuid]);

  select count(*) into v_n from public.work_order_assignees where work_order_id = v_o.id;
  perform test.check('dos lavadores quedan asignados y el repetido no se duplica',
    v_n = 2, v_n::text);
end $$;

-- ------------------------------------------------- Rechazos
select test.expect_error(
  'un lavador de OTRA empresa no puede asignarse',
  format($q$select public.create_work_order(%L::uuid,'wo-lav-ajeno','AJ0001','sedan',
     jsonb_build_array(jsonb_build_object('service_id',%L,'name','Lavado','quantity',1,
       'discount_cents',0,'is_membego_covered',false)),
     'Cliente', null, null, '', '', '', 'normal', null, array[%L::uuid])$q$,
    test.var('b_a'), test.var('serv'), test.var('u_cashier_b')));

select test.expect_error(
  'un id que no existe tampoco',
  format($q$select public.create_work_order(%L::uuid,'wo-lav-fantasma','FN0001','sedan',
     jsonb_build_array(jsonb_build_object('service_id',%L,'name','Lavado','quantity',1,
       'discount_cents',0,'is_membego_covered',false)),
     'Cliente', null, null, '', '', '', 'normal', null,
     array['00000000-0000-0000-0000-000000000000'::uuid])$q$,
    test.var('b_a'), test.var('serv')));

-- Un empleado dado de baja no puede recibir trabajo nuevo (ni la comisión que
-- vendría después).
set role postgres;
do $$
begin
  update public.profiles set is_active = false where id = test.var('op2')::uuid;
end $$;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error(
  'un lavador dado de baja no puede recibir una orden',
  format($q$select public.create_work_order(%L::uuid,'wo-lav-baja','BJ0001','sedan',
     jsonb_build_array(jsonb_build_object('service_id',%L,'name','Lavado','quantity',1,
       'discount_cents',0,'is_membego_covered',false)),
     'Cliente', null, null, '', '', '', 'normal', null, array[%L::uuid])$q$,
    test.var('b_a'), test.var('serv'), test.var('op2')));

set role postgres;
do $$
begin
  update public.profiles set is_active = true where id = test.var('op2')::uuid;
end $$;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- ------------------------------------------------- Idempotencia
do $$
declare v_a public.work_orders; v_b public.work_orders; v_n integer;
begin
  v_a := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-lav-idem',
    p_vehicle_plate=>'ID0001', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Idem', p_assignees=>array[test.var('op1')::uuid]);
  v_b := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-lav-idem',
    p_vehicle_plate=>'ID0001', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Idem', p_assignees=>array[test.var('op1')::uuid]);

  perform test.check('un segundo toque en Registrar llegada devuelve la MISMA orden',
    v_a.id = v_b.id);
  select count(*) into v_n from public.work_order_assignees where work_order_id = v_a.id;
  perform test.check('y no vuelve a asignar al lavador', v_n = 1, v_n::text);
end $$;

set role postgres;
