-- =============================================================================
-- Pruebas del nivel tarifario por categoría (migración 0038)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls). Lo que se demuestra:
--   · sin fila, el nivel es NULL y NO 1 — con 1 por defecto, todas las
--     categorías cabrían en el plan más barato y el negocio regalaría lavados
--     de camión sin enterarse;
--   · el mapa se guarda entero y una categoría vuelve a «sin configurar»;
--   · un cajero no cambia tarifas, ni por la RPC ni por UPDATE;
--   · una empresa no ve ni toca los niveles de la otra.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ==================================================== Sin configurar = NULL
select test.check('una empresa nace sin ningún nivel configurado',
  (select count(*) from public.vehicle_category_levels) = 0);

select test.check('una categoría sin fila da NULL, no 1: quien consulta sabe que no lo sabe',
  (select level from public.vehicle_category_levels where category = 'sedan') is null);

-- ==================================================== Guardar el mapa
select public.set_vehicle_category_levels(
  '{"sedan": 1, "suv": 3, "jeep": 3, "pickup": 3, "van": 4, "motorcycle": 1}'::jsonb
);

select test.check('el mapa se guarda entero',
  (select count(*) from public.vehicle_category_levels) = 6,
  (select count(*)::text || ' categorías' from public.vehicle_category_levels));
select test.check('el sedán queda en nivel 1',
  (select level from public.vehicle_category_levels where category = 'sedan') = 1);
select test.check('la van queda en nivel 4',
  (select level from public.vehicle_category_levels where category = 'van') = 4);
select test.check('las categorías que no se mandaron siguen sin configurar',
  (select level from public.vehicle_category_levels where category = 'truck') is null);

-- ==================================================== Volver a «sin configurar»
select public.set_vehicle_category_levels('{"motorcycle": null}'::jsonb);
select test.check('null devuelve una categoría a sin configurar',
  (select level from public.vehicle_category_levels where category = 'motorcycle') is null);
select test.check('y no toca las demás',
  (select level from public.vehicle_category_levels where category = 'sedan') = 1);

-- ==================================================== Corregir un nivel
select public.set_vehicle_category_levels('{"suv": 2}'::jsonb);
select test.check('reenviar una categoría corrige su nivel',
  (select level from public.vehicle_category_levels where category = 'suv') = 2);

-- ==================================================== Lo que la base rechaza
select test.expect_error(
  'una categoría inventada se rechaza en vez de guardarse y no coincidir nunca',
  $$select public.set_vehicle_category_levels('{"submarino": 2}'::jsonb)$$
);

select test.expect_error(
  'el nivel se acota: un 30 en vez de un 3 se atrapa aquí',
  $$insert into public.vehicle_category_levels (company_id, category, level)
    values ((select id from public.companies limit 1), 'special', 30)$$
);

-- ==================================================== El cajero no fija tarifas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error(
  'un cajero no cambia tarifas ni llamando a la RPC',
  $$select public.set_vehicle_category_levels('{"sedan": 9}'::jsonb)$$
);

select test.expect_no_effect(
  'ni con un UPDATE directo: RLS no le deja filas que tocar',
  $$update public.vehicle_category_levels set level = 9 where category = 'sedan'$$,
  $$select (select level from public.vehicle_category_levels where category = 'sedan') = 1$$
);

-- ==================================================== La otra empresa
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve los niveles de Alfa',
  (select count(*) from public.vehicle_category_levels) = 0);

select public.set_vehicle_category_levels('{"sedan": 5}'::jsonb);

set role postgres;
select test.check('y configurar los suyos no toca los de Alfa',
  (select level from public.vehicle_category_levels
    where company_id = test.var('c_a')::uuid and category = 'sedan') = 1);
set role authenticated;
