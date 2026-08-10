-- =============================================================================
-- Pruebas de promociones y descuentos controlados (migración 0032)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls) y el servicio 'serv' con precio sedán de
-- 100.000 centavos (20_billing). Lo que se demuestra: el descuento manual deja
-- de ser libre, y el promocional lo calcula el servidor con sus propias reglas
-- por mucho que la pantalla diga otra cosa.
-- =============================================================================

set role postgres;

-- Caja abierta y datos de partida para poder facturar.
do $$
declare v_sess uuid; v_cli uuid;
begin
  select id into v_sess from public.cash_sessions
  where branch_id = test.var('b_a')::uuid and status = 'open';
  if v_sess is null then
    insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
      values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('u_cashier_a')::uuid, 500000)
      returning id into v_sess;
  end if;
  perform test.set_var('promo_sess', v_sess::text);

  insert into public.customers (company_id, branch_id, name)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Cliente Promo')
    returning id into v_cli;
  perform test.set_var('promo_cli', v_cli::text);
end $$;

select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- ================================================ Quién administra promociones
select test.expect_error('un cajero no crea promociones',
  $q$select public.upsert_promotion('PIRATA', 'Descuento pirata', 'porcentaje',
       'total', null, 5000)$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('un porcentaje sin porcentaje se rechaza',
  $q$select public.upsert_promotion('X1', 'Sin valor', 'porcentaje')$q$);
select test.expect_error('un importe sin importe se rechaza',
  $q$select public.upsert_promotion('X2', 'Sin valor', 'importe')$q$);
select test.expect_error('una promoción de un servicio sin decir cuál se rechaza',
  $q$select public.upsert_promotion('X3', 'Sin servicio', 'porcentaje', 'servicio', null, 1000)$q$);

-- 10 % sobre el total, sin más reglas.
select test.set_var('promo10',
  (public.upsert_promotion('DIEZ', 'Diez por ciento', 'porcentaje', 'total', null, 1000)).id::text);

select test.check('la promoción guarda el código en mayúsculas',
  (select code = 'DIEZ' from public.promotions where id = test.var('promo10')::uuid));

select test.expect_error('el código no se repite en la misma empresa',
  $q$select public.upsert_promotion('diez', 'Duplicada', 'porcentaje', 'total', null, 500)$q$);

-- ==================================================== Previsualización
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.check('un código inexistente se explica, no revienta',
  (public.validate_promotion('NOEXISTE', 100000) ->> 'valid')::boolean = false);

select test.check('la previsualización calcula el 10 % del subtotal',
  (public.validate_promotion('DIEZ', 100000,
     jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
       'category', 'sedan', 'amount_cents', 100000))) ->> 'discount_cents')::bigint = 10000);

-- ============================================== La factura recalcula sola
do $$
declare v_inv public.invoices;
begin
  -- Total sin promoción: 100.000 + 18 % = 118.000.
  -- Con el 10 %: base 90.000 + 18 % = 106.200.
  v_inv := public.create_invoice(
    test.var('b_a')::uuid, 'promo-inv-1',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',106200)),
    'sedan', null, test.var('promo_cli')::uuid, 'Cliente Promo', null, 'PM0001', null,
    test.var('promo_sess')::uuid, 'DIEZ');
  perform test.set_var('promo_inv1', v_inv.id::text);
end $$;

select test.check('la factura aplicó el descuento que calculó el servidor',
  (select discount_cents = 10000 and total_cents = 106200
     from public.invoices where id = test.var('promo_inv1')::uuid),
  (select format('desc=%s total=%s', discount_cents, total_cents)
     from public.invoices where id = test.var('promo_inv1')::uuid));

select test.check('el canje quedó registrado contra la factura',
  (select count(*) = 1 from public.promotion_redemptions
    where invoice_id = test.var('promo_inv1')::uuid
      and promotion_id = test.var('promo10')::uuid and discount_cents = 10000));

select test.check('el contador de usos subió',
  (select uses_count = 1 from public.promotions where id = test.var('promo10')::uuid));

select test.check('la promoción quedó en la bitácora de la factura',
  (select details like '%DIEZ%' from public.audit_logs
    where action = 'EMITIR_FACTURA' and entity_id = test.var('promo_inv1')::uuid));

-- ==================================================== Las reglas se cumplen
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Vencida.
do $$
begin
  perform public.upsert_promotion('VENCIDA', 'Ya pasó', 'porcentaje', 'total', null, 5000,
    null, null, null, current_date - 30, current_date - 1);
end $$;
select test.check('una promoción vencida se rechaza con su motivo',
  (public.validate_promotion('VENCIDA', 100000,
     jsonb_build_array(jsonb_build_object('amount_cents', 100000))) ->> 'reason') like '%venció%');

-- Solo un día de la semana que NO es hoy.
do $$
declare v_otro smallint := ((extract(dow from current_date)::int + 3) % 7)::smallint;
begin
  perform public.upsert_promotion('OTRODIA', 'Otro día', 'porcentaje', 'total', null, 2000,
    null, null, null, null, null, array[v_otro]);
end $$;
select test.check('una promoción de otro día de la semana no aplica hoy',
  (public.validate_promotion('OTRODIA', 100000,
     jsonb_build_array(jsonb_build_object('amount_cents', 100000))) ->> 'reason') like '%no aplica hoy%');

