-- =============================================================================
-- Pruebas de la integración con Membego (migración 0014)
-- =============================================================================
-- Reutiliza el montaje de 10_rls: empresas Alfa (A) y Beta (B) con sus dueños.
-- El webhook de Membego se simula llamando membego_ingest_event como service_role
-- (en producción lo hace la función de Vercel tras verificar el HMAC).

-- El rol service_role necesita usar los ayudantes de prueba (schema test).
set role postgres;
grant usage on schema test to service_role;
grant all on all tables in schema test to service_role;
grant usage, select on all sequences in schema test to service_role;
grant execute on all functions in schema test to service_role;

-- ---- Alfa vincula su empresa de Membego (companyId = MG-A).
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select public.membego_link_company('MG-A');

-- ---- Webhook: cliente se registra, activa membresía y compra una oferta.
set role postgres;
set role service_role;
select test.check('evento cliente.registrado se procesa',
  (public.membego_ingest_event('EV-1', 'cliente.registrado', 'MG-A',
    '{"clienteId":"MG-CLI-1","cliente":{"nombre":"Ana Membego"}}'::jsonb) ->> 'handled') = 'true');

select test.check('evento repetido (mismo id) es idempotente',
  (public.membego_ingest_event('EV-1', 'cliente.registrado', 'MG-A',
    '{"clienteId":"MG-CLI-1","cliente":{"nombre":"Ana Membego"}}'::jsonb) ->> 'reason') = 'duplicate');

select test.check('evento para una empresa no vinculada se ignora',
  (public.membego_ingest_event('EV-X', 'cliente.registrado', 'MG-DESCONOCIDA',
    '{"clienteId":"Z"}'::jsonb) ->> 'reason') = 'unknown_company');

select test.check('evento membresia.activada crea la membresía',
  (public.membego_ingest_event('EV-2', 'membresia.activada', 'MG-A',
    '{"clienteId":"MG-CLI-1","membresia":{"id":"MEM-1","plan":"Plan Oro"}}'::jsonb) ->> 'handled') = 'true');

select test.check('evento cliente.compro_servicio (oferta) crea la promoción',
  (public.membego_ingest_event('EV-3', 'cliente.compro_servicio', 'MG-A',
    '{"clienteId":"MG-CLI-1","oferta":{"id":"OF-1","titulo":"Lavado gratis"},"compra":{"tipo":"gratis"}}'::jsonb) ->> 'handled') = 'true');

select test.check('un tipo de evento desconocido no rompe (se ignora sin error)',
  (public.membego_ingest_event('EV-4', 'tipo.que.no.existe', 'MG-A',
    '{"clienteId":"MG-CLI-1"}'::jsonb) ->> 'handled') = 'true');

-- ---- Endurecimiento (arreglo del 500): la bitácora es best-effort. Si la tabla
-- membego_sync_logs no existiera, la ingestión NO debe reventar (era la causa
-- probable del 500). Se prueba escondiéndola y volviéndola a poner.
--
-- Se renombra y se renombra de vuelta, en vez de usar savepoint: psql abre una
-- transacción POR SENTENCIA, así que aquí un `savepoint` no agrupa nada y el
-- `rollback to savepoint` no revierte — dejaba la tabla renombrada para todo el
-- resto de la suite, que pasaba a correr contra un esquema que no existe en
-- producción.
set role postgres;
alter table public.membego_sync_logs rename to membego_sync_logs_tmp;
set role service_role;
select test.check('sin la tabla de bitácora, la ingestión NO revienta (best-effort)',
  (public.membego_ingest_event('EV-NOLOG', 'cliente.registrado', 'MG-A',
    '{"clienteId":"MG-CLI-NOLOG","cliente":{"nombre":"Sin Bitacora"}}'::jsonb) ->> 'handled') = 'true');
set role postgres;
alter table public.membego_sync_logs_tmp rename to membego_sync_logs;

select test.check('la bitácora quedó restaurada tras el ensayo',
  to_regclass('public.membego_sync_logs') is not null);

-- ---- Un error PERMANENTE de esquema se reporta como procesado (2xx), no lanza.
-- Se fuerza rompiendo el tipo de una columna que la función escribe, dentro de un
-- savepoint. Debe devolver reason='error_permanente', NUNCA propagar (evita el
-- reintento infinito que Membego pidió no provocar).
-- Se RENOMBRA la columna en vez de borrarla: provoca el mismo undefined_column
-- y se deshace sin perder los datos de las filas que ya existen.
alter table public.memberships rename column raw to raw_escondida;
set role service_role;
select test.check('error permanente de esquema → 2xx controlado (no lanza, no reintenta)',
  (public.membego_ingest_event('EV-BROKEN', 'membresia.activada', 'MG-A',
    '{"clienteId":"MG-CLI-1","membresia":{"id":"MEM-BRK","plan":"X"}}'::jsonb) ->> 'reason') = 'error_permanente');
set role postgres;
alter table public.memberships rename column raw_escondida to raw;

