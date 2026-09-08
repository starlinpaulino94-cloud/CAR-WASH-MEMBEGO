-- =============================================================================
-- Comisiones por monto fijo y metas del lavador (migración 20260908160000).
-- Continúa sobre 10_rls_tests.sql y 30_orders_tests.sql (que dejó op1 y op2).
--
-- Todo lo de aquí es dinero que alguien cobra. Los dos errores caros:
--   · pagar de más — que un carro con dos servicios pague dos veces la tarifa
--     del lavador, o que asignar a dos personas duplique el costo;
--   · pagar de menos — que la tarifa del lavador no gane a la del servicio.
-- =============================================================================

set role postgres;
do $$
declare v_serv2 uuid;
begin
  -- Un servicio con su propia tarifa fija, para probar el respaldo.
  insert into public.services (company_id, code, name, description, estimated_minutes,
                               commission_kind, commission_amount_cents)
  values (test.var('c_a')::uuid, 'SRV-FIJO', 'Encerado', 'con tarifa fija', 20, 'monto', 5000)
  returning id into v_serv2;
  insert into public.service_prices (service_id, vehicle_category, price_cents)
  values (v_serv2, 'sedan', 60000);
  perform test.set_var('serv_fijo', v_serv2::text);

  -- Bahías propias de esta prueba. Reutilizar las de 30_orders arrastraba un
  -- «ya está ocupada» que, al ser el DO block una sola transacción, revertía
  -- TAMBIÉN la orden recién creada y el caso no llegaba a probarse.
  insert into public.bays (company_id, branch_id, name, type, status)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Bahía Comisiones A', 'lavado', 'disponible'),
         (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Bahía Comisiones B', 'lavado', 'disponible'),
         (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Bahía Comisiones C', 'lavado', 'disponible');
end $$;

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ------------------------------------------------- Tarifa fija del lavador
do $$
declare v_p public.profiles;
begin
  v_p := public.set_employee_pay(test.var('op1')::uuid, 'solo_comision', 0, 0, 0, 'monto', 15000);
  perform test.check('se le fija una tarifa de RD$150 por lavado',
    v_p.commission_kind = 'monto' and v_p.commission_amount_cents = 15000);
end $$;

select test.expect_error(
  'una comisión por monto sin importe se rechaza',
  format($q$select public.set_employee_pay(%L::uuid, 'solo_comision', 0, 0, 0, 'monto', 0)$q$,
         test.var('op1')));

-- Los guardas del original NO se perdieron al ampliar la función.
select test.expect_error(
  'un sueldo mensual sin importe se sigue rechazando',
  format($q$select public.set_employee_pay(%L::uuid, 'mensual', 0, 0, null)$q$, test.var('op1')));
select test.expect_error(
  'la comisión sigue sin poder editarse a mano',
  format($q$update public.profiles set commission_amount_cents = 99999 where id = %L$q$,
         test.var('op1')));

-- ------------------------------------------------- Un carro, DOS servicios
do $$
declare v_o public.work_orders; v_filas integer; v_total bigint;
begin
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-com-1',
    p_vehicle_plate=>'CM0001', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(
      jsonb_build_object('service_id',test.var('serv'),'name','Lavado','quantity',1,
        'discount_cents',0,'is_membego_covered',false),
      jsonb_build_object('service_id',test.var('serv_fijo'),'name','Encerado','quantity',1,
        'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Comision', p_assignees=>array[test.var('op1')::uuid]);

  perform public.advance_work_order(v_o.id, 'en_proceso', (select id from public.bays where name='Bahía Comisiones A'));
  perform public.advance_work_order(v_o.id, 'listo');
  perform public.advance_work_order(v_o.id, 'entregado');

  select count(*), coalesce(sum(amount_cents),0) into v_filas, v_total
    from public.commissions where work_order_id = v_o.id;

  -- EL caso que se paga caro: su tarifa es por el CARRO, no por cada servicio.
  perform test.check('un carro con dos servicios paga UNA vez la tarifa del lavador',
    v_filas = 1 and v_total = 15000, format('%s filas, %s', v_filas, v_total));
  perform test.check('y queda registrado CÓMO se calculó',
    exists (select 1 from public.commissions
             where work_order_id = v_o.id and commission_kind = 'monto'
               and rate_amount_cents = 15000));
  perform test.set_var('wo_com1', v_o.id::text);
end $$;

-- ------------------------------------------------- Dos lavadores, un carro
do $$
declare v_o public.work_orders; v_total bigint;
begin
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-com-2',
    p_vehicle_plate=>'CM0002', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Dos', p_assignees=>array[test.var('op1')::uuid, test.var('op2')::uuid]);

  perform public.advance_work_order(v_o.id, 'en_proceso', (select id from public.bays where name='Bahía Comisiones B'));
  perform public.advance_work_order(v_o.id, 'listo');
  perform public.advance_work_order(v_o.id, 'entregado');

  select coalesce(sum(amount_cents),0) into v_total
    from public.commissions c join public.profiles p on p.id = c.profile_id
   where c.work_order_id = v_o.id and p.commission_kind = 'monto';

  -- Asignar a dos personas no puede duplicar el costo del mismo lavado.
  perform test.check('la tarifa fija se REPARTE entre los que comparten el carro',
    v_total = 7500, v_total::text);
end $$;

-- ------------------------------------------------- Respaldo del servicio
do $$
declare v_o public.work_orders; v_monto bigint;
begin
  -- op2 sin tarifa propia: manda la del servicio (RD$50 del encerado).
  perform public.set_employee_pay(test.var('op2')::uuid, 'solo_comision', 0, 0, 0, 'porcentaje', 0);

  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-com-3',
    p_vehicle_plate=>'CM0003', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id',test.var('serv_fijo'),
      'name','Encerado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Respaldo', p_assignees=>array[test.var('op2')::uuid]);

  perform public.advance_work_order(v_o.id, 'en_proceso', (select id from public.bays where name='Bahía Comisiones C'));
  perform public.advance_work_order(v_o.id, 'listo');
  perform public.advance_work_order(v_o.id, 'entregado');

  select coalesce(sum(amount_cents),0) into v_monto
    from public.commissions where work_order_id = v_o.id;
  perform test.check('sin tarifa propia se usa la del servicio', v_monto = 5000, v_monto::text);
end $$;

-- ------------------------------------------------- Metas
do $$
declare v_g public.washer_goals;
begin
  v_g := public.upsert_washer_goal(
    test.var('op1')::uuid, current_date - 15, current_date + 15, 60, 4000000, 'Quincena');
  perform test.check('se fija la meta de la quincena',
    v_g.target_washes = 60 and v_g.target_revenue_cents = 4000000);

  -- Corregirla no crea una segunda: dos metas del mismo periodo se
  -- contradirían y nadie sabría cuál es la buena.
  v_g := public.upsert_washer_goal(
    test.var('op1')::uuid, current_date - 15, current_date + 15, 80, null, 'Corregida');
  perform test.check('corregirla la reemplaza, no la duplica', v_g.target_washes = 80);
  perform test.check('y solo hay una',
    (select count(*) from public.washer_goals where profile_id = test.var('op1')::uuid) = 1);
end $$;

select test.expect_error(
  'una meta sin ningún número se rechaza',
  format($q$select public.upsert_washer_goal(%L::uuid, current_date, current_date + 10, 0, 0)$q$,
         test.var('op1')));
select test.expect_error(
  'un periodo que termina antes de empezar se rechaza',
  format($q$select public.upsert_washer_goal(%L::uuid, current_date, current_date - 5, 10)$q$,
         test.var('op1')));
select test.expect_error(
  'no se le pone meta a alguien de otra empresa',
  format($q$select public.upsert_washer_goal(%L::uuid, current_date, current_date + 10, 10)$q$,
         test.var('u_owner_b')));

-- ------------------------------------------------- El informe
do $$
declare r record;
begin
  select * into r from public.washer_performance(current_date - 30, current_date + 1)
   where profile_id = test.var('op1')::uuid;

  perform test.check('el informe cuenta sus lavados', r.lavados >= 2, r.lavados::text);
  perform test.check('y lo que generó para el negocio', r.generado_cents > 0, r.generado_cents::text);
  perform test.check('y lo que se lleva de comisión', r.comision_cents > 0, r.comision_cents::text);
  perform test.check('y qué parte de lo generado le cuesta al negocio',
    r.costo_bps > 0 and r.costo_bps <= 10000, r.costo_bps::text);
  perform test.check('y arrastra su meta', r.meta_lavados = 80, coalesce(r.meta_lavados,-1)::text);
end $$;

-- Lo generado por el equipo no puede pasar de lo facturado por el negocio.
do $$
declare v_suma bigint; v_facturado bigint;
begin
  select coalesce(sum(generado_cents),0) into v_suma
    from public.washer_performance(current_date - 30, current_date + 1);
  select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0) into v_facturado
    from public.work_order_items i
    join public.work_orders o on o.id = i.work_order_id
   where o.company_id = test.var('c_a')::uuid and o.status = 'entregado'
     and i.item_type = 'service'
     and o.delivered_at::date between current_date - 30 and current_date + 1;

  -- Si a cada lavador se le acreditara el carro entero, esto no cuadraría.
  perform test.check('lo generado por el equipo cuadra con lo facturado',
    v_suma <= v_facturado, format('equipo=%s facturado=%s', v_suma, v_facturado));
end $$;

set role postgres;
