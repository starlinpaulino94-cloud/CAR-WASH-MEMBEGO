-- =============================================================================
-- Pruebas de cancelar órdenes y eliminar empleados (migración 0041)
-- =============================================================================
-- Lo que se demuestra:
--   CANCELAR
--     · cancelar exige motivo, y sin él se rechaza;
--     · un cajero no puede cancelar, ni llamando al API;
--     · una orden FACTURADA no se cancela — este es el importante: dejaría una
--       factura con NCF apuntando a un lavado que el sistema niega;
--     · cancelar dos veces no es un error;
--     · la bahía queda libre;
--     · una orden entregada no se cancela.
--   EMPLEADOS
--     · nadie se borra a sí mismo;
--     · no se borra al último administrador activo — sería un bloqueo sin
--       arreglo desde dentro del sistema;
--     · quien tiene acciones en la bitácora no se borra, y se dice cuántas;
--     · una ficha recién creada que nunca trabajó sí se borra;
--     · un cajero no puede borrar empleados.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ##################################################### CANCELAR ÓRDENES

-- Una orden nueva sobre la que trabajar.
do $$
declare v_id uuid;
begin
  v_id := (public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'CNL001-req',
    p_vehicle_plate    => 'CNL001',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name', 'Lavado',
                            'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name    => 'Cliente Cancelable')).id;
  perform test.set_var('ord_cnl', v_id::text);
end $$;

select test.expect_error(
  'cancelar sin motivo se rechaza',
  $$select public.cancel_work_order(test.var('ord_cnl')::uuid, '')$$
);
select test.expect_error(
  'y un motivo de dos letras tampoco vale',
  $$select public.cancel_work_order(test.var('ord_cnl')::uuid, 'ok')$$
);

select test.check('la orden sigue viva tras los intentos sin motivo',
  (select status::text from public.work_orders where id = test.var('ord_cnl')::uuid) <> 'cancelado');

-- ---------------------------------------------------- El cajero no cancela
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error(
  'un cajero NO puede cancelar una orden, ni llamando al API',
  $$select public.cancel_work_order(test.var('ord_cnl')::uuid, 'Me equivoqué al registrarla')$$
);

set role postgres;
select test.check('y la orden sigue como estaba',
  (select status::text from public.work_orders where id = test.var('ord_cnl')::uuid) <> 'cancelado');
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ---------------------------------------------------- Cancelar de verdad
select public.cancel_work_order(test.var('ord_cnl')::uuid, 'Registrada con el cliente equivocado');

select test.check('la orden queda cancelada',
  (select status::text from public.work_orders where id = test.var('ord_cnl')::uuid) = 'cancelado');
select test.check('con su motivo guardado',
  (select cancel_reason from public.work_orders where id = test.var('ord_cnl')::uuid)
    = 'Registrada con el cliente equivocado');
select test.check('quién la canceló y cuándo',
  (select cancelled_by = test.var('u_owner_a')::uuid and cancelled_at is not null
     from public.work_orders where id = test.var('ord_cnl')::uuid));

set role postgres;
select test.check('y queda en la bitácora',
  (select count(*) from public.audit_logs
    where action = 'CANCELAR_ORDEN' and entity_id = test.var('ord_cnl')) = 1);
set role authenticated;

-- Repetir no es un error: es la respuesta correcta a un segundo clic.
select public.cancel_work_order(test.var('ord_cnl')::uuid, 'Otro motivo cualquiera');
select test.check('cancelar dos veces no es un error y NO reescribe el motivo',
  (select cancel_reason from public.work_orders where id = test.var('ord_cnl')::uuid)
    = 'Registrada con el cliente equivocado');

-- ---------------------------------------------------- La bahía queda libre
do $$
declare v_id uuid; v_bahia uuid;
begin
  v_id := (public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'CNL002-req',
    p_vehicle_plate    => 'CNL002',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name', 'Lavado',
                            'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name    => 'Cliente En Bahia')).id;
  perform test.set_var('ord_bahia', v_id::text);

  select id into v_bahia from public.bays
   where company_id = test.var('c_a')::uuid and status = 'disponible' limit 1;
  perform test.set_var('bahia_cnl', v_bahia::text);

  perform public.advance_work_order(v_id, 'en_proceso', v_bahia, null);
end $$;

select test.check('la bahía se ocupó al iniciar el lavado',
  (select status::text from public.bays where id = test.var('bahia_cnl')::uuid) = 'ocupada');

select public.cancel_work_order(test.var('ord_bahia')::uuid, 'El cliente se llevó el carro');

select test.check('cancelar libera la bahía: no se queda ocupada por un lavado que no existe',
  (select status::text from public.bays where id = test.var('bahia_cnl')::uuid) = 'disponible');
select test.check('y sin orden colgando de ella',
  (select current_work_order_id is null from public.bays where id = test.var('bahia_cnl')::uuid));

-- ---------------------------------------------------- LA ORDEN FACTURADA
-- El caso que de verdad importa: facturar una orden a medio lavar y después
-- cancelarla dejaría una factura emitida, con su NCF, señalando un lavado que
-- el sistema dice que nunca ocurrió.
do $$
declare v_id uuid; v_fac public.invoices;
begin
  v_id := (public.create_work_order(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'CNL003-req',
    p_vehicle_plate    => 'CNL003',
    p_vehicle_category => 'sedan',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'service_id', test.var('serv'), 'name', 'Lavado',
                            'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name    => 'Cliente Facturado')).id;
  perform test.set_var('ord_fact', v_id::text);

  v_fac := public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'CNL003-fac',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'item_type', 'service', 'service_id', test.var('serv')::uuid,
                            'product_id', null, 'name', 'Lavado', 'quantity', 1,
                            'discount_cents', 0, 'is_membego_covered', false)),
    p_payments         => jsonb_build_array(jsonb_build_object(
                            'method', 'tarjeta', 'amount_cents', 118000)),
    p_vehicle_category => 'sedan',
    p_work_order_id    => v_id,
    p_customer_name    => 'Cliente Facturado');
end $$;

select test.expect_error(
  'una orden YA FACTURADA no se puede cancelar',
  $$select public.cancel_work_order(test.var('ord_fact')::uuid, 'Quiero deshacer esto')$$
);

select test.check('la orden facturada sigue viva',
  (select status::text from public.work_orders where id = test.var('ord_fact')::uuid) <> 'cancelado');
select test.check('y su factura intacta',
  (select count(*) from public.invoices
    where work_order_id = test.var('ord_fact')::uuid and not is_annulled) = 1);

-- ##################################################### ELIMINAR EMPLEADOS
--
-- NOTA SOBRE LOS FIXTURES: las fichas se provisionan como `postgres`, no como el
-- administrador. Un perfil recién creado tiene `company_id` nulo, y
-- `profiles_admin_manage` exige `belongs_to_tenant(company_id)` — así que el
-- UPDATE que le asigna la empresa casaba CERO filas y la ficha se quedaba sin
-- provisionar. Con eso, las pruebas de abajo pasaban sin probar nada: borraban un
-- perfil invisible y contaban cero. Es el mismo patrón que usa el seed.
--
-- Por la misma razón, cada «¿se borró?» se comprueba como `postgres`: con los
-- ojos del administrador, «no lo veo» es indistinguible de «lo borré».

-- ---------------------------------------------------- Nadie se borra a sí mismo
select test.expect_error(
  'un administrador NO puede eliminar su propia ficha',
  $$delete from public.profiles where id = test.var('u_owner_a')::uuid$$
);

set role postgres;
select test.check('y sigue ahí',
  (select count(*) from public.profiles where id = test.var('u_owner_a')::uuid) = 1);

-- ---------------------------------------------------- Una ficha nueva sí
do $$
declare v_id uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'sobra@example.com')
  returning id into v_id;
  perform test.set_var('emp_sobra', v_id::text);

  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles
     set company_id = test.var('c_a')::uuid,
         branch_id  = test.var('b_a')::uuid,
         role = 'operario', full_name = 'Empleado Que Sobra'
   where id = v_id;
  perform set_config('app.branch_ctx', '', true);
