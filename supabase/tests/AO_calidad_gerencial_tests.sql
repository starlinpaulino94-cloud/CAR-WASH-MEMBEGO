-- =============================================================================
-- Calidad gerencial (migración 20260911220000).
-- Universo propio en 2099: dos órdenes revisadas, una aprobada a la primera y
-- otra rechazada y luego aprobada (un reproceso). Reutiliza op1 y serv.
-- =============================================================================

set role postgres;
do $$
declare v_ok uuid; v_rep uuid;
begin
  -- Orden aprobada a la primera.
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'QC-1', 'C1', 'QCC001', 'entregado', '2099-08-01 09:00:00-04')
  returning id into v_ok;
  insert into public.work_order_items (work_order_id, item_type, service_id, name, quantity, unit_price_cents)
  values (v_ok, 'service', test.var('serv')::uuid, 'Lavado', 1, 50000);
  insert into public.qc_reviews (company_id, branch_id, work_order_id, attempt, result, washer_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, v_ok, 1, 'aprobado', test.var('op1')::uuid, '2099-08-01 09:30:00-04');

  -- Orden con reproceso: rechazada (intento 1) y aprobada (intento 2).
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'QC-2', 'C2', 'QCC002', 'entregado', '2099-08-01 10:00:00-04')
  returning id into v_rep;
  insert into public.work_order_items (work_order_id, item_type, service_id, name, quantity, unit_price_cents)
  values (v_rep, 'service', test.var('serv')::uuid, 'Lavado', 1, 50000);
  insert into public.qc_reviews (company_id, branch_id, work_order_id, attempt, result, reject_reason, washer_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, v_rep, 1, 'rechazado', 'quedaron marcas en el cristal', test.var('op1')::uuid, '2099-08-01 10:30:00-04');
  insert into public.qc_reviews (company_id, branch_id, work_order_id, attempt, result, washer_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, v_rep, 2, 'aprobado', test.var('op1')::uuid, '2099-08-01 10:45:00-04');
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ── Resumen ──
select test.check('dos vehículos revisados en el día',
  (public.qc_summary('2099-08-01','2099-08-01') ->> 'vehiculos_revisados')::int = 2);
select test.check('tres revisiones en total (1 + 2)',
  (public.qc_summary('2099-08-01','2099-08-01') ->> 'revisiones')::int = 3);
select test.check('aprobación a la primera = 1 de 2 = 50%',
  (public.qc_summary('2099-08-01','2099-08-01') ->> 'tasa_aprobacion_primera')::int = 50);
select test.check('un rechazo registrado',
  (public.qc_summary('2099-08-01','2099-08-01') ->> 'rechazados')::int = 1);
select test.check('la causa del rechazo aparece en el top',
  exists (select 1 from jsonb_array_elements(
    public.qc_summary('2099-08-01','2099-08-01') -> 'causas') c
    where (c ->> 'motivo') = 'quedaron marcas en el cristal'));
select test.check('op1 aparece entre los lavadores con reprocesos',
  exists (select 1 from jsonb_array_elements(
    public.qc_summary('2099-08-01','2099-08-01') -> 'lavadores_top') l
    where (l ->> 'reprocesos')::int >= 1));

-- ── Historial ──
select test.check('el historial trae las tres revisiones',
  (public.qc_history_page('2099-08-01','2099-08-01') ->> 'total')::int = 3);
select test.check('filtrar por resultado rechazado deja solo el reproceso',
  (public.qc_history_page('2099-08-01','2099-08-01', null, 'rechazado') ->> 'total')::int = 1);
select test.check('el historial trae el número de orden y el motivo',
  (select (r ->> 'reject_reason') from jsonb_array_elements(
     public.qc_history_page('2099-08-01','2099-08-01', null, 'rechazado') -> 'rows') r
   limit 1) = 'quedaron marcas en el cristal');

-- ── Permiso ──
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no ve el resumen de calidad',
  $q$select public.qc_summary('2099-08-01','2099-08-01')$q$);
select test.expect_error('ni el historial de calidad',
  $q$select public.qc_history_page('2099-08-01','2099-08-01')$q$);

reset role;
