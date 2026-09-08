-- =============================================================================
-- Empleado SIN acceso al sistema (migración 20260908120000).
-- Continúa sobre los datos de 10_rls_tests.sql y 30_orders_tests.sql.
--
-- Lo que se protege: que se pueda registrar a un lavador sin inventarle una
-- credencial, y que esa ficha sin llave NO pueda acabar mandando. Un
-- administrador fantasma que no puede entrar haría creer al candado del último
-- jefe que queda alguien al mando cuando no queda nadie.
-- =============================================================================

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_p public.profiles;
begin
  v_p := public.create_staff_no_login('Lavador Sin Cuenta');

  perform test.check('se registra el lavador sin crear cuenta',
    v_p.id is not null and v_p.full_name = 'Lavador Sin Cuenta');
  perform test.check('queda marcado como sin acceso', v_p.has_login = false);
  perform test.check('sin correo: no hay credencial que filtrar', v_p.email is null);
  perform test.check('nace activo, listo para recibir trabajo', v_p.is_active);
  perform test.check('y con rol de operario', v_p.role = 'operario', v_p.role::text);

  perform test.set_var('lav_sin_cuenta', v_p.id::text);
end $$;

-- Lo que de verdad importa: que NO exista cuenta detrás. Va como postgres
-- porque `authenticated` no puede leer auth.users (y es correcto que no pueda).
set role postgres;
select test.check('no se creó ningún usuario de acceso',
  not exists (select 1 from auth.users where id = test.var('lav_sin_cuenta')::uuid));

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Puede recibir trabajo como cualquier otro lavador: es el punto de todo esto.
do $$
declare v_o public.work_orders; v_n integer;
begin
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'wo-sin-cuenta',
    p_vehicle_plate=>'SC0001', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente', p_assignees=>array[test.var('lav_sin_cuenta')::uuid]);

  select count(*) into v_n from public.work_order_assignees where work_order_id = v_o.id;
  perform test.check('a un lavador sin cuenta SÍ se le puede asignar el carro', v_n = 1, v_n::text);
end $$;

-- ------------------------------------------------- Rechazos
select test.expect_error(
  'una ficha sin cuenta NO puede ser administrador',
  $q$select public.create_staff_no_login('Fantasma', 'administrador')$q$);

select test.expect_error(
  'ni propietario',
  $q$select public.create_staff_no_login('Fantasma', 'propietario')$q$);

select test.expect_error(
  'ni cajero: quien cobra necesita entrar',
  $q$select public.create_staff_no_login('Fantasma', 'cajero')$q$);

select test.expect_error(
  'el nombre es obligatorio',
  $q$select public.create_staff_no_login('  ')$q$);

select test.expect_error(
  'no se puede colar en una sucursal de otra empresa',
  format($q$select public.create_staff_no_login('Ajeno', 'operario', %L::uuid)$q$,
         test.var('branch_b')));

-- Un cajero no da de alta a nadie.
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
select test.expect_error(
  'un cajero no puede registrar empleados',
  $q$select public.create_staff_no_login('Colado')$q$);

-- ------------------------------------------------- El arrastre al borrar cuenta
set role postgres;
do $$
declare v_uid uuid; v_quedan integer;
begin
  -- Una cuenta con ficha, como las que ya existen.
  insert into auth.users (email) values ('temporal@example.com') returning id into v_uid;
  update public.profiles set company_id = test.var('c_a')::uuid, role = 'operario',
         full_name = 'Con Cuenta' where id = v_uid;

  delete from auth.users where id = v_uid;

  select count(*) into v_quedan from public.profiles where id = v_uid;
  -- Sin esto quedaría la ficha de alguien que ya no puede entrar.
  perform test.check('borrar la cuenta sigue llevándose su ficha', v_quedan = 0, v_quedan::text);
end $$;

do $$
declare v_quedan integer;
begin
  select count(*) into v_quedan from public.profiles where id = test.var('lav_sin_cuenta')::uuid;
  perform test.check('y el lavador sin cuenta NO se ve afectado por eso',
    v_quedan = 1, v_quedan::text);
end $$;
