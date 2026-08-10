-- =============================================================================
-- Pruebas de multisucursal (migración 0031)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls). Lo que se demuestra: el branch_id deja de
-- ser decorativo, nadie se amplía su propio alcance, y quien queda limitado a
-- una sucursal no ve —ni puede crear— nada de la otra.
-- =============================================================================

set role postgres;
-- 10_rls no dejó variable para la sucursal de Beta y aquí hace falta un id
-- ajeno DE VERDAD: con NULL, los casos «de otra empresa» pasarían por accidente.
select test.set_var('b_beta',
  (select id::text from public.branches where company_id = test.var('c_b')::uuid limit 1));

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ============================================================ Alta y bajas
select test.expect_error('una sucursal sin nombre se rechaza',
  $q$select public.upsert_branch('   ')$q$);

select test.set_var('suc2',
  (public.upsert_branch('Sucursal Autopista', null, 'Km 12', '809-555-0700')).id::text);

select test.check('la sucursal nueva nace activa y no principal',
  (select is_active and not is_main from public.branches where id = test.var('suc2')::uuid));

select test.check('el alta quedó en la bitácora',
  (select count(*) = 1 from public.audit_logs
    where action = 'CREAR_SUCURSAL' and entity_id = test.var('suc2')::uuid));

-- La principal se CEDE: nombrar otra deja a la anterior de secundaria, en vez
-- de reventar contra el índice único con un error ilegible.
do $$
begin
  perform public.upsert_branch('Sucursal Autopista', test.var('suc2')::uuid,
    null, null, true, true);
end $$;

select test.check('nombrar una principal se la quita a la anterior',
  (select count(*) = 1 from public.branches
    where company_id = test.var('c_a')::uuid and is_main)
  and (select is_main from public.branches where id = test.var('suc2')::uuid));

select test.expect_error('la sucursal principal no se desactiva',
  format($q$select public.upsert_branch('Sucursal Autopista', %L::uuid, null, null, true, false)$q$,
         test.var('suc2')));

-- Se devuelve la principal a la original para el resto de las pruebas.
do $$
begin
  perform public.upsert_branch('Sucursal Centro', test.var('b_a')::uuid, null, null, true, true);
end $$;

