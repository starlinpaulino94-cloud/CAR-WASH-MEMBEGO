-- =============================================================================
-- Pruebas de notas de crédito parciales (migración 0034)
-- =============================================================================
-- Continúa sobre Alfa/Beta. Lo que se demuestra: se acreditan CANTIDADES de
-- líneas concretas, dos notas sobre la misma línea no se pasan de lo facturado,
-- el inventario vuelve solo por lo acreditado, y lo fiado baja la deuda antes
-- de tocar la caja.
-- =============================================================================

set role postgres;

do $$
declare v_sess uuid;
begin
  select id into v_sess from public.cash_sessions
  where branch_id = test.var('b_a')::uuid and status = 'open';
  if v_sess is null then
    insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
      values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('u_cashier_a')::uuid, 900000)
      returning id into v_sess;
  end if;
  perform test.set_var('nc_sess', v_sess::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- Una venta con dos líneas: 3 productos de 250,00 y 1 servicio de 1.000,00.
do $$
declare v_inv public.invoices;
begin
  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'nc-inv-1',
    jsonb_build_array(
      jsonb_build_object('item_type','product','product_id',test.var('prod'),
        'name','Aromatizante','quantity',3,'discount_cents',0,'is_membego_covered',false),
      jsonb_build_object('item_type','service','service_id',test.var('serv'),
        'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',206500)),
    'sedan', null, null, 'Cliente NC', null, 'NC0001', null, test.var('nc_sess')::uuid);
  perform test.set_var('nc_inv', v_inv.id::text);
  perform test.set_var('nc_total', v_inv.total_cents::text);
end $$;

select test.set_var('nc_linea_prod',
  (select id::text from public.invoice_items
    where invoice_id = test.var('nc_inv')::uuid and item_type = 'product'));
select test.set_var('nc_stock_pre',
  (select stock::text from public.products where id = test.var('prod')::uuid));

-- =============================================== Quién puede y qué se valida
select test.expect_error('un cajero no emite notas de crédito',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',1)), 'Motivo', 'nc-1')$q$,
    test.var('nc_inv'), test.var('nc_linea_prod')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('una nota de crédito sin motivo se rechaza',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',1)), '  ', 'nc-2')$q$,
    test.var('nc_inv'), test.var('nc_linea_prod')));

select test.expect_error('acreditar más unidades de las facturadas se rechaza',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',9)),
    'De más', 'nc-3')$q$, test.var('nc_inv'), test.var('nc_linea_prod')));

select test.expect_error('una línea de otra factura no se acredita aquí',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',1)),
    'Ajena', 'nc-4')$q$, test.var('nc_inv'), gen_random_uuid()));

-- ==================================================== Primera nota parcial
-- 1 de los 3 productos: 250,00 + 18 % = 295,00.
select test.set_var('nc1',
  (public.credit_note_invoice(test.var('nc_inv')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id', test.var('nc_linea_prod'), 'quantity', 1)),
    'Se entregó uno de menos', 'nc-parcial-1')).id::text);

select test.check('la nota acredita solo lo seleccionado, no la factura entera',
  (select total_cents = 29500 and credits_invoice_id = test.var('nc_inv')::uuid
     from public.invoices where id = test.var('nc1')::uuid),
  (select total_cents::text from public.invoices where id = test.var('nc1')::uuid));

select test.check('la factura original sigue vigente, con lo acreditado anotado',
  (select not is_annulled and credited_cents = 29500
     from public.invoices where id = test.var('nc_inv')::uuid));

select test.check('la línea recuerda cuánto se le acreditó',
  (select credited_quantity = 1 from public.invoice_items
    where id = test.var('nc_linea_prod')::uuid));

select test.check('el inventario volvió SOLO por la unidad acreditada',
  (select stock from public.products where id = test.var('prod')::uuid)
    = test.var('nc_stock_pre')::integer + 1,
  format('%s → %s', test.var('nc_stock_pre'),
         (select stock from public.products where id = test.var('prod')::uuid)));

select test.check('la devolución salió de la caja por el importe acreditado',
  (select count(*) = 1 from public.cash_movements
    where invoice_id = test.var('nc1')::uuid and type = 'outflow' and amount_cents = 29500));

select test.check('la nota quedó en la bitácora con su motivo',
  (select count(*) = 1 from public.audit_logs
    where action = 'NOTA_CREDITO' and entity_id = test.var('nc_inv')::uuid
      and details like '%Se entregó uno de menos%'));

-- Idempotencia: la misma clave devuelve la misma nota, no emite otra.
select test.check('repetir la petición devuelve la MISMA nota',
  (public.credit_note_invoice(test.var('nc_inv')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id', test.var('nc_linea_prod'), 'quantity', 1)),
    'Se entregó uno de menos', 'nc-parcial-1')).id = test.var('nc1')::uuid);

select test.check('la repetición no volvió a devolver inventario',
  (select stock from public.products where id = test.var('prod')::uuid)
    = test.var('nc_stock_pre')::integer + 1);

-- ==================================================== Segunda nota parcial
select test.expect_error('las dos notas juntas no pueden pasarse de lo facturado',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',3)),
    'De más otra vez', 'nc-parcial-x')$q$,
    test.var('nc_inv'), test.var('nc_linea_prod')));

