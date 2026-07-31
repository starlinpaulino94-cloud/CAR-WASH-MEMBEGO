-- =============================================================================
-- Pruebas de la integración con Membego (migración 0014)
-- =============================================================================
-- Reutiliza el montaje de 10_rls: empresas Alfa (A) y Beta (B) con sus dueños.
-- El backend de Membego se simula con el rol service_role, como en producción.

-- El rol service_role necesita usar los ayudantes de prueba (schema test):
-- tablas, funciones Y la secuencia del id de resultados (si no, cada test.check
-- ejecutado como service_role falla en silencio por la secuencia).
set role postgres;
grant usage on schema test to service_role;
grant all on all tables in schema test to service_role;
grant usage, select on all sequences in schema test to service_role;
grant execute on all functions in schema test to service_role;

-- ---- Alfa (Car Town) vincula su comercio y guardamos el secreto.
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select test.set_var('m_secret', public.membego_link_merchant('M-CARTOWN'));

select test.check('vincular el comercio de Membego devuelve un secreto',
  length(test.var('m_secret')) >= 32);

-- ---- Membego (service_role) registra al cliente que SIGUE a Car Town, y le
--      otorga una membresía de pago y una promoción gratis.
set role postgres;
set role service_role;
do $$
begin
  perform public.membego_sync_customer('M-CARTOWN', test.var('m_secret'),
    'MC-1', 'Ana Membego', '809-555-0001', null, 'oro', 'active');
  perform public.membego_grant_membership('M-CARTOWN', test.var('m_secret'),
    'MC-1', 'MEM-1', 'Plan Oro', 'oro', 'active', true, current_date, current_date + 365);
  perform public.membego_grant_promotion('M-CARTOWN', test.var('m_secret'),
    'MC-1', 'PROMO-1', 'Lavado gratis', 'free', 'LG2026', 0, now() + interval '30 days');
end $$;

select test.expect_error('un secreto de Membego equivocado se rechaza',
  $q$select public.membego_sync_customer('M-CARTOWN','secreto-malo','MC-X','X')$q$);

-- ---- Car Town SÍ ve al cliente, su membresía y su promoción.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('el cliente que sigue a Car Town aparece en Car Town',
  (select count(*) = 1 from public.customers where membego_customer_id = 'MC-1'));
select test.check('la membresía de pago aparece en Car Town',
  (select count(*) = 1 from public.memberships where membego_membership_id = 'MEM-1' and is_paid));
select test.check('la promoción gratis aparece disponible en Car Town',
  (select count(*) = 1 from public.customer_promotions
     where membego_promotion_id = 'PROMO-1' and kind = 'free' and status = 'available'));

-- ---- El OTRO car wash (Beta) NO ve NADA de Car Town. Este es el requisito.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve al cliente de Membego ajeno',
  (select count(*) = 0 from public.customers where membego_customer_id = 'MC-1'));
select test.check('otro car wash no ve la membresía ajena',
  (select count(*) = 0 from public.memberships));
select test.check('otro car wash no ve la promoción ajena',
  (select count(*) = 0 from public.customer_promotions));

-- ---- Un cajero no puede vincular el comercio.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede vincular el comercio de Membego',
  $q$select public.membego_link_merchant('M-HACK')$q$);

-- ---- Membego marca la promoción como canjeada.
set role postgres;
set role service_role;
select test.check('Membego puede marcar una promoción como canjeada',
  public.membego_set_promotion_status('M-CARTOWN', test.var('m_secret'), 'PROMO-1', 'redeemed'));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select test.check('la promoción queda como canjeada, con su fecha',
  (select status = 'redeemed' and redeemed_at is not null
     from public.customer_promotions where membego_promotion_id = 'PROMO-1'));

reset role;
