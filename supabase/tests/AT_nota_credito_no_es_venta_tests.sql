-- =============================================================================
-- Pruebas: la nota de crédito no es una venta, y una orden no se cobra dos veces
-- (migración 20261002130000)
-- =============================================================================
-- Lo que se demuestra, sobre Alfa:
--
--   · Anular un RECIBO INTERNO (sin NCF) emite una nota marcada B04, y el
--     informe deja de contarla como venta de quien anuló. Antes del arreglo la
--     nota nacía sin tipo, el filtro `ncf_type is distinct from 'B04'` no la
--     reconocía, y la venta del cajero reaparecía a nombre del que anuló.
--   · El candado de la tabla vuelve a rechazar de verdad: escrito con `=` daba
--     NULL con el tipo nulo y el CHECK aceptaba la fila que existía para
--     prohibir.
--   · La misma orden no admite una segunda factura vigente, y el rechazo dice
--     cuál es la primera. Si esa se anula, la orden vuelve a poder cobrarse.
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
  perform test.set_var('nv_sess', v_sess::text);
end $$;

-- Lo que el informe le atribuye HOY a cada uno, antes de tocar nada.
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v jsonb;
begin
  v := public.sales_report(current_date, current_date, '{}'::jsonb) -> 'por_cajero';
  perform test.set_var('nv_duenno_antes', coalesce((
    select r ->> 'sales_cents' from jsonb_array_elements(v) r
    where r ->> 'profile_id' = test.var('u_owner_a')), '0'));
end $$;

-- ─────────────────────────────────────────── Una venta del cajero, sin NCF
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

do $$
declare v_o public.work_orders; v_inv public.invoices;
begin
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'nv-wo-1',
    p_vehicle_plate=>'NV0001', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Nota');
  perform test.set_var('nv_wo', v_o.id::text);

  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'nv-inv-1',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',118000)),
    'sedan', v_o.id, null, 'Cliente Nota', null, 'NV0001', null, test.var('nv_sess')::uuid);
  perform test.set_var('nv_inv', v_inv.id::text);
  perform test.set_var('nv_inv_num', v_inv.invoice_number);
  perform test.set_var('nv_inv_total', v_inv.total_cents::text);

  perform test.check('la venta del cajero sale sin NCF: es un recibo interno',
    v_inv.ncf is null and v_inv.ncf_type is null,
    format('ncf=%s tipo=%s', coalesce(v_inv.ncf,'nulo'), coalesce(v_inv.ncf_type::text,'nulo')));
end $$;

-- ─────────────────────────────────────────────────── El dueño la anula
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_nota public.invoices;
begin
  v_nota := public.annul_invoice(test.var('nv_inv')::uuid, 'Cobro equivocado', 'nv-anula-1');
  perform test.set_var('nv_nota', v_nota.id::text);
  perform test.set_var('nv_nota_num', v_nota.invoice_number);

  perform test.check('la nota de crédito de un recibo interno queda marcada B04',
    v_nota.ncf_type = 'B04',
    format('tipo=%s ncf=%s', coalesce(v_nota.ncf_type::text,'nulo'), coalesce(v_nota.ncf,'(sin ncf)')));

  perform test.check('sigue sin número fiscal: el tipo dice qué es, no que tenga NCF',
    v_nota.ncf is null and v_nota.credits_invoice_id = test.var('nv_inv')::uuid);

  perform test.check('anular una orden ya facturada no choca con el candado de la orden',
    v_nota.work_order_id = test.var('nv_wo')::uuid);
end $$;

-- ───────────────────────────────── El informe no se la apunta a quien anuló
do $$
declare v jsonb; v_ahora bigint;
begin
  v := public.sales_report(current_date, current_date, '{}'::jsonb) -> 'por_cajero';
  v_ahora := coalesce((select (r ->> 'sales_cents')::bigint from jsonb_array_elements(v) r
                       where r ->> 'profile_id' = test.var('u_owner_a')), 0);

  perform test.check('quien anula no suma la venta: su importe en el informe no se mueve',
    v_ahora = test.var('nv_duenno_antes')::bigint,
    format('antes=%s ahora=%s (la nota valía %s)',
           test.var('nv_duenno_antes'), v_ahora, test.var('nv_inv_total')));