do $$
begin
  perform public.credit_note_invoice(test.var('nc_inv')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id', test.var('nc_linea_prod'), 'quantity', 2)),
    'Se devolvieron los otros dos', 'nc-parcial-2');
end $$;

select test.check('la segunda nota acumula sobre la primera',
  (select credited_quantity = 3 from public.invoice_items
    where id = test.var('nc_linea_prod')::uuid));

select test.check('la factura sigue vigente porque falta el servicio por acreditar',
  (select not is_annulled and credited_cents = 88500
     from public.invoices where id = test.var('nc_inv')::uuid),
  (select credited_cents::text from public.invoices where id = test.var('nc_inv')::uuid));

-- ============================================= Al acreditarlo todo, se anula
select test.set_var('nc_linea_serv',
  (select id::text from public.invoice_items
    where invoice_id = test.var('nc_inv')::uuid and item_type = 'service'));

do $$
begin
  perform public.credit_note_invoice(test.var('nc_inv')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id', test.var('nc_linea_serv'), 'quantity', 1)),
    'El servicio tampoco se prestó', 'nc-parcial-3');
end $$;

select test.check('acreditado el total, la factura queda anulada con su motivo',
  (select is_annulled and credited_cents = total_cents and annulled_at is not null
     from public.invoices where id = test.var('nc_inv')::uuid));

select test.expect_error('una factura ya anulada no admite más notas',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',1)),
    'Tarde', 'nc-parcial-4')$q$, test.var('nc_inv'), test.var('nc_linea_serv')));

select test.expect_error('una nota de crédito no se acredita a su vez',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',1)),
    'Recursivo', 'nc-parcial-5')$q$, test.var('nc1'), test.var('nc_linea_prod')));

-- =========================== Lo fiado baja la deuda antes de tocar la caja
do $$
declare v_cli uuid; v_inv public.invoices;
begin
  insert into public.customers (company_id, branch_id, name)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Cliente NC Crédito')
    returning id into v_cli;
  perform test.set_var('nc_cli', v_cli::text);
  perform public.set_customer_credit(v_cli, true, 500000, 30);

  -- Servicio de 1.000,00 + 18 % = 1.180,00, todo a crédito.
  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'nc-inv-cred',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',118000)),
    'sedan', null, v_cli, 'Cliente NC Crédito', null, 'NC0002', null,
    test.var('nc_sess')::uuid);
  perform test.set_var('nc_inv_cred', v_inv.id::text);
end $$;

select test.set_var('nc_linea_cred',
  (select id::text from public.invoice_items
    where invoice_id = test.var('nc_inv_cred')::uuid));
select test.set_var('nc_caja_pre',
  (select expected_cash_cents::text from public.cash_sessions where id = test.var('nc_sess')::uuid));

do $$
begin
  perform public.credit_note_invoice(test.var('nc_inv_cred')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id', test.var('nc_linea_cred'), 'quantity', 1)),
    'No se prestó', 'nc-cred-1');
end $$;

select test.check('acreditar una venta fiada cierra la cuenta por cobrar',
  (select status = 'anulada' from public.receivables
    where invoice_id = test.var('nc_inv_cred')::uuid));

select test.check('no se devolvió efectivo de algo que nunca entró a la caja',
  (select expected_cash_cents from public.cash_sessions where id = test.var('nc_sess')::uuid)
    = test.var('nc_caja_pre')::bigint,
  format('%s → %s', test.var('nc_caja_pre'),
         (select expected_cash_cents from public.cash_sessions where id = test.var('nc_sess')::uuid)));

select test.check('el cliente recuperó su cupo',
  (select (s ->> 'balance_cents')::bigint = 0
   from public.customer_credit_status(test.var('nc_cli')::uuid) s));

-- ==================================================== Reinicio de contraseña
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no reinicia contraseñas',
  format($q$select public.reset_employee_password(%L::uuid, 'nuevaclave')$q$, test.var('op1')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_admin_a'), false);
set role authenticated;
select test.expect_error('un administrador no le cambia la clave al propietario',
  format($q$select public.reset_employee_password(%L::uuid, 'nuevaclave')$q$, test.var('u_owner_a')));
select test.expect_error('una contraseña demasiado corta se rechaza',
  format($q$select public.reset_employee_password(%L::uuid, '123')$q$, test.var('op1')));
select test.expect_ok('un administrador sí reinicia la clave de un operario',
  format($q$select public.reset_employee_password(%L::uuid, 'clave-nueva-123')$q$, test.var('op1')));

select test.check('el reinicio quedó en la bitácora',
  (select count(*) = 1 from public.audit_logs
    where action = 'REINICIAR_CLAVE' and entity_id = test.var('op1')::uuid));

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.expect_error('Beta no acredita una factura de Alfa',
  format($q$select public.credit_note_invoice(%L::uuid,
    jsonb_build_array(jsonb_build_object('invoice_item_id',%L,'quantity',1)),
    'Robada', 'nc-beta')$q$, test.var('nc_inv_cred'), test.var('nc_linea_cred')));
select test.expect_error('Beta no reinicia la clave de un empleado de Alfa',
  format($q$select public.reset_employee_password(%L::uuid, 'clave-pirata')$q$, test.var('op1')));

set role postgres;
