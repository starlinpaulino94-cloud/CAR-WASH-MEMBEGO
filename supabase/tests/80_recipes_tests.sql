-- =============================================================================
-- Pruebas de recetas de insumos y consumo al entregar (migración 0021)
-- =============================================================================
-- Continúa sobre Alfa (10_rls). Crea su propio insumo, receta y orden.
-- =============================================================================

-- ---- Preparación: insumo interno (en ml) y receta del servicio de Alfa.
set role postgres;
do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_b uuid := test.var('b_a')::uuid;
  v_serv uuid := test.var('serv')::uuid;
  v_shampoo uuid;
begin
  -- Insumo de uso interno en su unidad de consumo (ml); costo por ml: 2 centavos.
  insert into public.products (company_id, branch_id, code, name, cost_cents, price_cents,
                               stock, min_stock, unit, is_for_sale)
    values (v_c, v_b, 'SH-ML', 'Champú (ml)', 2, 0, 5, 1, 'ml', false)
    returning id into v_shampoo;
  perform test.set_var('shampoo', v_shampoo::text);

  -- El servicio necesita precio para la categoría de las órdenes de esta prueba.
  insert into public.service_prices (service_id, vehicle_category, price_cents)
    values (v_serv, 'suv', 120000)
    on conflict do nothing;

  -- Iniciar el lavado exige bahía: una disponible para estas órdenes.
  insert into public.bays (company_id, branch_id, name)
    values (v_c, v_b, 'Bahía Recetas')
    returning id into v_shampoo;  -- reutiliza la variable local como buffer
  perform test.set_var('bay_rec', v_shampoo::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ---- La receta la define el propietario; el cajero no.
with r as (
  insert into public.service_recipes (company_id, service_id, product_id, quantity)
  values (test.var('c_a')::uuid, test.var('serv')::uuid, test.var('shampoo')::uuid, 0.4)
  returning id
)
select test.set_var('rec_gen', (select id::text from r));

with r as (
  insert into public.service_recipes (company_id, service_id, product_id, vehicle_category, quantity)
  values (test.var('c_a')::uuid, test.var('serv')::uuid, test.var('shampoo')::uuid, 'suv', 0.7)
  returning id
)
select test.set_var('rec_suv', (select id::text from r));

select test.check('el propietario define la receta del servicio (genérica)',
  (select count(*) = 1 from public.service_recipes where id = test.var('rec_gen')::uuid));
select test.check('y una variante específica para SUV que la sobreescribe',
  (select count(*) = 1 from public.service_recipes where id = test.var('rec_suv')::uuid));

select test.check('el costo estimado usa la fila específica de la categoría',
  public.service_recipe_cost(test.var('serv')::uuid, 'suv') = round(0.7 * 2));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede definir recetas',
  format($q$insert into public.service_recipes (company_id, service_id, product_id, quantity)
     values (%L::uuid, %L::uuid, %L::uuid, 1)$q$,
     test.var('c_a'), test.var('serv'), test.var('prod')));

-- ---- Entregar una orden consume por receta (fila SUV: 0.7 por servicio).
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare
  v_o public.work_orders;
begin
  v_o := public.create_work_order(
    p_branch_id         => test.var('b_a')::uuid,
    p_client_request_id => 'wo-receta-1',
    p_vehicle_plate     => 'RC0001',
    p_vehicle_category  => 'suv',
    p_items             => jsonb_build_array(jsonb_build_object(
                             'service_id', test.var('serv'), 'name', 'Lavado',
                             'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name     => 'Cliente Receta');
  perform test.set_var('wo_rec', v_o.id::text);
  perform public.advance_work_order(v_o.id, 'en_espera');
  perform public.advance_work_order(v_o.id, 'en_proceso', test.var('bay_rec')::uuid);
  perform public.advance_work_order(v_o.id, 'listo');
  perform public.advance_work_order(v_o.id, 'entregado');
end $$;

select test.check('al entregar quedó el consumo EXACTO registrado con su costo',
  (select count(*) = 1 from public.service_consumptions
    where work_order_id = test.var('wo_rec')::uuid
      and product_id = test.var('shampoo')::uuid
      and quantity = 0.7 and cost_cents = round(0.7 * 2)));

select test.check('sin completar la unidad, el stock entero no cambia y la fracción avanza',
  (select stock = 5 and stock_frac = 0.7 from public.products
    where id = test.var('shampoo')::uuid));

-- ---- Una segunda entrega completa la unidad: kardex 'consumo' y stock baja.
do $$
declare
  v_o public.work_orders;
begin
  v_o := public.create_work_order(
    p_branch_id         => test.var('b_a')::uuid,
    p_client_request_id => 'wo-receta-2',
    p_vehicle_plate     => 'RC0002',
    p_vehicle_category  => 'suv',
    p_items             => jsonb_build_array(jsonb_build_object(
                             'service_id', test.var('serv'), 'name', 'Lavado',
                             'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name     => 'Cliente Receta');
  perform test.set_var('wo_rec2', v_o.id::text);
  perform public.advance_work_order(v_o.id, 'en_espera');
  perform public.advance_work_order(v_o.id, 'en_proceso', test.var('bay_rec')::uuid);
  perform public.advance_work_order(v_o.id, 'listo');
  perform public.advance_work_order(v_o.id, 'entregado');
end $$;

select test.check('al cruzar la unidad, el stock baja y la fracción guarda el resto',
  (select stock = 4 and stock_frac = 0.4 from public.products
    where id = test.var('shampoo')::uuid));

select test.check('el cruce quedó en el kardex como «consumo» ligado a la orden',
  (select count(*) = 1 from public.inventory_movements
    where product_id = test.var('shampoo')::uuid and kind = 'consumo'
      and work_order_id = test.var('wo_rec2')::uuid and qty_change = -1));

-- ---- Aislamiento: Beta no ve recetas ni consumos de Alfa.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve las recetas ajenas',
  (select count(*) = 0 from public.service_recipes
    where service_id = test.var('serv')::uuid));
select test.check('otro car wash no ve los consumos ajenos',
  (select count(*) = 0 from public.service_consumptions
    where work_order_id = test.var('wo_rec')::uuid));

reset role;