-- Compra mínima.
do $$
begin
  perform public.upsert_promotion('MINIMO', 'Desde 2.000', 'importe', 'total', null, null,
    50000, null, null, null, null, null, 200000);
end $$;
select test.check('por debajo de la compra mínima no aplica',
  (public.validate_promotion('MINIMO', 100000,
     jsonb_build_array(jsonb_build_object('amount_cents', 100000))) ->> 'reason') like '%mínima%');
select test.check('por encima de la compra mínima sí aplica',
  (public.validate_promotion('MINIMO', 300000,
     jsonb_build_array(jsonb_build_object('amount_cents', 300000))) ->> 'discount_cents')::bigint = 50000);

-- Un importe fijo mayor que la base se topa: no se regala la diferencia.
do $$
begin
  perform public.upsert_promotion('GRANDE', 'Importe enorme', 'importe', 'total', null, null, 999999);
end $$;
select test.check('un importe mayor que la venta se topa a la venta',
  (public.validate_promotion('GRANDE', 50000,
     jsonb_build_array(jsonb_build_object('amount_cents', 50000))) ->> 'discount_cents')::bigint = 50000);

-- Alcance por servicio: si la venta no lo lleva, no aplica.
do $$
begin
  perform public.upsert_promotion('SOLOSERV', 'Solo ese servicio', 'porcentaje', 'servicio',
    null, 5000, null, test.var('serv')::uuid);
end $$;
select test.check('la promoción de un servicio no aplica a una venta sin él',
  (public.validate_promotion('SOLOSERV', 100000,
     jsonb_build_array(jsonb_build_object('service_id', gen_random_uuid(),
       'amount_cents', 100000))) ->> 'reason') like '%no aplica a nada%');
select test.check('la promoción de un servicio sí aplica cuando está en la venta',
  (public.validate_promotion('SOLOSERV', 100000,
     jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
       'amount_cents', 100000))) ->> 'discount_cents')::bigint = 50000);

-- ==================================================== Topes de uso
do $$
begin
  perform public.upsert_promotion('UNAVEZ', 'Un solo uso', 'porcentaje', 'total',
    null, 1000, null, null, null, null, null, null, 0, 1);
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

do $$
begin
  perform public.create_invoice(
    test.var('b_a')::uuid, 'promo-inv-2',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',106200)),
    'sedan', null, test.var('promo_cli')::uuid, 'Cliente Promo', null, 'PM0002', null,
    test.var('promo_sess')::uuid, 'UNAVEZ');
end $$;

select test.expect_error('agotado el tope de usos, la promoción deja de aplicar',
  format($q$select public.create_invoice(%L::uuid,'promo-inv-3',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',106200)),
    'sedan', null, %L::uuid, 'Cliente Promo', null, 'PM0003', null, %L::uuid, 'UNAVEZ')$q$,
    test.var('b_a'), test.var('serv'), test.var('promo_cli'), test.var('promo_sess')));

-- Tope por cliente.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;
do $$
begin
  perform public.upsert_promotion('PORCLIENTE', 'Una por cliente', 'porcentaje', 'total',
    null, 1000, null, null, null, null, null, null, 0, null, 1);
end $$;

select test.check('una promoción por cliente exige saber quién es',
  (public.validate_promotion('PORCLIENTE', 100000,
     jsonb_build_array(jsonb_build_object('amount_cents', 100000)), null)
   ->> 'reason') like '%por cliente%');

-- ================================================ Techo del descuento manual
-- Se baja el techo al 10 %.
do $$
begin
  update public.companies set max_manual_discount_bps = 1000
   where id = test.var('c_a')::uuid;
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error('un cajero no puede descontar por encima del techo',
  format($q$select public.create_invoice(%L::uuid,'promo-inv-abuso',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',90000,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',11800)),
    'sedan', null, null, 'Consumidor Final', null, 'PM0004', null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('promo_sess')));

select test.expect_ok('un descuento dentro del techo sí pasa',
  format($q$select public.create_invoice(%L::uuid,'promo-inv-ok',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',10000,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',106200)),
    'sedan', null, null, 'Consumidor Final', null, 'PM0005', null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('promo_sess')));

-- El propietario sí decide: puede pasarse, y queda en la bitácora.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_ok('la propiedad sí puede pasarse del techo',
  format($q$select public.create_invoice(%L::uuid,'promo-inv-dueno',
    jsonb_build_array(jsonb_build_object('item_type','service','service_id',%L,
      'name','Lavado','quantity',1,'discount_cents',90000,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','efectivo','amount_cents',11800)),
    'sedan', null, null, 'Consumidor Final', null, 'PM0006', null, %L::uuid)$q$,
    test.var('b_a'), test.var('serv'), test.var('promo_sess')));

-- Se devuelve el techo para no alterar otras pruebas.
do $$
begin
  update public.companies set max_manual_discount_bps = 10000
   where id = test.var('c_a')::uuid;
end $$;

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve las promociones de Alfa',
  (select count(*) = 0 from public.promotions));
select test.check('Beta no ve los canjes de Alfa',
  (select count(*) = 0 from public.promotion_redemptions));
select test.check('el código de Alfa no existe para Beta',
  (public.validate_promotion('DIEZ', 100000) ->> 'valid')::boolean = false);
select test.expect_error('Beta no edita una promoción de Alfa',
  format($q$select public.upsert_promotion('DIEZ','Robada','porcentaje','total',%L::uuid,9000)$q$,
         test.var('promo10')));

set role postgres;
