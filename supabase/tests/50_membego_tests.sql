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

reset role;
