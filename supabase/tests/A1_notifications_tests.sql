-- =============================================================================
-- Pruebas de notificaciones y avisos (migración 0033)
-- =============================================================================
-- Continúa sobre Alfa/Beta. Lo que se demuestra: el aviso se genera solo cuando
-- el vehículo queda listo, los avisos internos no se duplican por mucho que se
-- refresquen, y un aviso resuelto no se resuelve dos veces.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- ==================================== El vehículo listo avisa a su dueño
do $$
declare
  v_wo public.work_orders;
  v_bay uuid;
begin
  select id into v_bay from public.bays
  where company_id = test.var('c_a')::uuid and status = 'disponible' limit 1;
  if v_bay is null then
    insert into public.bays (company_id, branch_id, name, type)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Bahía Avisos', 'lavado')
    returning id into v_bay;
  end if;

  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'aviso-wo-1',
    p_vehicle_plate => 'AV0001',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    p_customer_name => 'Doña Avisos',
    p_customer_phone => '809-555-0600');

  perform public.advance_work_order(v_wo.id, 'en_proceso', v_bay);
  perform public.advance_work_order(v_wo.id, 'listo');
  perform test.set_var('aviso_wo', v_wo.id::text);
end $$;

select test.check('al quedar lista la orden se encoló el aviso al cliente',
  (select count(*) = 1 from public.notifications
    where work_order_id = test.var('aviso_wo')::uuid
      and kind = 'orden_lista' and audience = 'cliente' and status = 'pendiente'));

select test.check('el aviso sale por WhatsApp porque hay teléfono, y lleva el texto listo',
  (select channel = 'whatsapp' and recipient_phone = '809-555-0600'
      and body like '%Doña Avisos%' and body like '%AV0001%'
     from public.notifications where work_order_id = test.var('aviso_wo')::uuid));

-- Volver a pasar por «listo» no encola otro: la llave de deduplicación manda.
do $$
begin
  perform public.advance_work_order(test.var('aviso_wo')::uuid, 'entregado');
end $$;

select test.check('el aviso no se duplica aunque la orden siga avanzando',
  (select count(*) = 1 from public.notifications
    where work_order_id = test.var('aviso_wo')::uuid));

-- Sin teléfono, el aviso queda interno: alguien tiene que llamar.
do $$
declare v_wo public.work_orders; v_bay uuid;
begin
  select id into v_bay from public.bays
  where company_id = test.var('c_a')::uuid and status = 'disponible' limit 1;

  v_wo := public.create_work_order(
    p_branch_id => test.var('b_a')::uuid,
    p_client_request_id => 'aviso-wo-2',
    p_vehicle_plate => 'AV0002',
    p_vehicle_category => 'sedan',
    p_items => jsonb_build_array(jsonb_build_object('service_id', test.var('serv'),
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)));

  perform public.advance_work_order(v_wo.id, 'en_proceso', v_bay);
  perform public.advance_work_order(v_wo.id, 'listo');
  perform test.set_var('aviso_wo2', v_wo.id::text);
end $$;

select test.check('sin teléfono el aviso queda interno, para que alguien llame',
  (select channel = 'app' and recipient_phone is null
     from public.notifications where work_order_id = test.var('aviso_wo2')::uuid));

-- ==================================================== Avisos del negocio
select test.expect_error('un cajero no refresca los avisos del negocio',
  $q$select public.refresh_alerts()$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Un producto bajo mínimo y un equipo con mantenimiento vencido, a propósito.
-- Se sube el MÍNIMO en vez de bajar la existencia: el stock está protegido por
-- el guardia del kardex (0019) y tocarlo aquí exigiría declarar contexto.
set role postgres;
update public.products set min_stock = greatest(stock + 1, 5)
 where id = test.var('prod')::uuid;
insert into public.equipment (company_id, branch_id, code, name, status, next_service_at)
values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'EQ-AV', 'Hidrolavadora Avisos',
        'operativo', current_date - 10);
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.set_var('barrido', public.refresh_alerts()::text);

select test.check('el barrido encoló el aviso de stock bajo',
  (test.var('barrido')::jsonb ->> 'stock_bajo')::integer >= 1,
  test.var('barrido'));

select test.check('el aviso de stock dice cuánto queda y cuál es el mínimo',
  (select count(*) = 1 from public.notifications
    where kind = 'stock_bajo' and audience = 'interno' and body like '%Toca reponer%'));

select test.check('el barrido encoló el mantenimiento vencido',
  (select count(*) = 1 from public.notifications
    where kind = 'mantenimiento_pendiente' and title like '%Hidrolavadora Avisos%'));

-- Lo que hace usable la bandeja: refrescar otra vez no la llena de copias.
select test.set_var('barrido2', public.refresh_alerts()::text);

select test.check('refrescar de nuevo no duplica ningún aviso',
  (test.var('barrido2')::jsonb ->> 'total')::integer = 0,
  test.var('barrido2'));

select test.check('sigue habiendo un solo aviso de stock por producto y día',
  (select count(*) = 1 from public.notifications where kind = 'stock_bajo'));

-- ==================================================== Marcar y descartar
select test.set_var('aviso1',
  (select id::text from public.notifications
    where work_order_id = test.var('aviso_wo')::uuid));

select test.expect_error('un aviso no vuelve a pendiente',
  format($q$select public.mark_notification(%L::uuid, 'pendiente')$q$, test.var('aviso1')));

select test.check('marcar enviado sella la hora y el autor',
  (select sent_at is not null and sent_by = test.var('u_owner_a')::uuid and status = 'enviado'
     from public.mark_notification(test.var('aviso1')::uuid, 'enviado')));

select test.expect_error('un aviso ya resuelto no se resuelve dos veces',
  format($q$select public.mark_notification(%L::uuid, 'descartado')$q$, test.var('aviso1')));

select test.check('descartar un aviso interno lo saca de lo pendiente',
  (select status = 'descartado' from public.mark_notification(
    (select id from public.notifications where kind = 'stock_bajo' limit 1), 'descartado')));

-- Un aviso descartado tampoco reaparece: la llave sigue ocupada.
select test.set_var('barrido3', public.refresh_alerts()::text);
select test.check('un aviso descartado no reaparece en el siguiente barrido',
  (select count(*) = 1 from public.notifications where kind = 'stock_bajo'));

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve los avisos de Alfa',
  (select count(*) = 0 from public.notifications));
select test.expect_error('Beta no marca un aviso de Alfa',
  format($q$select public.mark_notification(%L::uuid, 'descartado')$q$, test.var('aviso_wo2')));

set role postgres;