end $$;

select test.check('el fixture quedó provisionado (si no, lo de abajo no prueba nada)',
  (select company_id = test.var('c_a')::uuid and full_name = 'Empleado Que Sobra'
     from public.profiles where id = test.var('emp_sobra')::uuid));

set role authenticated;
delete from public.profiles where id = test.var('emp_sobra')::uuid;

set role postgres;
select test.check('una ficha que nunca trabajó sí se elimina',
  (select count(*) from public.profiles where id = test.var('emp_sobra')::uuid) = 0);
select test.check('y el borrado queda en la bitácora con su nombre',
  (select details from public.audit_logs
    where action = 'ELIMINAR' and entity = 'profiles'
      and entity_id = test.var('emp_sobra')) like '%Empleado Que Sobra%');
set role authenticated;

-- ---------------------------------------------------- Quien trabajó, no
select test.expect_error(
  'quien ya trabajó NO se elimina: su nombre tiene que seguir en lo que hizo',
  $$delete from public.profiles where id = test.var('u_cashier_a')::uuid$$
);

set role postgres;
select test.check('y el cajero sigue ahí',
  (select count(*) from public.profiles where id = test.var('u_cashier_a')::uuid) = 1);
set role authenticated;

do $$
declare v_msg text;
begin
  begin
    delete from public.profiles where id = test.var('u_cashier_a')::uuid;
    v_msg := '(no falló)';
  exception when others then
    v_msg := SQLERRM;
  end;
  perform test.set_var('msg_emp', v_msg);
