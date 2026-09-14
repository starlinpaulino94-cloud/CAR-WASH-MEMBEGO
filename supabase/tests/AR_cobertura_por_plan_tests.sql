-- =============================================================================
-- Qué lavado incluye cada plan de Membego (mig 20260914120000).
--
-- Lo que se protege aquí cuesta dinero: sin esta tabla, un plan de «básico»
-- pagaba un «premium» entero porque la única casilla que existía decía «una
-- membresía puede pagar esto» sin decir CUÁL.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_serv uuid := test.var('serv')::uuid;
begin
  insert into public.membego_plan_coberturas (company_id, plan_name, service_id)
  values (test.var('c_a')::uuid, 'PLAN BÁSICO', v_serv);
  perform test.check('el propietario asigna el lavado que incluye un plan',
    (select service_id from public.membego_plan_coberturas
      where plan_name = 'PLAN BÁSICO') = v_serv);
end $$;

-- El mismo plan escrito de otra forma es el MISMO plan: si dependiera de las
-- mayúsculas o de un espacio de más, el cobro sería una lotería.
select test.expect_error(
  'el mismo plan con otras mayúsculas no se puede duplicar',
  format($q$insert into public.membego_plan_coberturas (company_id, plan_name, service_id)
            values (%L::uuid, ' plan básico ', %L::uuid)$q$,
         test.var('c_a'), test.var('serv')));

-- ── Quién puede tocarlo ─────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);

select test.check('un cajero SÍ la lee: la caja necesita el tope para cobrar',
  (select count(*) from public.membego_plan_coberturas where plan_name = 'PLAN BÁSICO') = 1);

select test.expect_error(
  'pero un cajero NO decide qué cubre un plan: eso es decidir cuánto se cobra',
  format($q$insert into public.membego_plan_coberturas (company_id, plan_name, service_id)
            values (%L::uuid, 'PLAN INVENTADO', %L::uuid)$q$,
         test.var('c_a'), test.var('serv')));

-- ── Aislamiento entre empresas ──────────────────────────────────────────────
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
select test.check('otra empresa no ve la cobertura de esta',
  (select count(*) from public.membego_plan_coberturas where plan_name = 'PLAN BÁSICO') = 0);

-- ── Los planes que el local ha visto ────────────────────────────────────────
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);

do $$
declare v_planes jsonb; v_fila jsonb;
begin
  set role postgres;
  insert into public.memberships (company_id, customer_id, membego_membership_id, plan_name, status)
  select test.var('c_a')::uuid, id, 'mb-plan-basico-1', 'PLAN BÁSICO', 'active'
    from public.customers where company_id = test.var('c_a')::uuid limit 1;
  perform set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
  set role authenticated;

  v_planes := public.membego_planes_con_cobertura();
  select value into v_fila from jsonb_array_elements(v_planes)
   where value ->> 'plan_name' = 'PLAN BÁSICO';

  perform test.check('el plan aparece en la lista de ajustes con su cobertura resuelta',
    v_fila is not null and (v_fila ->> 'service_id') = test.var('serv'),
    coalesce(v_fila::text, 'no salió'));
  perform test.check('y dice cuántos clientes lo tienen, que es lo que ordena la atención',
    (v_fila ->> 'clientes')::int >= 1, v_fila ->> 'clientes');
end $$;
