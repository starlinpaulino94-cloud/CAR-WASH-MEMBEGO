-- =============================================================================
-- Pruebas de gastos, métricas y bitácora de integración (migración 0011)
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- =============================================================== Gastos

select test.expect_error('un gasto en efectivo sin caja abierta se rechaza',
  format($q$select public.create_expense(%L::uuid,'gasto-sincaja','Jabón',50000,
    'quimicos_insumos','efectivo',null,null,null,null)$q$, test.var('b_a')));

select test.expect_error('un importe de gasto no positivo se rechaza',
  format($q$select public.create_expense(%L::uuid,'gasto-cero','Nada',0)$q$, test.var('b_a')));

do $$
declare v_sess uuid; v_before bigint; v_exp public.expenses;
begin
  -- Reabrir caja: las pruebas de facturación la dejaron cerrada.
  set local role postgres;
  update public.cash_sessions set status='open', closed_at=null, counted_cash_cents=null,
         difference_cents=null where branch_id = test.var('b_a')::uuid;
  select id into v_sess from public.cash_sessions where status='open' limit 1;
  perform test.set_var('sess2', v_sess::text);
  select expected_cash_cents into v_before from public.cash_sessions where id = v_sess;
  perform test.set_var('cash_before_exp', v_before::text);
  set local role authenticated;

  v_exp := public.create_expense(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'gasto-1',
    p_description=>'Compra de toallas', p_amount_cents=>75000,
    p_category=>'quimicos_insumos', p_payment_method=>'efectivo',
    p_cash_session_id=>v_sess);

  perform test.check('el gasto se registra en centavos',
    v_exp.amount_cents = 75000 and v_exp.description = 'Compra de toallas');
end $$;

select test.check('un gasto en efectivo genera su salida de caja',
  (select count(*) = 1 from public.cash_movements
    where type='outflow' and reason like 'Gasto:%'));

select test.check('el efectivo esperado baja exactamente el importe del gasto',
  (select expected_cash_cents from public.cash_sessions where id = test.var('sess2')::uuid)
    = test.var('cash_before_exp')::bigint - 75000,
  format('antes=%s ahora=%s', test.var('cash_before_exp'),
    (select expected_cash_cents::text from public.cash_sessions where id = test.var('sess2')::uuid)));

-- Idempotencia.
do $$
declare v_a public.expenses; v_before integer; v_after integer; v_cash bigint;
begin
  select count(*) into v_before from public.expenses;
  select expected_cash_cents into v_cash from public.cash_sessions where id = test.var('sess2')::uuid;
  v_a := public.create_expense(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'gasto-1',
    p_description=>'Compra de toallas', p_amount_cents=>75000,
    p_payment_method=>'efectivo', p_cash_session_id=>test.var('sess2')::uuid);
  select count(*) into v_after from public.expenses;
  perform test.check('el doble registro de gasto no duplica ni el gasto ni la salida de caja',
    v_before = v_after
    and (select expected_cash_cents from public.cash_sessions where id = test.var('sess2')::uuid) = v_cash,
    format('gastos antes=%s después=%s', v_before, v_after));
end $$;

-- Un gasto con tarjeta no toca el efectivo de la gaveta.
do $$
declare v_cash bigint;
begin
  select expected_cash_cents into v_cash from public.cash_sessions where id = test.var('sess2')::uuid;
  perform public.create_expense(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'gasto-tarjeta',
    p_description=>'Suscripción software', p_amount_cents=>120000,
    p_payment_method=>'tarjeta');
  perform test.check('un gasto con tarjeta no altera el efectivo esperado',
    (select expected_cash_cents from public.cash_sessions where id = test.var('sess2')::uuid) = v_cash);
end $$;

-- =============================================================== Métricas

do $$
declare v_m jsonb;
begin
  v_m := public.dashboard_metrics(test.var('b_a')::uuid,
                                  now() - interval '1 day', now() + interval '1 day');
  perform test.check('las métricas devuelven la cola actual y las ventas del periodo',
    (v_m ->> 'in_queue') is not null and (v_m ->> 'sales_cents') is not null
    and (v_m ->> 'avg_ticket_cents') is not null,
    v_m::text);

  perform test.set_var('sales_hoy', v_m ->> 'sales_cents');
end $$;

-- El filtro de fechas debe SIGNIFICAR algo: un periodo pasado da cero ventas.
do $$
declare v_m jsonb;
begin
  v_m := public.dashboard_metrics(test.var('b_a')::uuid,
                                  now() - interval '30 day', now() - interval '20 day');
  perform test.check('un periodo sin actividad devuelve ventas en cero',
    (v_m ->> 'sales_cents') = '0' and (v_m ->> 'invoice_count') = '0',
    format('ventas=%s facturas=%s', v_m ->> 'sales_cents', v_m ->> 'invoice_count'));

  perform test.check('el periodo de hoy SÍ tiene ventas (el filtro no es decorativo)',
    test.var('sales_hoy') <> '0', 'ventas hoy = ' || test.var('sales_hoy'));
end $$;

-- Las facturas anuladas no cuentan como ingreso.
do $$
declare v_m jsonb;
begin
  v_m := public.dashboard_metrics(test.var('b_a')::uuid,
                                  now() - interval '1 day', now() + interval '1 day');
  perform test.check('lo anulado se reporta aparte y no suma a las ventas',
    (v_m ->> 'annulled_cents')::bigint > 0,
    format('anulado=%s ventas=%s', v_m ->> 'annulled_cents', v_m ->> 'sales_cents'));
end $$;

-- =============================================================== Bitácora Membego

do $$
begin
  insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
  values (test.var('c_a')::uuid, 'validate_qr', 'idem-1', 'success', '{"q":"x"}'::jsonb);

  perform test.check('la bitácora Membego sella al actor y la hora en el servidor',
    (select actor_id = test.var('u_cashier_a')::uuid and occurred_at is not null
       from public.membego_sync_logs order by id desc limit 1));
end $$;

select test.expect_error('la bitácora Membego rechaza UPDATE',
  'update public.membego_sync_logs set status = ''failed''');

select test.expect_error('la bitácora Membego rechaza DELETE',
  'delete from public.membego_sync_logs');

-- =============================================================== Aislamiento

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('la empresa Beta no ve los gastos de Alfa',
  (select count(*) = 0 from public.expenses));

select test.check('la empresa Beta no ve la bitácora Membego de Alfa',
  (select count(*) = 0 from public.membego_sync_logs));

do $$
declare v_m jsonb;
begin
  -- Consultar métricas de la sucursal ajena no filtra nada: RLS vacía las
  -- tablas de origen, así que todos los agregados salen a cero.
  v_m := public.dashboard_metrics(test.var('b_a')::uuid,
                                  now() - interval '1 day', now() + interval '1 day');
  perform test.check('las métricas de una sucursal ajena salen todas a cero',
    (v_m ->> 'sales_cents') = '0' and (v_m ->> 'in_queue') = '0'
    and (v_m ->> 'invoice_count') = '0',
    v_m::text);
end $$;

reset role;