end $$;

select test.check('y se explica contando lo que hizo, no con un error de clave ajena',
  test.var('msg_emp') ~ '[0-9]+', test.var('msg_emp'));
select test.check('ofreciendo quitarle el acceso en su lugar',
  test.var('msg_emp') like '%acceso%', test.var('msg_emp'));

update public.profiles set is_active = false where id = test.var('u_cashier_a')::uuid;
select test.check('quitarle el acceso sí funciona',
  (select not is_active from public.profiles where id = test.var('u_cashier_a')::uuid));
update public.profiles set is_active = true where id = test.var('u_cashier_a')::uuid;

-- ---------------------------------------------------- El último que manda
set role postgres;
do $$
declare v_id uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'jefe2@example.com')
  returning id into v_id;
  perform test.set_var('emp_jefe2', v_id::text);

  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles
     set company_id = test.var('c_a')::uuid,
         branch_id  = test.var('b_a')::uuid,
         role = 'administrador', full_name = 'Jefe Dos'
   where id = v_id;
  perform set_config('app.branch_ctx', '', true);
end $$;

select test.check('el segundo jefe quedó provisionado como administrador',
  (select role::text from public.profiles where id = test.var('emp_jefe2')::uuid) = 'administrador');

set role authenticated;
delete from public.profiles where id = test.var('emp_jefe2')::uuid;

set role postgres;
select test.check('con más de un administrador, uno sin historia se puede eliminar',
  (select count(*) from public.profiles where id = test.var('emp_jefe2')::uuid) = 0);

-- Ahora se deja UN solo jefe activo y se intenta borrarlo. Lo intenta el
-- propietario, no el propio jefe: así se prueba la guarda del «último
-- administrador» y no la de «no te borres a ti mismo», que ya está probada.
do $$
declare v_id uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'jefe3@example.com')
  returning id into v_id;
  perform test.set_var('emp_jefe3', v_id::text);

  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles
     set company_id = test.var('c_a')::uuid,
         branch_id  = test.var('b_a')::uuid,
         role = 'administrador', full_name = 'Jefe Tres'
   where id = v_id;
  perform set_config('app.branch_ctx', '', true);

  update public.profiles set is_active = false
   where company_id = test.var('c_a')::uuid
     and role in ('propietario','administrador')
     and id <> v_id;
end $$;

select test.check('jefe3 es el único jefe ACTIVO de Alfa',
  (select count(*) from public.profiles
    where company_id = test.var('c_a')::uuid
      and role in ('propietario','administrador') and is_active) = 1);

-- Quien lo intenta tiene que ser un SUPERADMIN, y la razón vale escribirla:
--
--   · Si lo intenta el propio jefe3, salta primero la guarda de «no te borres a
--     ti mismo», que ya está probada arriba.
--   · Si lo intenta otro administrador activo, entonces hay dos y jefe3 no es
--     el último — la guarda no aplica.
--   · Si lo intenta un administrador DESACTIVADO, `app.current_role()` exige
--     `is_active`, así que no tiene rol, RLS casa cero filas y el borrado se
--     bloquea en silencio sin llegar a la guarda. Eso fue lo que pasó en el
--     primer intento de esta prueba: pasaba por la razón equivocada.
--
-- Queda el superadmin, que es platform y NO cuenta como administrador de la
-- empresa. Es el único camino real hasta esta guarda.
do $$
declare v_id uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'plataforma@example.com')
  returning id into v_id;
  perform test.set_var('emp_super', v_id::text);

  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles
     set company_id = test.var('c_a')::uuid,
         branch_id  = test.var('b_a')::uuid,
         role = 'superadmin', full_name = 'Soporte Plataforma', is_active = true
   where id = v_id;
  perform set_config('app.branch_ctx', '', true);
end $$;

select set_config('request.jwt.claim.sub', test.var('emp_super'), false);
set role authenticated;

select test.expect_error(
  'no se puede eliminar al ÚNICO administrador activo: sería un bloqueo sin arreglo',
  $$delete from public.profiles where id = test.var('emp_jefe3')::uuid$$
);

set role postgres;
select test.check('y jefe3 sigue ahí',
  (select count(*) from public.profiles where id = test.var('emp_jefe3')::uuid) = 1);

-- Se restaura el estado para lo que venga después.
update public.profiles set is_active = true where company_id = test.var('c_a')::uuid;
delete from public.profiles where id = test.var('emp_jefe3')::uuid;
delete from public.profiles where id = test.var('emp_super')::uuid;

-- ---------------------------------------------------- El cajero no borra
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_no_effect(
  'un cajero no puede eliminar empleados',
  $$delete from public.profiles where id = test.var('u_owner_a')::uuid$$,
  $$select exists (select 1 from public.profiles where id = test.var('u_owner_a')::uuid)$$
);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
