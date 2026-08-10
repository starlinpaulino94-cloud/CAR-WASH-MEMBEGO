-- =============================================================================
-- Pruebas de crédito de clientes y cuentas por cobrar (migración 0028)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls) y el servicio 'serv' con precio sedán
-- (20_billing). Lo que se demuestra aquí es que fiar deja de ser un regalo:
-- exige autorización, respeta el cupo, bloquea al moroso, NO entra a caja y
-- deja la orden pendiente hasta que se cobra de verdad.
-- =============================================================================

set role postgres;

do $$
declare
  v_c    uuid := test.var('c_a')::uuid;
  v_b    uuid := test.var('b_a')::uuid;
  v_cli  uuid;
  v_sin  uuid;
  v_sess uuid;
begin
  insert into public.customers (company_id, branch_id, name, phone)
    values (v_c, v_b, 'Flotilla Transporte Cibao', '809-555-0900')
    returning id into v_cli;
  insert into public.customers (company_id, branch_id, name, phone)
    values (v_c, v_b, 'Cliente Sin Crédito', '809-555-0901')
    returning id into v_sin;

  -- Una sola caja abierta por sucursal: se reutiliza la que haya.
  select id into v_sess from public.cash_sessions
  where branch_id = v_b and status = 'open';
  if v_sess is null then
    insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
      values (v_c, v_b, test.var('u_cashier_a')::uuid, 500000)
      returning id into v_sess;
  end if;

  perform test.set_var('cli_cred', v_cli::text);
  perform test.set_var('cli_sin',  v_sin::text);
  perform test.set_var('cr_sess',  v_sess::text);
end $$;

-- ================================================== Quién autoriza el cupo
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error('un cajero no autoriza crédito',
  format($q$select public.set_customer_credit(%L::uuid, true, 500000, 30)$q$, test.var('cli_cred')));

-- El guardia: la política de clientes deja editar el directorio, pero no el cupo.
select test.expect_error('el cupo no se edita con un UPDATE directo',
  format($q$update public.customers set credit_limit_cents = 99999999 where id = %L$q$,
         test.var('cli_cred')));
select test.expect_error('la autorización de crédito no se activa con un UPDATE directo',
  format($q$update public.customers set credit_enabled = true where id = %L$q$,
         test.var('cli_cred')));

