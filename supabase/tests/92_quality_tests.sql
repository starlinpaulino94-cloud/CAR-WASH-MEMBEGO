-- =============================================================================
-- Pruebas del control de calidad (migración 0024)
-- =============================================================================
-- Levanta su propia orden sobre Alfa y la lleva hasta control de calidad.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ---- Checklist configurable.
with i as (
  insert into public.qc_checklist_items (company_id, label, sort_order)
  values (test.var('c_a')::uuid, 'Cristales sin marcas', 1),
         (test.var('c_a')::uuid, 'Aros limpios', 2),
         (test.var('c_a')::uuid, 'Interior aspirado', 3)
  returning id
)
select test.set_var('qc_items', (select count(*)::text from i));

select test.check('el checklist de calidad queda configurado',
  (select count(*) = 3 from public.qc_checklist_items where company_id = test.var('c_a')::uuid));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no configura el checklist de calidad',
  format($q$insert into public.qc_checklist_items (company_id, label)
     values (%L::uuid, 'Punto pirata')$q$, test.var('c_a')));

-- ---- Orden llevada hasta control de calidad.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_o public.work_orders;
begin
  v_o := public.create_work_order(
    p_branch_id         => test.var('b_a')::uuid,
    p_client_request_id => 'wo-qc-1',
    p_vehicle_plate     => 'QC0001',
    p_vehicle_category  => 'suv',
    p_items             => jsonb_build_array(jsonb_build_object(
                             'service_id', test.var('serv'), 'name', 'Lavado',
                             'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false)),
    p_customer_name     => 'Cliente QC');
  perform test.set_var('wo_qc', v_o.id::text);
  perform public.advance_work_order(v_o.id, 'en_espera');
  perform public.advance_work_order(v_o.id, 'en_proceso', test.var('bay_rec')::uuid);
  perform public.advance_work_order(v_o.id, 'control_calidad');
end $$;

-- ---- Rechazo: exige motivo y devuelve la orden a proceso (reproceso).
select test.expect_error('un rechazo sin motivo se rechaza',
  format($q$select public.submit_qc_review(%L::uuid, 'rechazado', '[]'::jsonb, 'no')$q$,
         test.var('wo_qc')));

do $$
begin
  perform public.submit_qc_review(
    test.var('wo_qc')::uuid, 'rechazado',
    jsonb_build_array(
      jsonb_build_object('label', 'Cristales sin marcas', 'passed', false, 'note', 'Marcas en el parabrisas'),
      jsonb_build_object('label', 'Aros limpios', 'passed', true)),
    'Quedaron marcas visibles en los cristales',
    test.var('u_cashier_a')::uuid);
end $$;

select test.check('el rechazo queda con su motivo y número de intento',
  (select attempt = 1 and result = 'rechazado'
          and reject_reason = 'Quedaron marcas visibles en los cristales'
     from public.qc_reviews where work_order_id = test.var('wo_qc')::uuid and attempt = 1));

select test.check('el rechazo devuelve la orden a proceso (reproceso)',
  (select status = 'en_proceso' from public.work_orders where id = test.var('wo_qc')::uuid));

select test.check('quedó el resultado punto por punto de la revisión',
  (select count(*) = 2 from public.qc_review_results r
     join public.qc_reviews q on q.id = r.review_id
    where q.work_order_id = test.var('wo_qc')::uuid));

select test.check('el reviewer queda sellado por el servidor, no por el cliente',
  (select reviewer_id = test.var('u_owner_a')::uuid
     from public.qc_reviews where work_order_id = test.var('wo_qc')::uuid and attempt = 1));

-- ---- Segundo intento aprobado: la orden avanza a listo.
do $$
begin
  perform public.advance_work_order(test.var('wo_qc')::uuid, 'control_calidad');
  perform public.submit_qc_review(
    test.var('wo_qc')::uuid, 'aprobado',
    jsonb_build_array(jsonb_build_object('label', 'Cristales sin marcas', 'passed', true)),
    null, test.var('u_cashier_a')::uuid);
end $$;

select test.check('el segundo intento se numera solo',
  (select count(*) = 2 from public.qc_reviews where work_order_id = test.var('wo_qc')::uuid));

select test.check('aprobar deja la orden lista para entregar',
  (select status = 'listo' from public.work_orders where id = test.var('wo_qc')::uuid));

select test.check('el control de calidad quedó en la bitácora',
  (select count(*) = 2 from public.audit_logs
    where action = 'CONTROL_CALIDAD' and entity_id = test.var('wo_qc')::uuid));

-- ---- Índice de retrabajos: 1 de 2 revisiones del lavador fue rechazo.
select test.check('el índice de retrabajos cuenta los rechazos por lavador',
  (select (e ->> 'rejected')::int = 1 and (e ->> 'reviews')::int = 2
     from jsonb_array_elements(public.qc_rework_index(current_date, current_date)) e
    where (e ->> 'profile_id') = test.var('u_cashier_a')));

-- ---- No se revisa una orden que no está en calidad.
select test.expect_error('no se revisa una orden que ya está lista',
  format($q$select public.submit_qc_review(%L::uuid, 'aprobado')$q$, test.var('wo_qc')));

-- ---- Aislamiento entre empresas.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve las revisiones ajenas',
  (select count(*) = 0 from public.qc_reviews where work_order_id = test.var('wo_qc')::uuid));
select test.check('otro car wash no ve el checklist ajeno',
  (select count(*) = 0 from public.qc_checklist_items where company_id = test.var('c_a')::uuid));
select test.expect_error('otro car wash no puede revisar una orden ajena',
  format($q$select public.submit_qc_review(%L::uuid, 'aprobado')$q$, test.var('wo_qc')));

reset role;
