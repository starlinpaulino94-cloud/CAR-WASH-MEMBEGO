-- =============================================================================
-- Pruebas de órdenes de trabajo: máquina de estados, bahías y comisiones
-- (migración 0010). Continúa sobre los datos de 10_rls_tests.sql.
-- =============================================================================

set role postgres;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_b uuid := test.var('b_a')::uuid;
  v_serv uuid := test.var('serv')::uuid;
  v_bay1 uuid; v_bay2 uuid; v_bay3 uuid; v_op1 uuid; v_op2 uuid;
begin
  -- Dos bahías utilizables y una en mantenimiento.
  insert into public.bays (company_id, branch_id, name, type, status)
    values (v_c, v_b, 'Bahía 1', 'lavado', 'disponible') returning id into v_bay1;
  insert into public.bays (company_id, branch_id, name, type, status)
    values (v_c, v_b, 'Bahía 2', 'lavado', 'disponible') returning id into v_bay2;
  insert into public.bays (company_id, branch_id, name, type, status)
    values (v_c, v_b, 'Bahía 3', 'lavado', 'mantenimiento') returning id into v_bay3;

  -- Dos operarios con tasas de comisión distintas. Desde 0030 la comisión está
  -- protegida por un guardia (nadie se sube la suya con un UPDATE), así que el
  -- montaje declara el contexto igual que hace set_employee_pay().
  insert into auth.users (email) values ('op1@example.com') returning id into v_op1;
  insert into auth.users (email) values ('op2@example.com') returning id into v_op2;
  perform set_config('app.payroll_ctx', 'ok', true);
  update public.profiles set company_id=v_c, branch_id=v_b, role='operario',
         full_name='Operario Uno', commission_bps=1000 where id=v_op1;
  update public.profiles set company_id=v_c, branch_id=v_b, role='operario',
         full_name='Operario Dos', commission_bps=2000 where id=v_op2;
  perform set_config('app.payroll_ctx', '', true);

  perform test.set_var('bay1', v_bay1::text);
  perform test.set_var('bay2', v_bay2::text);
  perform test.set_var('bay3', v_bay3::text);
  perform test.set_var('op1', v_op1::text);
  perform test.set_var('op2', v_op2::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- =============================================================== Creación

do $$
declare v_o public.work_orders;
begin
  v_o := public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'wo-req-1',
    p_vehicle_plate    => 'x-999 88',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name','Lavado',
                            'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name    => 'Cliente Orden',
    p_customer_phone   => '809-555-0900');

  perform test.check('la orden nace en estado pendiente con numeración de servidor',
    v_o.status = 'pendiente' and v_o.order_number like 'CW-%',
    format('%s / %s', v_o.order_number, v_o.status));

  perform test.check('los totales se derivan del catálogo, no del cliente',
    v_o.subtotal_cents = 100000 and v_o.tax_cents = 18000 and v_o.total_cents = 118000,
    format('sub=%s tax=%s total=%s', v_o.subtotal_cents, v_o.tax_cents, v_o.total_cents));

  perform test.check('la placa queda normalizada',
    v_o.vehicle_plate = 'X99988', v_o.vehicle_plate);

  perform test.set_var('wo1', v_o.id::text);
end $$;

select test.check('crear la orden dio de alta el vehículo',
  (select count(*) = 1 from public.vehicles where plate = 'X99988'));

select test.check('crear la orden dio de alta el cliente',
  (select count(*) = 1 from public.customers where name = 'Cliente Orden'));

-- Un nombre sin teléfono también debe quedar registrado: si la recepción se
-- molestó en preguntarlo, es información que vale.
do $$
declare v_o public.work_orders;
begin
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-req-nombre',
    p_vehicle_plate=>'NM1234', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Solo Nombre');
  perform test.check('un cliente con nombre y sin teléfono también se registra',
    v_o.customer_id is not null
    and (select count(*) = 1 from public.customers where name = 'Solo Nombre'));
end $$;

-- Y un visitante anónimo NO debe ensuciar el directorio con duplicados.
do $$
declare v_o public.work_orders; v_before integer;
begin
  select count(*) into v_before from public.customers;
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-req-anon',
    p_vehicle_plate=>'AN0001', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)));
  perform test.check('un visitante anónimo no crea ficha de cliente',
    v_o.customer_id is null
    and (select count(*) from public.customers) = v_before
    and v_o.customer_name = 'Cliente General',
    format('cliente=%s nombre=%s', coalesce(v_o.customer_id::text,'nulo'), v_o.customer_name));
end $$;

-- Idempotencia.
do $$
declare v_a public.work_orders; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.work_orders;
  v_a := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-req-1',
    p_vehicle_plate=>'X99988', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)));
  select count(*) into v_after from public.work_orders;
  perform test.check('el doble registro de llegada devuelve la MISMA orden',
    v_a.id = test.var('wo1')::uuid and v_before = v_after,
    format('antes=%s después=%s', v_before, v_after));
end $$;

select test.expect_error('una orden sin servicios se rechaza',
  format($q$select public.create_work_order(%L::uuid,'wo-vacia','ZZ111','sedan','[]'::jsonb)$q$,
         test.var('b_a')));

select test.expect_error('una orden sin placa se rechaza',
  format($q$select public.create_work_order(%L::uuid,'wo-sinplaca','  ','sedan',
    jsonb_build_array(jsonb_build_object('service_id',%L,'name','L','quantity',1,
      'discount_cents',0,'is_membego_covered',false)))$q$,
    test.var('b_a'), test.var('serv')));

-- =============================================================== Transiciones

select test.expect_error('no se puede saltar de pendiente a entregado',
  format('select public.advance_work_order(%L::uuid, ''entregado'')', test.var('wo1')));

