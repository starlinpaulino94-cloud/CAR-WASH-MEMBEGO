-- =============================================================================
-- Pruebas de facturación transaccional y notas de crédito (migración 0008)
-- =============================================================================
-- Continúa sobre los datos creados por 10_rls_tests.sql.
-- Se ejecuta como `authenticated`, nunca como superusuario.
-- =============================================================================

-- --------------------------------------------------------------- Preparación
set role postgres;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_b uuid := test.var('b_a')::uuid;
  v_serv uuid; v_prod uuid; v_sess uuid;
begin
  -- Precio de catálogo para el servicio de Alfa: 1.000,00 (100000 centavos).
  select id into v_serv from public.services where company_id = v_c limit 1;
  insert into public.service_prices (service_id, vehicle_category, price_cents)
    values (v_serv, 'sedan', 100000);

  -- Producto con stock conocido.
  insert into public.products (company_id, branch_id, code, name, price_cents, cost_cents, stock, min_stock)
    values (v_c, v_b, 'P1', 'Aromatizante', 25000, 10000, 40, 5)
    returning id into v_prod;

  -- Rangos NCF amplios: B02 para ventas, B04 para notas de crédito.
  delete from public.ncf_sequences where company_id = v_c;
  insert into public.ncf_sequences (company_id, ncf_type, range_start, range_end, next_value, authorized_until)
    values (v_c,'B02',1,1000,1, current_date + 365),
           (v_c,'B04',1,1000,1, current_date + 365);

  -- Caja limpia y abierta.
  delete from public.cash_movements where company_id = v_c;
  delete from public.cash_sessions  where company_id = v_c;
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values (v_c, v_b, test.var('u_cashier_a')::uuid, 300000)
    returning id into v_sess;

  perform test.set_var('serv', v_serv::text);
  perform test.set_var('prod', v_prod::text);
  perform test.set_var('sess', v_sess::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- =============================================================== Emisión

do $$
declare
  v_inv public.invoices;
  v_items jsonb;
  v_pays  jsonb;
begin
  -- 1 servicio de 1.000,00 + 2 productos de 250,00 = 1.500,00; ITBIS 18% = 270,00
  v_items := jsonb_build_array(
    jsonb_build_object('item_type','service','service_id',test.var('serv'),
                       'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false),
    jsonb_build_object('item_type','product','product_id',test.var('prod'),
                       'name','Aromatizante','quantity',2,'discount_cents',0,'is_membego_covered',false)
  );
  v_pays := jsonb_build_array(
    jsonb_build_object('method','efectivo','amount_cents',200000,'reference',null)
  );

  v_inv := public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'req-0001',
    p_items            => v_items,
    p_payments         => v_pays,
    p_vehicle_category => 'sedan',
    p_ncf_type         => 'B02',
    p_cash_session_id  => test.var('sess')::uuid
  );

  perform test.check('la factura calcula subtotal, ITBIS y total en el servidor',
    v_inv.subtotal_cents = 150000 and v_inv.tax_cents = 27000 and v_inv.total_cents = 177000,
    format('sub=%s tax=%s total=%s', v_inv.subtotal_cents, v_inv.tax_cents, v_inv.total_cents));

  perform test.check('el cambio se calcula una sola vez sobre el total',
    v_inv.change_cents = 23000, v_inv.change_cents::text);

  perform test.check('se asigna NCF de tipo B02',
    v_inv.ncf = 'B0200000001' and v_inv.ncf_type = 'B02', coalesce(v_inv.ncf,'(nulo)'));

  perform test.set_var('inv1', v_inv.id::text);
end $$;

select test.check('el inventario se descuenta al facturar',
  (select stock = 38 from public.products where id = test.var('prod')::uuid),
  (select stock::text from public.products where id = test.var('prod')::uuid));

-- Efectivo neto en gaveta = 300.000 inicial + (200.000 recibido − 23.000 cambio)
select test.check('la caja recibe el efectivo NETO del cambio, no el bruto',
  (select expected_cash_cents = 477000 from public.cash_sessions where id = test.var('sess')::uuid),
  (select expected_cash_cents::text from public.cash_sessions where id = test.var('sess')::uuid));

-- ============================================================ DB-002 · Snapshot
-- Lo vendido no puede cambiar retroactivamente. Se cambia el precio Y el nombre
-- del producto EN EL CATÁLOGO después de facturar, y la línea de la factura ya
-- emitida debe seguir con el precio y el nombre de cuando se vendió.
set role postgres;
update public.products
   set price_cents = 999999, name = 'Aromatizante RENOMBRADO'
 where id = test.var('prod')::uuid;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.check('el precio vendido queda congelado en la factura, no sigue al catálogo',
  (select unit_price_cents = 25000 from public.invoice_items
    where invoice_id = test.var('inv1')::uuid and product_id = test.var('prod')::uuid),
  (select unit_price_cents::text from public.invoice_items
    where invoice_id = test.var('inv1')::uuid and product_id = test.var('prod')::uuid));

select test.check('el nombre vendido queda congelado en la factura',
  (select name = 'Aromatizante' from public.invoice_items
    where invoice_id = test.var('inv1')::uuid and product_id = test.var('prod')::uuid),
  (select name from public.invoice_items
    where invoice_id = test.var('inv1')::uuid and product_id = test.var('prod')::uuid));

-- Se restaura el catálogo para no ensuciar las pruebas siguientes.
set role postgres;
update public.products set price_cents = 25000, name = 'Aromatizante'
 where id = test.var('prod')::uuid;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- =============================================================== Idempotencia

do $$
declare v_a public.invoices; v_b public.invoices; v_count_before integer; v_count_after integer;
begin
  select count(*) into v_count_before from public.invoices;

  -- Mismo click, dos veces (la clave la genera el cliente UNA vez por operación).
  v_a := public.create_invoice(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'req-0001',
    p_items=>jsonb_build_array(jsonb_build_object('item_type','service',
        'service_id',test.var('serv'),'name','Lavado','quantity',1,
        'discount_cents',0,'is_membego_covered',false)),
    p_payments=>jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',200000)),
    p_ncf_type=>'B02', p_cash_session_id=>test.var('sess')::uuid);

  select count(*) into v_count_after from public.invoices;

  perform test.check('el doble clic devuelve la MISMA factura, no emite otra',
    v_a.id = test.var('inv1')::uuid and v_count_before = v_count_after,
    format('facturas antes=%s después=%s', v_count_before, v_count_after));
end $$;

select test.check('el doble clic no vuelve a descontar inventario',
  (select stock = 38 from public.products where id = test.var('prod')::uuid),
  (select stock::text from public.products where id = test.var('prod')::uuid));

select test.check('el doble clic no vuelve a sumar el ingreso a la caja',
  (select expected_cash_cents = 477000 from public.cash_sessions where id = test.var('sess')::uuid),
  (select expected_cash_cents::text from public.cash_sessions where id = test.var('sess')::uuid));

-- El cajero NO puede leer ncf_sequences (política correcta: los rangos
-- fiscales son un recurso controlado), así que la comprobación se hace con un
-- rol autorizado y comparando el delta, no un valor absoluto.
do $$
declare v_before bigint; v_after bigint;
begin
  set local role postgres;
  select next_value into v_before from public.ncf_sequences
   where company_id = test.var('c_a')::uuid and ncf_type = 'B02';

  perform test.check('el doble clic no consume otro NCF',
    v_before = 2, format('next_value=%s tras una sola emisión', v_before));
  set local role authenticated;
end $$;

-- =============================================================== Validaciones

select test.expect_error('rechaza un pago insuficiente',
  format($q$select public.create_invoice(%L::uuid,'req-corto',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,'name','Lavado',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',1000)),
    'sedan', null, null, 'X', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('sess')));

select test.expect_error('rechaza una factura sin líneas',
  format($q$select public.create_invoice(%L::uuid,'req-vacia', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',1000)))$q$,
    test.var('b_a')));

select test.expect_error('rechaza emitir sin clave de idempotencia',
  format($q$select public.create_invoice(%L::uuid, '',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,'name','L',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',200000)))$q$,
    test.var('b_a'), test.var('serv')));

select test.expect_error('rechaza efectivo sin caja abierta',
  format($q$select public.create_invoice(%L::uuid,'req-sincaja',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,'name','L',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',200000)),
    'sedan', null, null, 'X', null, null, null, null)$q$,
    test.var('b_a'), test.var('serv')));

select test.expect_error('rechaza un servicio sin precio para esa categoría',
  format($q$select public.create_invoice(%L::uuid,'req-sinprecio',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,'name','L',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',900000)),
    'truck', null, null, 'X', null, null, null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('sess')));

select test.expect_error('no se puede emitir una venta con NCF de nota de crédito',
  format($q$select public.create_invoice(%L::uuid,'req-b04',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,'name','L',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',200000)),
    'sedan', null, null, 'X', null, null, 'B04', %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('sess')));

-- El precio lo pone el servidor: un cliente manipulado no puede facturar a cero.
do $$
declare v_inv public.invoices;
begin
  v_inv := public.create_invoice(
    p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'req-precio',
    p_items=>jsonb_build_array(jsonb_build_object('item_type','service',
      'service_id',test.var('serv'),'name','Lavado','quantity',1,
      'unit_price_cents',1,          -- intento de fijar el precio desde el cliente
      'discount_cents',0,'is_membego_covered',false)),
    p_payments=>jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',118000)),
    p_cash_session_id=>test.var('sess')::uuid);

  perform test.check('el precio enviado por el cliente se ignora: manda el catálogo',
    v_inv.subtotal_cents = 100000, format('subtotal=%s (esperado 100000)', v_inv.subtotal_cents));
end $$;

-- =============================================================== Anulación

-- Un cajero NO puede anular: debe fallar EXPLÍCITAMENTE, no en silencio.
select test.expect_error('un cajero recibe un error explícito al intentar anular',
  format('select public.annul_invoice(%L::uuid, ''intento no autorizado'', ''req-anul-cajero'')',
         test.var('inv1')));

select test.check('tras el intento del cajero la factura sigue vigente',
  (select not is_annulled from public.invoices where id = test.var('inv1')::uuid));

select test.check('el intento fallido no dejó una nota de crédito a medias',
  (select count(*) = 0 from public.invoices where credits_invoice_id is not null));

select test.check('el intento fallido no alteró el inventario',
  (select stock = 38 from public.products where id = test.var('prod')::uuid));

-- Ahora, el propietario.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_credit public.invoices;
begin
  perform test.set_var('cash_before_annul',
    (select expected_cash_cents::text from public.cash_sessions where id = test.var('sess')::uuid));

  v_credit := public.annul_invoice(
    test.var('inv1')::uuid,
    'Cobro duplicado al cliente',
    'req-anul-0001');

  perform test.check('la anulación emite una nota de crédito B04 con su NCF',
    v_credit.ncf_type = 'B04' and v_credit.ncf = 'B0400000001'
      and v_credit.credits_invoice_id = test.var('inv1')::uuid,
    format('ncf=%s tipo=%s', coalesce(v_credit.ncf,'(nulo)'), coalesce(v_credit.ncf_type::text,'(nulo)')));

  perform test.check('la nota de crédito conserva los importes del original',
    v_credit.total_cents = 177000, v_credit.total_cents::text);

  perform test.set_var('nc1', v_credit.id::text);
end $$;

select test.check('la factura original queda anulada, con motivo y autor',
  (select is_annulled and annulled_reason = 'Cobro duplicado al cliente'
      and annulled_at is not null and annulled_by = test.var('u_owner_a')::uuid
      and credit_note_id = test.var('nc1')::uuid
     from public.invoices where id = test.var('inv1')::uuid));

select test.check('la anulación devuelve el inventario',
  (select stock = 40 from public.products where id = test.var('prod')::uuid),
  (select stock::text from public.products where id = test.var('prod')::uuid));

-- Se compara contra el efectivo previo a la anulación menos el total devuelto,
-- no contra una cifra fija: entre medias se emitieron otras facturas.
select test.check('la anulación revierte exactamente el efectivo de esa factura',
  (select expected_cash_cents from public.cash_sessions where id = test.var('sess')::uuid)
    = test.var('cash_before_annul')::bigint - 177000,
  format('antes=%s ahora=%s esperado=%s', test.var('cash_before_annul'),
    (select expected_cash_cents::text from public.cash_sessions where id = test.var('sess')::uuid),
    test.var('cash_before_annul')::bigint - 177000));

select test.check('la reversión de caja es un asiento compensatorio, no un borrado',
  (select count(*) = 1 from public.cash_movements
    where invoice_id = test.var('nc1')::uuid and type = 'outflow')
  and (select count(*) = 1 from public.cash_movements
    where invoice_id = test.var('inv1')::uuid and type = 'inflow'));

select test.check('la anulación queda registrada en la bitácora',
  (select count(*) > 0 from public.audit_logs
    where action = 'ANULAR_FACTURA' and entity_id = test.var('inv1')));

-- Idempotencia de la anulación.
do $$
declare v_again public.invoices; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.invoices;
  v_again := public.annul_invoice(test.var('inv1')::uuid,
    'Cobro duplicado al cliente', 'req-anul-0001');
  select count(*) into v_after from public.invoices;
  perform test.check('reanular con la misma clave devuelve la nota ya emitida',
    v_again.id = test.var('nc1')::uuid and v_before = v_after,
    format('facturas antes=%s después=%s', v_before, v_after));
end $$;

select test.check('la reanulación no vuelve a devolver inventario',
  (select stock = 40 from public.products where id = test.var('prod')::uuid),
  (select stock::text from public.products where id = test.var('prod')::uuid));

select test.expect_error('no se puede anular dos veces con claves distintas',
  format('select public.annul_invoice(%L::uuid, ''segundo intento'', ''req-anul-0002'')',
         test.var('inv1')));

select test.expect_error('no se puede anular una nota de crédito',
  format('select public.annul_invoice(%L::uuid, ''absurdo'', ''req-anul-0003'')',
         test.var('nc1')));

select test.expect_error('la anulación exige un motivo',
  format('select public.annul_invoice(%L::uuid, ''  '', ''req-anul-0004'')',
         test.var('inv1')));

-- =============================================================== Atomicidad

-- Si una parte falla, no debe quedar rastro de ninguna otra.
do $$
declare v_inv_before integer; v_stock_before integer; v_cash_before bigint; v_ncf_before bigint;
begin
  select count(*) into v_inv_before from public.invoices;
  select stock into v_stock_before from public.products where id = test.var('prod')::uuid;
  select expected_cash_cents into v_cash_before from public.cash_sessions
    where id = test.var('sess')::uuid;
  select next_value into v_ncf_before from public.ncf_sequences
    where company_id = test.var('c_a')::uuid and ncf_type='B02';

  begin
    -- Segunda línea con un producto inexistente: revienta a mitad de la operación.
    perform public.create_invoice(
      p_branch_id=>test.var('b_a')::uuid, p_client_request_id=>'req-atomica',
      p_items=>jsonb_build_array(
        jsonb_build_object('item_type','product','product_id',test.var('prod'),
          'name','Aromatizante','quantity',5,'discount_cents',0,'is_membego_covered',false),
        jsonb_build_object('item_type','product','product_id',gen_random_uuid(),
          'name','Fantasma','quantity',1,'discount_cents',0,'is_membego_covered',false)),
      p_payments=>jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',900000)),
      p_cash_session_id=>test.var('sess')::uuid);
  exception when others then null;
  end;

  perform test.check('un fallo a mitad no deja factura huérfana',
    (select count(*) from public.invoices) = v_inv_before);
  perform test.check('un fallo a mitad no descuenta inventario',
    (select stock from public.products where id = test.var('prod')::uuid) = v_stock_before,
    format('antes=%s ahora=%s', v_stock_before,
      (select stock from public.products where id = test.var('prod')::uuid)));
  perform test.check('un fallo a mitad no altera la caja',
    (select expected_cash_cents from public.cash_sessions where id = test.var('sess')::uuid) = v_cash_before);
  perform test.check('un fallo a mitad no consume NCF',
    (select next_value from public.ncf_sequences
      where company_id = test.var('c_a')::uuid and ncf_type='B02') = v_ncf_before,
    format('antes=%s ahora=%s', v_ncf_before,
      (select next_value from public.ncf_sequences
        where company_id = test.var('c_a')::uuid and ncf_type='B02')));
end $$;

-- =============================================================== Aislamiento

-- La empresa Beta no puede facturar contra los datos de Alfa.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.expect_error('la empresa Beta no puede facturar un servicio de Alfa',
  format($q$select public.create_invoice(%L::uuid,'req-cruzada',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,'name','Robo',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',200000)))$q$,
    test.var('b_a'), test.var('serv')));

select test.expect_error('la empresa Beta no puede anular una factura de Alfa',
  format('select public.annul_invoice(%L::uuid, ''sabotaje'', ''req-anul-beta'')',
         test.var('inv1')));

reset role;

-- =============================================================================
-- Integridad de tenant en claves foráneas (migración 0009)
-- =============================================================================
-- Regresión de la vulnerabilidad de corrupción financiera entre empresas: con
-- el UUID de la caja ajena, RLS aceptaba la escritura porque solo miraba
-- company_id, y el recálculo (SECURITY DEFINER) modificaba la caja de la otra
-- empresa. Reproducido antes de la corrección: 0 -> 100.000.

set role postgres;
do $$
declare v_sess uuid; v_branch uuid;
begin
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
  select test.var('c_b')::uuid, b.id, p.id, 500000
  from public.branches b, public.profiles p
  where b.company_id = test.var('c_b')::uuid and p.email = 'owner.b@example.com'
  limit 1
  returning id, branch_id into v_sess, v_branch;

  perform test.set_var('beta_sess', v_sess::text);
  perform test.set_var('beta_branch', v_branch::text);
  perform test.set_var('beta_cash_before',
    (select expected_cash_cents::text from public.cash_sessions where id = v_sess));
end $$;

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error('no se puede mover efectivo contra la caja de otra empresa',
  format($q$insert into public.cash_movements
    (company_id, cash_session_id, type, method, amount_cents, reason)
    values (%L::uuid, %L::uuid, 'outflow','efectivo',400000,'Vaciado ajeno')$q$,
    test.var('c_a'), test.var('beta_sess')));

-- Se comprueba con un rol capaz de leer la caja ajena: como Alfa, RLS la
-- oculta (correcto) y la aserción no podría distinguir "intacta" de "invisible".
do $$
declare v_now text;
begin
  set local role postgres;
  select expected_cash_cents::text into v_now
    from public.cash_sessions where id = test.var('beta_sess')::uuid;
  perform test.check('la caja de la otra empresa quedó intacta',
    v_now = test.var('beta_cash_before'),
    format('antes=%s ahora=%s', test.var('beta_cash_before'), v_now));
  set local role authenticated;
end $$;

select test.expect_error('no se puede facturar contra una sucursal de otra empresa',
  format($q$insert into public.invoices (company_id, branch_id, customer_name, cashier_id)
    values (%L::uuid, %L::uuid, 'X', %L::uuid)$q$,
    test.var('c_a'), test.var('beta_branch'), test.var('u_cashier_a')));

select test.expect_error('no se puede abrir caja en una sucursal de otra empresa',
  format($q$insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values (%L::uuid, %L::uuid, %L::uuid, 1000)$q$,
    test.var('c_a'), test.var('beta_branch'), test.var('u_cashier_a')));

select test.expect_error('no se puede crear una orden en una sucursal de otra empresa',
  format($q$insert into public.work_orders (company_id, branch_id, customer_name, vehicle_plate)
    values (%L::uuid, %L::uuid, 'X', 'Z000999')$q$,
    test.var('c_a'), test.var('beta_branch')));

-- Una línea no puede referenciar el catálogo de otra empresa.
set role postgres;
select test.set_var('beta_serv', (select id::text from public.services
  where company_id = test.var('c_b')::uuid limit 1));
set role authenticated;

select test.expect_error('una línea no puede referenciar un servicio de otra empresa',
  format($q$insert into public.work_order_items
    (work_order_id, item_type, service_id, name, quantity, unit_price_cents)
    values ((select id from public.work_orders limit 1), 'service', %L::uuid, 'Ajeno', 1, 1000)$q$,
    test.var('beta_serv')));

-- El company_id de las líneas lo pone el servidor desde el documento padre.
select test.check('la línea hereda el tenant del documento, no lo elige el cliente',
  (select count(*) = 0 from public.work_order_items wi
     join public.work_orders o on o.id = wi.work_order_id
    where wi.company_id <> o.company_id));

reset role;
