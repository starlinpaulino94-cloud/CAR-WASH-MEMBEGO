-- =============================================================================
-- ITBIS incluido en el precio · pruebas (migración 20260821130000)
-- =============================================================================
-- Continúa sobre los datos de 10_rls_tests.sql / 20_billing_tests.sql.
-- Prueba el interruptor `prices_include_tax`: con él activo, el precio YA trae
-- el ITBIS y se extrae, no se suma. Con él apagado, el comportamiento aditivo
-- de siempre (ya cubierto por 20_billing).
-- =============================================================================

set role postgres;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_serv uuid;
  v_sess uuid;
  v_inv public.invoices;
begin
  select id into v_serv from public.services where company_id = v_c limit 1;
  -- Precio de lista 1.000,00 para sedán (100000 centavos).
  delete from public.service_prices where service_id = v_serv and vehicle_category = 'sedan';
  insert into public.service_prices (service_id, vehicle_category, price_cents)
    values (v_serv, 'sedan', 100000);

  -- Empresa con ITBIS 18% e INCLUIDO en el precio.
  update public.companies set tax_rate_bps = 1800, prices_include_tax = true where id = v_c;

  delete from public.ncf_sequences where company_id = v_c;
  insert into public.ncf_sequences (company_id, ncf_type, range_start, range_end, next_value, authorized_until)
    values (v_c,'B02',9000,9999,9000, current_date + 365);

  delete from public.cash_movements where company_id = v_c;
  delete from public.cash_sessions  where company_id = v_c;
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values (v_c, test.var('b_a')::uuid, test.var('u_cashier_a')::uuid, 0)
    returning id into v_sess;

  perform test.set_var('itbis_serv', v_serv::text);
  perform test.set_var('itbis_sess', v_sess::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

do $$
declare v_inv public.invoices;
begin
  v_inv := public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'itbis-inc-1',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'item_type','service','service_id',test.var('itbis_serv'),
                            'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_payments         => jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',100000)),
    p_vehicle_category => 'sedan',
    p_ncf_type         => 'B02',
    p_cash_session_id  => test.var('itbis_sess')::uuid
  );

  -- El ejemplo del dueño: un servicio de 1.000 se COBRA 1.000 (no 1.180); el
  -- ITBIS va incluido: base = round(100000*10000/11800)=84746, ITBIS=15254.
  perform test.check('con ITBIS incluido, el cliente paga el precio de lista (no +18%)',
    v_inv.total_cents = 100000, 'total=' || v_inv.total_cents);
  perform test.check('el ITBIS se extrae de adentro (15254 sobre 100000)',
    v_inv.tax_cents = 15254, 'tax=' || v_inv.tax_cents);
  perform test.check('base + ITBIS = total (84746 + 15254 = 100000)',
    (v_inv.total_cents - v_inv.tax_cents) = 84746, 'base=' || (v_inv.total_cents - v_inv.tax_cents));
  -- El pago de 1.000 basta y no hay vuelto (antes exigía 1.180).
  perform test.check('el pago de 1.000 cubre el total, sin exigir 1.180',
    v_inv.change_cents = 0, 'cambio=' || v_inv.change_cents);
end $$;

-- Se restaura la empresa a NO incluido para no ensuciar las pruebas siguientes.
set role postgres;
update public.companies set prices_include_tax = false where id = test.var('c_a')::uuid;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- Y con el flag apagado, el MISMO servicio vuelve a sumar el 18% encima.
do $$
declare v_inv public.invoices;
begin
  v_inv := public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'itbis-add-1',
    p_items            => jsonb_build_array(jsonb_build_object(
                            'item_type','service','service_id',test.var('itbis_serv'),
                            'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_payments         => jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',118000)),
    p_vehicle_category => 'sedan',
    p_ncf_type         => 'B02',
    p_cash_session_id  => test.var('itbis_sess')::uuid
  );
  perform test.check('con el flag apagado, el 18% se suma encima (100000 -> 118000)',
    v_inv.total_cents = 118000 and v_inv.tax_cents = 18000,
    'total=' || v_inv.total_cents || ' tax=' || v_inv.tax_cents);
end $$;

set role postgres;