select test.expect_error('no se puede iniciar el lavado sin indicar bahía',
  format('select public.advance_work_order(%L::uuid, ''en_proceso'')', test.var('wo1')));

select test.expect_error('no se puede usar una bahía en mantenimiento',
  format('select public.advance_work_order(%L::uuid, ''en_proceso'', %L::uuid)',
         test.var('wo1'), test.var('bay3')));

-- Camino correcto: pendiente → en_espera → en_proceso.
do $$
begin
  perform public.advance_work_order(test.var('wo1')::uuid, 'en_espera');
  perform public.advance_work_order(test.var('wo1')::uuid, 'en_proceso',
    test.var('bay1')::uuid,
    array[test.var('op1')::uuid, test.var('op2')::uuid]);
end $$;

select test.check('iniciar el lavado OCUPA la bahía y la vincula a la orden',
  (select status = 'ocupada' and current_work_order_id = test.var('wo1')::uuid
     from public.bays where id = test.var('bay1')::uuid),
  (select status::text from public.bays where id = test.var('bay1')::uuid));

select test.check('la orden guarda la bahía asignada',
  (select bay_id = test.var('bay1')::uuid from public.work_orders where id = test.var('wo1')::uuid));

select test.check('los operarios quedan asignados como relación',
  (select count(*) = 2 from public.work_order_assignees where work_order_id = test.var('wo1')::uuid));

-- Capacidad: una segunda orden no puede entrar en la misma bahía.
do $$
declare v_o2 public.work_orders;
begin
  v_o2 := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-req-2',
    p_vehicle_plate=>'Y77766', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)));
  perform test.set_var('wo2', v_o2.id::text);
end $$;

select test.expect_error('una bahía ocupada rechaza un segundo vehículo',
  format('select public.advance_work_order(%L::uuid, ''en_proceso'', %L::uuid)',
         test.var('wo2'), test.var('bay1')));

select test.check('la segunda orden sigue sin bahía tras el intento',
  (select bay_id is null and status = 'pendiente'
     from public.work_orders where id = test.var('wo2')::uuid));

-- La bahía libre sí admite el vehículo.
do $$
begin
  perform public.advance_work_order(test.var('wo2')::uuid, 'en_proceso', test.var('bay2')::uuid);
end $$;

select test.check('otra bahía disponible sí admite el vehículo',
  (select status = 'ocupada' from public.bays where id = test.var('bay2')::uuid));

-- Salir de lavado LIBERA la bahía. En la aplicación auditada no ocurría nunca.
do $$
begin
  perform public.advance_work_order(test.var('wo1')::uuid, 'control_calidad');
end $$;

select test.check('salir de lavado libera la bahía',
  (select status = 'disponible' and current_work_order_id is null
     from public.bays where id = test.var('bay1')::uuid),
  (select status::text from public.bays where id = test.var('bay1')::uuid));

select test.check('la orden deja de apuntar a la bahía',
  (select bay_id is null from public.work_orders where id = test.var('wo1')::uuid));

-- Repaso: control_calidad puede volver a en_proceso.
do $$
begin
  perform public.advance_work_order(test.var('wo1')::uuid, 'en_proceso', test.var('bay1')::uuid);
  perform public.advance_work_order(test.var('wo1')::uuid, 'listo');
end $$;

select test.check('se admite devolver a lavado desde control de calidad',
  (select status = 'listo' from public.work_orders where id = test.var('wo1')::uuid));

-- =============================================================== Comisiones

do $$
begin
  perform public.advance_work_order(test.var('wo1')::uuid, 'entregado');
end $$;

-- Las comisiones son datos de nómina: el cajero NO puede verlas (política
-- correcta), así que se comprueban con un rol autorizado.
do $$
begin
  set local role postgres;

  perform test.check('al entregar se generan comisiones (antes no se generaban nunca)',
    (select count(*) = 2 from public.commissions where work_order_id = test.var('wo1')::uuid),
    (select count(*)::text from public.commissions where work_order_id = test.var('wo1')::uuid));

  -- Línea de 1.000,00 repartida entre 2 operarios = 500,00 de base cada uno.
  -- Operario Uno al 10% = 50,00 ; Operario Dos al 20% = 100,00.
  perform test.check('cada operario cobra su propia tasa sobre su parte',
    (select amount_cents from public.commissions
      where work_order_id = test.var('wo1')::uuid and profile_id = test.var('op1')::uuid) = 5000
    and (select amount_cents from public.commissions
      where work_order_id = test.var('wo1')::uuid and profile_id = test.var('op2')::uuid) = 10000,
    (select string_agg(amount_cents::text, ' / ' order by amount_cents)
       from public.commissions where work_order_id = test.var('wo1')::uuid));

  set local role authenticated;
end $$;

-- Y que el cajero, efectivamente, NO las ve.
select test.check('un cajero no puede consultar las comisiones del equipo',
  (select count(*) = 0 from public.commissions));

select test.check('entregar contabiliza la visita del cliente',
  (select total_visits = 1 from public.customers where name = 'Cliente Orden'));

select test.expect_error('una orden entregada es terminal',
  format('select public.advance_work_order(%L::uuid, ''en_proceso'', %L::uuid)',
         test.var('wo1'), test.var('bay1')));

-- =============================================================== Aislamiento

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('la empresa Beta no ve las órdenes creadas por Alfa',
  (select count(*) = 0 from public.work_orders where vehicle_plate in ('X99988','Y77766')));

select test.expect_error('la empresa Beta no puede mover una orden de Alfa',
  format('select public.advance_work_order(%L::uuid, ''cancelado'')', test.var('wo2')));

select test.check('la empresa Beta no ve las comisiones de Alfa',
  (select count(*) = 0 from public.commissions));

reset role;