select test.expect_ok('el resto del directorio sí se sigue editando',
  format($q$update public.customers set phone = '809-555-0999' where id = %L$q$,
         test.var('cli_cred')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('un plazo fuera de rango se rechaza',
  format($q$select public.set_customer_credit(%L::uuid, true, 100000, 400)$q$, test.var('cli_cred')));

do $$
begin
  perform public.set_customer_credit(test.var('cli_cred')::uuid, true, 200000, 15);
end $$;

select test.check('el propietario autoriza el crédito con cupo y plazo',
  (select credit_enabled and credit_limit_cents = 200000 and credit_terms_days = 15
     from public.customers where id = test.var('cli_cred')::uuid));

select test.check('la autorización quedó en la bitácora',
  (select count(*) = 1 from public.audit_logs
    where action = 'AUTORIZAR_CREDITO' and entity_id = test.var('cli_cred')::uuid));

-- ==================================================== Fiar en el mostrador
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- Un servicio sedán de 1.000,00 + 18% = 1.180,00 (118000 centavos).
select test.expect_error('no se fía a consumidor final',
  format($q$select public.create_invoice(%L::uuid, 'cr-anon',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',118000)),
    'sedan', null, null, 'Consumidor Final', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('cr_sess')));

select test.expect_error('no se fía a un cliente sin crédito autorizado',
  format($q$select public.create_invoice(%L::uuid, 'cr-sin',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',118000)),
    'sedan', null, %L::uuid, 'Cliente Sin Crédito', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('cli_sin'), test.var('cr_sess')));

select test.expect_error('una venta a crédito no genera cambio',
  format($q$select public.create_invoice(%L::uuid, 'cr-cambio',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',150000)),
    'sedan', null, %L::uuid, 'Flotilla', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('cli_cred'), test.var('cr_sess')));

-- ---- Venta ENTERA a crédito, ligada a una orden de trabajo.
do $$
declare
  v_wo  public.work_orders;
  v_inv public.invoices;
begin
  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'cr-wo-1',
    p_vehicle_plate => 'CR0001',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Flotilla Transporte Cibao',
    p_customer_id => test.var('cli_cred')::uuid);

  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'cr-inv-1',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',118000)),
    'sedan', v_wo.id, test.var('cli_cred')::uuid, 'Flotilla Transporte Cibao',
    null, 'CR0001', null, test.var('cr_sess')::uuid);

  perform test.set_var('cr_wo1',  v_wo.id::text);
  perform test.set_var('cr_inv1', v_inv.id::text);
end $$;

select test.check('la venta fiada abre una cuenta por cobrar por el importe fiado',
  (select total_cents = 118000 and paid_cents = 0 and status = 'pendiente'
     from public.receivables where invoice_id = test.var('cr_inv1')::uuid));

select test.check('el vencimiento respeta el plazo pactado (15 días)',
  (select due_on = current_date + 15
     from public.receivables where invoice_id = test.var('cr_inv1')::uuid));

select test.check('lo fiado NO entra a la caja',
  (select count(*) = 0 from public.cash_movements
    where invoice_id = test.var('cr_inv1')::uuid and type = 'inflow'));

select test.check('la orden fiada queda PENDIENTE de cobro, no pagada',
  (select payment_status = 'pendiente' and payment_method = 'credito'
     from public.work_orders where id = test.var('cr_wo1')::uuid));

-- ---- El cupo se respeta: disponible 82.000 de 200.000.
select test.check('el estado de crédito refleja saldo y disponible',
  (select (s ->> 'balance_cents')::bigint = 118000
      and (s ->> 'available_cents')::bigint = 82000
      and (s ->> 'blocked')::boolean = false
   from public.customer_credit_status(test.var('cli_cred')::uuid) s));

select test.expect_error('fiar por encima del cupo disponible se rechaza',
  format($q$select public.create_invoice(%L::uuid, 'cr-cupo',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',118000)),
    'sedan', null, %L::uuid, 'Flotilla', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('cli_cred'), test.var('cr_sess')));

-- ---- Venta MIXTA: parte en efectivo, parte fiada.
do $$
declare
  v_wo  public.work_orders;
  v_inv public.invoices;
begin
  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'cr-wo-2',
    p_vehicle_plate => 'CR0002',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Flotilla Transporte Cibao',
    p_customer_id => test.var('cli_cred')::uuid);

  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'cr-inv-2',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(
      jsonb_build_object('method','efectivo','amount_cents',60000),
      jsonb_build_object('method','credito','amount_cents',58000)),
    'sedan', v_wo.id, test.var('cli_cred')::uuid, 'Flotilla Transporte Cibao',
    null, 'CR0002', null, test.var('cr_sess')::uuid);

  perform test.set_var('cr_wo2',  v_wo.id::text);
  perform test.set_var('cr_inv2', v_inv.id::text);
end $$;

select test.check('la venta mixta solo fía la parte no cobrada',
  (select total_cents = 58000 from public.receivables
    where invoice_id = test.var('cr_inv2')::uuid));

select test.check('a la caja entra solo el efectivo, no lo fiado',
  (select count(*) = 1 and sum(amount_cents) = 60000 from public.cash_movements
    where invoice_id = test.var('cr_inv2')::uuid and type = 'inflow'));

select test.check('la orden de una venta mixta queda PARCIAL y de método mixto',
  (select payment_status = 'parcial' and payment_method = 'mixto'
     from public.work_orders where id = test.var('cr_wo2')::uuid));

-- ---- Sin crédito nada cambia: el contado sigue quedando pagado.
do $$
declare
  v_wo public.work_orders;
begin
  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'cr-wo-3',
    p_vehicle_plate => 'CR0003',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)));

  perform public.create_invoice(
    test.var('b_a')::uuid, 'cr-inv-3',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',118000)),
    'sedan', v_wo.id, null, 'Consumidor Final', null, 'CR0003', null,
    test.var('cr_sess')::uuid);

  perform test.set_var('cr_wo3', v_wo.id::text);
end $$;

select test.check('la venta al contado sigue quedando pagada (sin regresión)',
  (select payment_status = 'pagado' and payment_method = 'tarjeta'
     from public.work_orders where id = test.var('cr_wo3')::uuid));

select test.check('la venta al contado no abre cuenta por cobrar',
  (select count(*) = 0 from public.receivables r
     join public.invoices i on i.id = r.invoice_id
    where i.client_request_id = 'cr-inv-3'));

-- ==================================================== Abonos y liquidación
select test.expect_error('un abono con método «crédito» se rechaza',
  format($q$select public.collect_receivable(
    (select id from public.receivables where invoice_id = %L), 1000, 'credito')$q$,
    test.var('cr_inv1')));

select test.expect_error('un cobro en efectivo sin caja abierta se rechaza',
  format($q$select public.collect_receivable(
    (select id from public.receivables where invoice_id = %L), 1000, 'efectivo')$q$,
    test.var('cr_inv1')));

select test.expect_error('un abono mayor al saldo se rechaza',
  format($q$select public.collect_receivable(
    (select id from public.receivables where invoice_id = %L), 999999, 'transferencia')$q$,
    test.var('cr_inv1')));

do $$
declare v_r public.receivables;
begin
  v_r := public.collect_receivable(
    (select id from public.receivables where invoice_id = test.var('cr_inv1')::uuid),
    18000, 'efectivo', 'AB-CR-1', test.var('cr_sess')::uuid);
  perform test.set_var('cr_rec1', v_r.id::text);
end $$;

select test.check('el abono parcial reduce el saldo y deja la cuenta pendiente',
  (select paid_cents = 18000 and status = 'pendiente'
     from public.receivables where id = test.var('cr_rec1')::uuid));

select test.check('el abono en efectivo SÍ entra a la caja',
  (select count(*) = 1 from public.cash_movements
    where invoice_id = test.var('cr_inv1')::uuid and type = 'inflow'
      and amount_cents = 18000));