set role postgres;
insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
values (test.var('c_a')::uuid, test.var('suc2')::uuid, test.var('u_cashier_a')::uuid, 100000);
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('no se desactiva una sucursal con la caja abierta',
  format($q$select public.upsert_branch('Sucursal Autopista', %L::uuid, null, null, false, false)$q$,
         test.var('suc2')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no administra sucursales',
  $q$select public.upsert_branch('Sucursal Pirata')$q$);

-- ==================================================== Alcance: quién lo fija
select test.expect_error('un cajero no asigna sucursales',
  format($q$select public.set_employee_branch(%L::uuid, %L::uuid, 'sucursal')$q$,
         test.var('u_cashier_a'), test.var('suc2')));

-- El guardia: ni por la puerta de atrás.
select test.expect_error('nadie se cambia el alcance con un UPDATE directo',
  format($q$update public.profiles set branch_scope = 'sucursal' where id = %L$q$,
         test.var('u_cashier_a')));
select test.expect_error('nadie se muda de sucursal con un UPDATE directo',
  format($q$update public.profiles set branch_id = %L where id = %L$q$,
         test.var('suc2'), test.var('u_cashier_a')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('nadie cambia su PROPIO alcance, ni el propietario',
  format($q$select public.set_employee_branch(%L::uuid, %L::uuid, 'sucursal')$q$,
         test.var('u_owner_a'), test.var('b_a')));

select test.expect_error('limitar a una sucursal exige decir cuál',
  format($q$select public.set_employee_branch(%L::uuid, null, 'sucursal')$q$,
         test.var('u_cashier_a')));

select test.expect_error('no se asigna una sucursal de otra empresa',
  format($q$select public.set_employee_branch(%L::uuid, %L::uuid, 'sucursal')$q$,
         test.var('u_cashier_a'), test.var('b_beta')));

-- ============================================== La frontera, ya en efecto
-- Datos en la sucursal nueva, creados por el propietario (alcance «todas»).
do $$
declare v_bay uuid;
begin
  insert into public.bays (company_id, branch_id, name, type)
  values (test.var('c_a')::uuid, test.var('suc2')::uuid, 'Bahía Autopista', 'lavado')
  returning id into v_bay;
  perform test.set_var('bay_suc2', v_bay::text);

  perform public.create_work_order(
    p_branch_id => test.var('suc2')::uuid,
    p_client_request_id => 'suc2-wo-1',
    p_vehicle_plate => 'SC0001',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Cliente Autopista');
end $$;

select test.check('el propietario, con alcance «todas», ve las dos sucursales',
  (select count(distinct branch_id) >= 2 from public.work_orders
    where company_id = test.var('c_a')::uuid));

-- Ahora se limita al cajero a la sucursal del centro.
do $$
begin
  perform public.set_employee_branch(test.var('u_cashier_a')::uuid,
    test.var('b_a')::uuid, 'sucursal');
end $$;

select test.check('el alcance del cajero quedó limitado a su sucursal',
  (select branch_scope = 'sucursal' and branch_id = test.var('b_a')::uuid
     from public.profiles where id = test.var('u_cashier_a')::uuid));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.check('el cajero limitado NO ve las órdenes de la otra sucursal',
  (select count(*) = 0 from public.work_orders
    where branch_id = test.var('suc2')::uuid));

select test.check('el cajero limitado sí sigue viendo las de la suya',
  (select count(*) > 0 from public.work_orders
    where branch_id = test.var('b_a')::uuid));

select test.check('tampoco ve las bahías de la otra sucursal',
  (select count(*) = 0 from public.bays where branch_id = test.var('suc2')::uuid));

select test.expect_error('el cajero limitado no puede CREAR nada en la otra sucursal',
  format($q$select public.create_work_order(%L::uuid,'suc2-pirata','PR0001','sedan',
    jsonb_build_array(jsonb_build_object('service_id',%L,'name','Lavado',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)))$q$,
    test.var('suc2'), test.var('serv')));

-- El catálogo y el directorio NO se parten por sucursal: son de empresa.
select test.check('el catálogo de servicios sigue completo para el cajero limitado',
  (select count(*) > 0 from public.services where company_id = test.var('c_a')::uuid));
select test.check('el directorio de clientes sigue completo: el cliente es de la empresa',
  (select count(*) > 0 from public.customers where company_id = test.var('c_a')::uuid));

-- ==================================================== Reporte por sucursal
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('no se pide el reporte de una sucursal ajena',
  format($q$select public.management_report(current_date - 30, current_date, %L::uuid)$q$,
         test.var('b_beta')));

select test.check('el reporte declara la sucursal que se miró',
  (public.management_report(current_date - 30, current_date, test.var('b_a')::uuid)
     ->> 'branch_id')::uuid = test.var('b_a')::uuid);

select test.check('el reporte sin sucursal consolida y con sucursal acota',
  (public.management_report(current_date - 30, current_date) #>> '{sales,total_cents}')::bigint
  >= (public.management_report(current_date - 30, current_date, test.var('b_a')::uuid)
        #>> '{sales,total_cents}')::bigint);

select test.check('el reporte trae las cuentas por cobrar vigentes',
  (public.management_report(current_date - 30, current_date) ? 'receivables_cents'));

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve las sucursales de Alfa',
  (select count(*) = 0 from public.branches where company_id = test.var('c_a')::uuid));
select test.expect_error('Beta no edita una sucursal de Alfa',
  format($q$select public.upsert_branch('Robada', %L::uuid)$q$, test.var('suc2')));
select test.expect_error('Beta no asigna sucursal a un empleado de Alfa',
  format($q$select public.set_employee_branch(%L::uuid, %L::uuid, 'sucursal')$q$,
         test.var('u_cashier_a'), test.var('suc2')));

-- Se devuelve el alcance del cajero para no alterar pruebas posteriores.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
do $$
begin
  perform public.set_employee_branch(test.var('u_cashier_a')::uuid,
    test.var('b_a')::uuid, 'todas');
end $$;

set role postgres;
