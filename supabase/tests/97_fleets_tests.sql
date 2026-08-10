-- =============================================================================
-- Pruebas de flotillas y contratos corporativos (migración 0029)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls) y el servicio 'serv' con precio sedán de
-- 100.000 centavos (20_billing). Lo que se demuestra: la tarifa pactada gana al
-- catálogo sin que nadie aplique descuentos a mano, y el mes entero se factura
-- de una vez, a crédito, sin poder cobrarse dos veces.
-- =============================================================================

set role postgres;

do $$
declare
  v_c    uuid := test.var('c_a')::uuid;
  v_b    uuid := test.var('b_a')::uuid;
  v_cli  uuid;
  v_serv uuid := test.var('serv')::uuid;
begin
  -- El cliente que paga la flotilla. Necesita crédito: lo consolidado se fía.
  insert into public.customers (company_id, branch_id, name, phone)
    values (v_c, v_b, 'Distribuidora del Este SRL', '809-555-0800')
    returning id into v_cli;

  -- Precio de catálogo para SUV, que es lo que se compara contra el contrato.
  insert into public.service_prices (service_id, vehicle_category, price_cents)
    values (v_serv, 'suv', 150000)
    on conflict (service_id, vehicle_category) do update set price_cents = 150000;

  perform test.set_var('fl_cli', v_cli::text);
end $$;