select test.check('el abono deja la orden en cobro parcial',
  (select payment_status = 'parcial' from public.work_orders
    where id = test.var('cr_wo1')::uuid));

do $$
begin
  perform public.collect_receivable(test.var('cr_rec1')::uuid, 100000, 'transferencia', 'AB-CR-2');
end $$;

select test.check('el abono final liquida la cuenta',
  (select status = 'pagada' and paid_cents = total_cents
     from public.receivables where id = test.var('cr_rec1')::uuid));

select test.check('liquidada la cuenta, la orden queda PAGADA',
  (select payment_status = 'pagado' from public.work_orders
    where id = test.var('cr_wo1')::uuid));

select test.expect_error('una cuenta liquidada no admite más abonos',
  format($q$select public.collect_receivable(%L::uuid, 1000, 'efectivo', null, %L::uuid)$q$,
         test.var('cr_rec1'), test.var('cr_sess')));

select test.check('los cobros quedaron en la bitácora',
  (select count(*) = 2 from public.audit_logs
    where action = 'COBRAR_CREDITO' and entity_id = test.var('cr_rec1')::uuid));

-- ================================================== Mora: se corta el grifo
-- Se envejece la cuenta de la venta mixta (única pendiente) 40 días.
set role postgres;
update public.receivables
   set due_on = current_date - 40, issued_on = current_date - 55
 where invoice_id = test.var('cr_inv2')::uuid;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.check('el estado de crédito marca al cliente como bloqueado por mora',
  (select (s ->> 'blocked')::boolean
      and (s ->> 'overdue_cents')::bigint = 58000
   from public.customer_credit_status(test.var('cli_cred')::uuid) s));

select test.expect_error('un cliente con facturas vencidas no se lleva otro lavado fiado',
  format($q$select public.create_invoice(%L::uuid, 'cr-mora',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',118000)),
    'sedan', null, %L::uuid, 'Flotilla', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('cli_cred'), test.var('cr_sess')));

-- ==================================================== Vejez de saldos
select test.expect_error('un cajero no consulta la vejez de saldos',
  $q$select public.receivables_aging()$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('la vejez de saldos coloca los 58.000 en el tramo 31-60 días',
  (select (a #>> '{totals,d31_60}')::bigint = 58000
      and (a #>> '{totals,corriente}')::bigint = 0
      and (a #>> '{totals,vencido}')::bigint = 58000
   from public.receivables_aging() a));

select test.check('la vejez de saldos desglosa por cliente',
  (select jsonb_array_length(a -> 'by_customer') = 1
      and (a #> '{by_customer,0}' ->> 'customer_name') = 'Flotilla Transporte Cibao'
   from public.receivables_aging() a));

-- ============================================ El cupo no se recorta a la fuerza
select test.expect_error('no se baja el cupo por debajo del saldo fiado',
  format($q$select public.set_customer_credit(%L::uuid, true, 1000, 15)$q$, test.var('cli_cred')));
select test.expect_error('no se retira el crédito con saldo pendiente',
  format($q$select public.set_customer_credit(%L::uuid, false)$q$, test.var('cli_cred')));

-- ==================================== Anular una factura fiada cierra la cuenta
do $$
begin
  perform public.annul_invoice(test.var('cr_inv2')::uuid,
    'Servicio no prestado: el vehículo se retiró antes', 'cr-nc-2');
end $$;

select test.check('anular la factura cancela su cuenta por cobrar',
  (select status = 'anulada' from public.receivables
    where invoice_id = test.var('cr_inv2')::uuid));

select test.check('cancelada la cuenta, el cliente deja de estar en mora y recupera el cupo',
  (select (s ->> 'blocked')::boolean = false
      and (s ->> 'balance_cents')::bigint = 0
      and (s ->> 'available_cents')::bigint = 200000
   from public.customer_credit_status(test.var('cli_cred')::uuid) s));

select test.check('la anulación revirtió de la caja el efectivo de la venta mixta',
  (select count(*) = 1 from public.cash_movements
    where type = 'outflow' and amount_cents = 60000
      and reason like 'Anulación de%'));

-- Con el saldo en cero, ahora sí se puede retirar el crédito.
do $$
begin
  perform public.set_customer_credit(test.var('cli_cred')::uuid, false);
end $$;

select test.check('sin saldo, retirar el crédito deja cupo y plazo en cero',
  (select not credit_enabled and credit_limit_cents = 0 and credit_terms_days = 0
     from public.customers where id = test.var('cli_cred')::uuid));

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve las cuentas por cobrar de Alfa',
  (select count(*) = 0 from public.receivables));
select test.expect_error('Beta no autoriza crédito a un cliente de Alfa',
  format($q$select public.set_customer_credit(%L::uuid, true, 100000, 10)$q$, test.var('cli_cred')));
select test.expect_error('Beta no cobra una cuenta de Alfa',
  format($q$select public.collect_receivable(%L::uuid, 1000, 'transferencia')$q$, test.var('cr_rec1')));

set role postgres;
