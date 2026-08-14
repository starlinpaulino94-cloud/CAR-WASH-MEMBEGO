-- =============================================================================
-- Pruebas de procedencia del cliente (migración 0037)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls) y sobre los clientes que 50_membego creó
-- por evento. Lo que se demuestra:
--   · la procedencia la decide la base, no quien escribe la sentencia;
--   · vincular a Membego un cliente propio NO lo convierte en cliente de
--     Membego: eso es lo que hace que la atribución de ventas sea fiable;
--   · el resumen separa los dos canales y respeta RLS.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ==================================================== Se sella al nacer
do $$
declare v_id uuid;
begin
  insert into public.customers (company_id, branch_id, name, phone)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Llegó Solo', '809-600-0001')
  returning id into v_id;
  perform test.set_var('org_propio', v_id::text);

  insert into public.customers (company_id, branch_id, name, phone, membego_customer_id)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Vino de Membego', '809-600-0002', 'MG-ORIG-1')
  returning id into v_id;
  perform test.set_var('org_membego', v_id::text);
end $$;

select test.check('quien se registra en el car wash queda como propio',
  (select origin::text from public.customers where id = test.var('org_propio')::uuid) = 'carwash');
select test.check('quien nace con identificador de Membego queda como de Membego',
  (select origin::text from public.customers where id = test.var('org_membego')::uuid) = 'membego');

-- ============================== La sentencia no decide: la decide la fila
do $$
declare v_id uuid;
begin
  -- Se pide 'membego' descaradamente, sin identificador que lo respalde.
  insert into public.customers (company_id, branch_id, name, phone, origin)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Se Dice Membego', '809-600-0003', 'membego')
  returning id into v_id;
  perform test.set_var('org_mentiroso', v_id::text);
end $$;

select test.check('declararse de Membego sin serlo no cuela',
  (select origin::text from public.customers where id = test.var('org_mentiroso')::uuid) = 'carwash');

-- ======================================= La procedencia no se reescribe
select test.expect_error('un UPDATE no cambia la procedencia',
  format($q$update public.customers set origin = 'membego' where id = '%s'$q$,
         test.var('org_propio')));

-- Y lo importante: vincular a Membego un cliente PROPIO no lo transfiere.
update public.customers
   set membego_customer_id = 'MG-TARDIO-1', membego_status = 'active'
 where id = test.var('org_propio')::uuid;

select test.check('vincular a Membego un cliente propio NO le cambia la procedencia',
  (select origin::text from public.customers where id = test.var('org_propio')::uuid) = 'carwash');
select test.check('pero sí queda vinculado, que es otra cosa',
  (select membego_customer_id from public.customers
   where id = test.var('org_propio')::uuid) = 'MG-TARDIO-1');

-- ================== Los clientes que creó Membego por evento están sellados
select test.check('el cliente que llegó por un evento de Membego cuenta como suyo',
  (select bool_and(origin::text = 'membego') from public.customers
   where company_id = test.var('c_a')::uuid and membego_customer_id like 'MG-CLI-%'));

-- ========================================================== El resumen
select test.set_var('org_resumen',
  public.customer_origin_summary(current_date - 30, current_date)::text);

select test.check('el resumen trae los dos canales, aunque uno estuviera vacío',
  (test.var('org_resumen')::jsonb -> 'por_origen' ? 'carwash')
  and (test.var('org_resumen')::jsonb -> 'por_origen' ? 'membego'));

select test.check('cuenta los clientes propios que existen de verdad',
  (test.var('org_resumen')::jsonb #>> '{por_origen,carwash,clientes}')::int
    = (select count(*) from public.customers
       where company_id = test.var('c_a')::uuid and origin = 'carwash'));

select test.check('y los de Membego por separado',
  (test.var('org_resumen')::jsonb #>> '{por_origen,membego,clientes}')::int
    = (select count(*) from public.customers
       where company_id = test.var('c_a')::uuid and origin = 'membego'));

select test.check('los recién creados cuentan como nuevos del período',
  (test.var('org_resumen')::jsonb #>> '{por_origen,carwash,nuevos}')::int >= 3);

-- Lo facturado sale de las facturas vivas, no del acumulado del cliente.
select test.check('lo facturado del período no es el consumo histórico',
  (test.var('org_resumen')::jsonb ? 'desde')
  and (test.var('org_resumen')::jsonb #>> '{por_origen,carwash,facturado_cents}') is not null);

-- Un rango sin nada facturado no inventa importes.
select test.check('un rango vacío devuelve ceros, no nulos',
  (public.customer_origin_summary(current_date - 3650, current_date - 3600)
     #>> '{por_origen,membego,facturado_cents}') = '0');

-- ==================================================== Aislamiento por empresa
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve en su resumen los clientes de Alfa',
  (public.customer_origin_summary() #>> '{por_origen,carwash,clientes}')::int
    = (select count(*) from public.customers
       where company_id = test.var('c_b')::uuid and origin = 'carwash'));

set role postgres;

select test.check('y ese número NO es el de Alfa',
  (select count(*) from public.customers where company_id = test.var('c_b')::uuid)
    <> (select count(*) from public.customers where company_id = test.var('c_a')::uuid));