-- ================================================== Quién administra flotillas
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error('un cajero no crea flotillas',
  format($q$select public.upsert_fleet(%L::uuid, 'Flota Pirata')$q$, test.var('fl_cli')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('una flotilla sin nombre se rechaza',
  format($q$select public.upsert_fleet(%L::uuid, '   ')$q$, test.var('fl_cli')));

select test.set_var('flota',
  (public.upsert_fleet(test.var('fl_cli')::uuid, 'Distribuidora del Este',
     null, 'DE-01', 'Ana Pérez', '809-555-0801', null, 'OC-2026-118')).id::text);

select test.check('el propietario crea la flotilla apuntando a quien paga',
  (select customer_id = test.var('fl_cli')::uuid and code = 'DE-01'
      and po_reference = 'OC-2026-118' and is_active
     from public.fleets where id = test.var('flota')::uuid));

-- ==================================================== Tarifas negociadas
select test.expect_error('una tarifa negativa se rechaza',
  format($q$select public.set_fleet_rate(%L::uuid, %L::uuid, -1)$q$,
         test.var('flota'), test.var('serv')));
select test.expect_error('no se pacta tarifa sobre un servicio ajeno',
  format($q$select public.set_fleet_rate(%L::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 1000)$q$,
         test.var('flota')));

-- Genérica para todo el parque: 700,00 en vez de los 1.000,00 del catálogo.
do $$
begin
  perform public.set_fleet_rate(test.var('flota')::uuid, test.var('serv')::uuid, 70000);
end $$;

select test.check('la tarifa genérica queda guardada sin categoría',
  (select count(*) = 1 from public.fleet_rates
    where fleet_id = test.var('flota')::uuid and vehicle_category is null and price_cents = 70000));

-- Volver a fijarla ACTUALIZA, no duplica: los índices únicos son parciales y el
-- upsert se hace a mano.
do $$
begin
  perform public.set_fleet_rate(test.var('flota')::uuid, test.var('serv')::uuid, 75000);
end $$;

select test.check('repactar la tarifa la actualiza en lugar de duplicarla',
  (select count(*) = 1 and max(price_cents) = 75000 from public.fleet_rates
    where fleet_id = test.var('flota')::uuid and vehicle_category is null));

-- Específica para SUV: las camionetas pagan más que el resto del parque.
do $$
begin
  perform public.set_fleet_rate(test.var('flota')::uuid, test.var('serv')::uuid, 110000, 'suv');
end $$;

select test.check('conviven la tarifa genérica y la específica',
  (select count(*) = 2 from public.fleet_rates where fleet_id = test.var('flota')::uuid));

-- =============================================== La tarifa manda en la orden
-- Primero una orden con el vehículo TODAVÍA fuera de la flotilla.
do $$
declare v_wo public.work_orders;
begin
  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'fl-wo-suelto',
    p_vehicle_plate => 'FL0001',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Distribuidora del Este SRL');
  perform test.set_var('fl_wo0', v_wo.id::text);
end $$;

select test.check('sin flotilla se cobra la tarifa de mostrador',
  (select unit_price_cents = 100000 from public.work_order_items
    where work_order_id = test.var('fl_wo0')::uuid));

-- Se mete el vehículo en la flotilla.
select test.set_var('fl_veh',
  (select id::text from public.vehicles where plate = 'FL0001'));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no mueve vehículos de flotilla',
  format($q$select public.assign_vehicle_to_fleet(%L::uuid, %L::uuid)$q$,
         test.var('fl_veh'), test.var('flota')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
begin
  perform public.assign_vehicle_to_fleet(test.var('fl_veh')::uuid, test.var('flota')::uuid);
end $$;

select test.check('el vehículo quedó asignado a la flotilla',
  (select fleet_id = test.var('flota')::uuid from public.vehicles
    where id = test.var('fl_veh')::uuid));

-- Ahora la MISMA placa, el mismo servicio: manda el contrato.
do $$
declare v_wo public.work_orders;
begin
  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'fl-wo-1',
    p_vehicle_plate => 'FL0001',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Distribuidora del Este SRL');
  perform test.set_var('fl_wo1', v_wo.id::text);
end $$;

select test.check('la tarifa de contrato gana al catálogo sin descuentos a mano',
  (select unit_price_cents = 75000 from public.work_order_items
    where work_order_id = test.var('fl_wo1')::uuid),
  (select unit_price_cents::text from public.work_order_items
    where work_order_id = test.var('fl_wo1')::uuid));

select test.check('la orden queda sellada con su flotilla',
  (select fleet_id = test.var('flota')::uuid from public.work_orders
    where id = test.var('fl_wo1')::uuid));

-- Una SUV de la misma flota: gana la específica sobre la genérica.
do $$
declare v_wo public.work_orders;
begin
  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'fl-wo-2',
    p_vehicle_plate => 'FL0002',
    p_vehicle_category => 'suv',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Distribuidora del Este SRL');
  perform test.set_var('fl_wo2', v_wo.id::text);
end $$;

-- Ojo: FL0002 se acaba de crear y todavía no está en la flotilla, así que esta
-- primera va a tarifa de catálogo. Se asigna y se repite.
select test.check('un vehículo nuevo aún no es de la flota: paga catálogo',
  (select unit_price_cents = 150000 from public.work_order_items
    where work_order_id = test.var('fl_wo2')::uuid));

do $$
declare v_wo public.work_orders;
begin
  perform public.assign_vehicle_to_fleet(
    (select id from public.vehicles where plate = 'FL0002'), test.var('flota')::uuid);

  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'fl-wo-3',
    p_vehicle_plate => 'FL0002',
    p_vehicle_category => 'suv',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Distribuidora del Este SRL');
  perform test.set_var('fl_wo3', v_wo.id::text);
end $$;

select test.check('la tarifa específica de SUV gana a la genérica de la flota',
  (select unit_price_cents = 110000 from public.work_order_items
    where work_order_id = test.var('fl_wo3')::uuid),
  (select unit_price_cents::text from public.work_order_items
    where work_order_id = test.var('fl_wo3')::uuid));

-- La caja también respeta el contrato: si no, la factura no cuadraría con su
-- propia orden.
select test.check('el mostrador cobra la misma tarifa pactada que la orden',
  app.resolve_item_price('service', test.var('serv')::uuid, null, 'sedan',
    app.fleet_for_plate(test.var('c_a')::uuid, 'FL-0001')) = 75000);

select test.check('la flotilla se resuelve con la placa normalizada',
  app.fleet_for_plate(test.var('c_a')::uuid, 'fl 0001') = test.var('flota')::uuid);

-- ============================================ Facturación consolidada
-- Sin crédito autorizado no se consolida: lo consolidado se fía siempre.
select test.expect_error('no se consolida a un cliente sin crédito autorizado',
  format($q$select public.invoice_fleet_period(%L::uuid, current_date - 1, current_date, 'fl-nc-1')$q$,
         test.var('flota')));

do $$
begin
  perform public.set_customer_credit(test.var('fl_cli')::uuid, true, 1000000, 30);
end $$;

-- Todavía no hay nada entregado.
select test.expect_error('sin órdenes entregadas no hay nada que consolidar',
  format($q$select public.invoice_fleet_period(%L::uuid, current_date - 1, current_date, 'fl-nada')$q$,
         test.var('flota')));

-- Se entregan las tres órdenes de la flota.
do $$
declare v_bay uuid;
begin
  insert into public.bays (company_id, branch_id, name, type)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Bahía Flota', 'lavado')
  returning id into v_bay;

  perform public.advance_work_order(test.var('fl_wo1')::uuid, 'en_proceso', v_bay);
  perform public.advance_work_order(test.var('fl_wo1')::uuid, 'listo');
  perform public.advance_work_order(test.var('fl_wo1')::uuid, 'entregado');

  perform public.advance_work_order(test.var('fl_wo3')::uuid, 'en_proceso', v_bay);
  perform public.advance_work_order(test.var('fl_wo3')::uuid, 'listo');
  perform public.advance_work_order(test.var('fl_wo3')::uuid, 'entregado');
end $$;

-- fl_wo1: 75.000 + 18% = 88.500 · fl_wo3: 110.000 + 18% = 129.800 → 218.300
select test.set_var('fl_fac',
  (public.invoice_fleet_period(test.var('flota')::uuid,
     current_date - 1, current_date, 'fl-consolidada-1')).id::text);

select test.check('la consolidada suma los importes congelados de las órdenes',
  (select total_cents = 218300 and subtotal_cents = 185000
     from public.invoices where id = test.var('fl_fac')::uuid),
  (select total_cents::text from public.invoices where id = test.var('fl_fac')::uuid));

select test.check('la consolidada detalla cada servicio con su placa y su orden',
  (select count(*) filter (where name like '%FL0001%CW-%') = 1
      and count(*) filter (where name like '%FL0002%CW-%') = 1
      and count(*) = 2
     from public.invoice_items where invoice_id = test.var('fl_fac')::uuid));

select test.check('la consolidada abre UNA sola cuenta por cobrar',
  (select count(*) = 1 from public.receivables
    where invoice_id = test.var('fl_fac')::uuid and total_cents = 218300
      and customer_id = test.var('fl_cli')::uuid));

select test.check('la consolidada no toca la caja: no ha entrado dinero',
  (select count(*) = 0 from public.cash_movements where invoice_id = test.var('fl_fac')::uuid));

select test.check('las órdenes quedan selladas contra la factura consolidada',
  (select count(*) = 2 from public.work_orders
    where consolidated_invoice_id = test.var('fl_fac')::uuid
      and payment_status = 'pendiente' and payment_method = 'credito'));

select test.check('la orden suelta de antes de entrar a la flota NO se consolidó',
  (select consolidated_invoice_id is null and fleet_id is null
     from public.work_orders where id = test.var('fl_wo0')::uuid));

-- Lo importante: no se cobra dos veces.
select test.expect_error('no queda nada por consolidar en el mismo periodo',
  format($q$select public.invoice_fleet_period(%L::uuid, current_date - 1, current_date, 'fl-consolidada-2')$q$,
         test.var('flota')));

select test.check('repetir la misma petición devuelve la MISMA factura, no otra',
  (public.invoice_fleet_period(test.var('flota')::uuid,
     current_date - 1, current_date, 'fl-consolidada-1')).id = test.var('fl_fac')::uuid);

-- El cupo se respeta también aquí.
select test.check('la consolidación consumió el cupo del cliente que paga',
  (select (s ->> 'balance_cents')::bigint = 218300
   from public.customer_credit_status(test.var('fl_cli')::uuid) s));

-- ==================================================== Estado de cuenta
select test.check('el estado de cuenta desglosa el consumo por vehículo',
  (select jsonb_array_length(a -> 'by_vehicle') = 2
      and (a #>> '{totals,services}')::int = 2
      and (a #>> '{totals,unbilled_cents}')::bigint = 0
      and (a #>> '{balance_cents}')::bigint = 218300
   from public.fleet_statement(test.var('flota')::uuid, current_date - 1, current_date) a));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no consulta el estado de cuenta corporativo',
  format($q$select public.fleet_statement(%L::uuid, current_date - 1, current_date)$q$,
         test.var('flota')));
select test.expect_error('un cajero no factura flotillas',
  format($q$select public.invoice_fleet_period(%L::uuid, current_date - 1, current_date, 'fl-cajero')$q$,
         test.var('flota')));

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve las flotillas de Alfa',
  (select count(*) = 0 from public.fleets));
select test.check('Beta no ve las tarifas pactadas por Alfa',
  (select count(*) = 0 from public.fleet_rates));
select test.expect_error('Beta no pacta tarifas en una flotilla de Alfa',
  format($q$select public.set_fleet_rate(%L::uuid, %L::uuid, 100)$q$,
         test.var('flota'), test.var('serv')));
select test.expect_error('Beta no mete un vehículo de Alfa en una flotilla',
  format($q$select public.assign_vehicle_to_fleet(%L::uuid, %L::uuid)$q$,
         test.var('fl_veh'), test.var('flota')));
select test.expect_error('Beta no factura una flotilla de Alfa',
  format($q$select public.invoice_fleet_period(%L::uuid, current_date - 1, current_date, 'fl-beta')$q$,
         test.var('flota')));

set role postgres;