end $$;

do $$
declare v_nums text[];
begin
  select coalesce(array_agg(r ->> 'invoice_number'), '{}')
    into v_nums
    from jsonb_array_elements(
      public.sales_report_invoices(current_date, current_date,
        jsonb_build_object('status','todas'), 0, 200) -> 'rows') r;

  perform test.check('la nota no aparece en el listado de facturas del informe',
    not (test.var('nv_nota_num') = any(v_nums)),
    format('nota=%s', test.var('nv_nota_num')));

  perform test.check('la factura anulada sí aparece, marcada como anulada',
    test.var('nv_inv_num') = any(v_nums));
end $$;

-- ──────────────────────────── El candado de la tabla vuelve a rechazar
-- Con el trigger puesto no hay forma de escribir una nota sin tipo: lo pone él.
-- Se desactiva a propósito para comprobar que DEBAJO está la restricción, que
-- es la que falló en silencio (`false or NULL` no rechaza).
set role postgres;
alter table public.invoices disable trigger invoices_nota_es_b04;

select test.expect_error('sin el trigger, la restricción rechaza una nota sin tipo',
  format('update public.invoices set ncf_type = null where id = %L', test.var('nv_nota')));

alter table public.invoices enable trigger invoices_nota_es_b04;

select test.check('la nota conserva su tipo tras el intento',
  (select ncf_type = 'B04' from public.invoices where id = test.var('nv_nota')::uuid));

-- ─────────────────────────────────────────── Una orden, una factura vigente
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

do $$
declare v_o public.work_orders; v_inv public.invoices;
begin
  v_o := public.create_work_order(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'nv-wo-2',
    p_vehicle_plate=>'NV0002', p_vehicle_category=>'sedan',
    p_items=>jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name=>'Cliente Doble');
  perform test.set_var('nv_wo2', v_o.id::text);

  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'nv-inv-2a',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',118000)),
    'sedan', v_o.id, null, 'Cliente Doble', null, 'NV0002', null, test.var('nv_sess')::uuid);
  perform test.set_var('nv_inv2', v_inv.id::text);
  perform test.set_var('nv_inv2_num', v_inv.invoice_number);
end $$;

-- Otra clave de idempotencia: es lo que trae una segunda pestaña o una recarga.
do $$
declare v_msg text := '';
begin
  begin
    perform public.create_invoice(
      test.var('b_a')::uuid, 'nv-inv-2b',
      jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
        'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
      jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',118000)),
      'sedan', test.var('nv_wo2')::uuid, null, 'Cliente Doble', null, 'NV0002', null,
      test.var('nv_sess')::uuid);
  exception when others then
    v_msg := sqlerrm;
  end;

  -- Falla, y además DICE cuál es la factura que ya existe: sin el número, el
  -- cajero no sabe si cobró o no.
  perform test.check('la misma orden no se factura dos veces, y el aviso nombra la primera',
    v_msg like '%ya se facturó%' and v_msg like '%' || test.var('nv_inv2_num') || '%',
    coalesce(nullif(v_msg,''), 'NO falló: se emitió la segunda factura'));
end $$;

select test.check('la orden se queda con UNA sola factura',
  (select count(*) = 1 from public.invoices
    where work_order_id = test.var('nv_wo2')::uuid and credits_invoice_id is null));

-- Anulada la primera, el lavado vuelve a poder cobrarse: así se arregla un
-- cobro equivocado, y el candado no puede dejar una orden muerta.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
select test.expect_ok('tras anular, la orden admite otra factura',
  format($q$select public.annul_invoice(%L::uuid, 'Se cobró de más', 'nv-anula-2')$q$,
    test.var('nv_inv2')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

do $$
declare v_inv public.invoices;
begin
  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'nv-inv-2c',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',118000)),
    'sedan', test.var('nv_wo2')::uuid, null, 'Cliente Doble', null, 'NV0002', null,
    test.var('nv_sess')::uuid);
  perform test.check('con la primera anulada, la orden se vuelve a facturar',
    v_inv.id is not null and v_inv.invoice_number is distinct from test.var('nv_inv2_num'));
exception when others then
  perform test.check('con la primera anulada, la orden se vuelve a facturar', false, sqlerrm);
end $$;

set role postgres;