select test.check('la columna raw quedó restaurada tras el ensayo',
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'memberships'
            and column_name = 'raw'));

-- ---- Alfa SÍ ve al cliente, su membresía y su promoción.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('el cliente de Membego aparece en Alfa',
  (select count(*) = 1 from public.customers where membego_customer_id = 'MG-CLI-1'));
select test.check('la membresía aparece en Alfa',
  (select count(*) = 1 from public.memberships where membego_membership_id = 'MEM-1'));
select test.check('la promoción aparece en Alfa como disponible',
  (select count(*) = 1 from public.customer_promotions
     where membego_promotion_id = 'OF-1' and status = 'available'));
select test.check('el evento repetido no duplicó el cliente',
  (select count(*) = 1 from public.customers where membego_customer_id = 'MG-CLI-1'));

-- ---- El OTRO car wash (Beta) NO ve NADA de Alfa. La regla de oro.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve al cliente de Membego ajeno',
  (select count(*) = 0 from public.customers where membego_customer_id = 'MG-CLI-1'));
select test.check('otro car wash no ve la membresía ajena',
  (select count(*) = 0 from public.memberships));
select test.check('otro car wash no ve la promoción ajena',
  (select count(*) = 0 from public.customer_promotions));

-- ---- Un cajero no puede vincular la empresa.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede vincular la empresa de Membego',
  $q$select public.membego_link_company('MG-HACK')$q$);

-- ---- SSO: Membego asegura un empleado en la empresa del token (rol mapeado).
-- La RPC la llama service_role (como el borde); las aserciones que leen profiles
-- o auth.users se hacen con el rol adecuado (propietario / postgres), porque en
-- el shim service_role no tiene grants de tabla (en Supabase real sí).
set role postgres;
set role service_role;
select test.set_var('sso_uid',  public.membego_sso_upsert_user('MG-A', 'mg-sub-1', 'gerente@alfa.test', 'GERENTE')::text);
select test.set_var('sso_uid1', public.membego_sso_upsert_user('MG-A', 'mg-sub-1', 'gerente@alfa.test', 'GERENTE')::text);
select test.set_var('sso_uid3', public.membego_sso_upsert_user('MG-A', 'mg-sub-2', 'adminemp@alfa.test', 'ADMIN_EMPRESA')::text);
select test.set_var('sso_uid4', public.membego_sso_upsert_user('MG-A', 'mg-sub-3', 'plataforma@alfa.test', 'SUPERADMIN')::text);
select test.expect_error('SSO rechaza una empresa de Membego no vinculada',
  $q$select public.membego_sso_upsert_user('MG-DESCONOCIDA','s','x@y.com','EMPLEADO')$q$);
select test.expect_error('SSO rechaza un rol de Membego no reconocido (403 limpio, no 500)',
  $q$select public.membego_sso_upsert_user('MG-A','s2','otro@alfa.test','ROL_DE_PLATAFORMA_NUEVO')$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select test.check('SSO crea el empleado en la empresa del token, con el rol mapeado',
  (select company_id = test.var('c_a')::uuid and role = 'supervisor'
     from public.profiles where id = test.var('sso_uid')::uuid));
select test.check('SSO repetido reutiliza el mismo usuario (enlace por correo)',
  test.var('sso_uid') = test.var('sso_uid1'));
select test.check('SSO: ADMIN_EMPRESA se mapea a administrador',
  (select role = 'administrador' from public.profiles where id = test.var('sso_uid3')::uuid));
select test.check('SSO: SUPERADMIN se mapea a superadmin (admin máximo, acotado al tenant)',
  (select role = 'superadmin' and company_id = test.var('c_a')::uuid
     from public.profiles where id = test.var('sso_uid4')::uuid));

set role postgres;
select test.check('SSO: el empleado queda con acceso (contraseña presente)',
  (select encrypted_password is not null from auth.users where email = 'gerente@alfa.test'));

-- ---- SSO SALIENTE (car wash → Membego): el borde pide identidad para firmar.
-- El dueño de Alfa (empresa vinculada a MG-A) recibe su companyId de Membego.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select test.check('SSO saliente: devuelve el companyId de Membego de la empresa del usuario',
  (public.membego_sso_saliente() ->> 'companyId') = 'MG-A');
select test.check('SSO saliente: incluye el correo (respaldo que Membego acepta)',
  (public.membego_sso_saliente() ->> 'email') is not null);

-- El empleado que entró por SSO trae su sub de Membego (el preferido).
set role postgres;
select set_config('request.jwt.claim.sub', test.var('sso_uid'), false);
set role authenticated;
select test.check('SSO saliente: el empleado llegado por SSO conserva su sub de Membego',
  (public.membego_sso_saliente() ->> 'sub') = 'mg-sub-1');

-- El dueño de Beta (empresa NO vinculada) no puede: sin companyId no hay pase.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;
select test.expect_error('SSO saliente: empresa no vinculada no obtiene pase',
  $q$select public.membego_sso_saliente()$q$);

reset role;
