-- =============================================================================
-- Pruebas de reclamos e incidentes (migración 0027)
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- ---- El mostrador levanta el reclamo.
select test.expect_error('un reclamo sin descripción suficiente se rechaza',
  $q$select public.open_claim('Cliente Molesto', 'dano_vehiculo', 'corto')$q$);
select test.expect_error('un reclamo sin nombre de cliente se rechaza',
  $q$select public.open_claim('  ', 'otro', 'Descripción suficientemente larga')$q$);

do $$
declare v_c public.claims;
begin
  v_c := public.open_claim(
    'Cliente Molesto', 'dano_vehiculo',
    'Reporta un rayón en la puerta derecha que no estaba antes del lavado',
    test.var('wo_rec')::uuid, null, '809-555-0303');
  perform test.set_var('claim1', v_c.id::text);
end $$;

select test.check('el reclamo queda abierto y ligado a su orden',
  (select status = 'abierto' and work_order_id = test.var('wo_rec')::uuid
     from public.claims where id = test.var('claim1')::uuid));

select test.check('la apertura dejó su primera nota en la bitácora del reclamo',
  (select count(*) = 1 from public.claim_events where claim_id = test.var('claim1')::uuid));

-- ---- Notas y cambio a en revisión.
do $$
begin
  perform public.add_claim_note(test.var('claim1')::uuid,
    'Se revisa la inspección de recepción: el daño ya estaba marcado y firmado',
    'en_revision');
end $$;

select test.check('la nota mueve el reclamo a en revisión',
  (select status = 'en_revision' from public.claims where id = test.var('claim1')::uuid));

select test.check('la bitácora guarda el estado anterior y el nuevo',
  (select count(*) = 1 from public.claim_events
    where claim_id = test.var('claim1')::uuid
      and status_from = 'abierto' and status_to = 'en_revision'));

select test.expect_error('una nota vacía se rechaza',
  format($q$select public.add_claim_note(%L::uuid, '   ')$q$, test.var('claim1')));

select test.expect_error('no se cierra un reclamo con add_claim_note',
  format($q$select public.add_claim_note(%L::uuid, 'listo', 'resuelto')$q$, test.var('claim1')));

-- ---- El cajero NO cierra reclamos.
select test.expect_error('un cajero no puede cerrar reclamos',
  format($q$select public.resolve_claim(%L::uuid, 'rechazado', 'El daño estaba marcado antes')$q$,
         test.var('claim1')));

-- ---- El supervisor/propietario sí, con resolución obligatoria.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('cerrar sin explicar la resolución se rechaza',
  format($q$select public.resolve_claim(%L::uuid, 'resuelto', 'x')$q$, test.var('claim1')));
select test.expect_error('un estado que no cierra se rechaza',
  format($q$select public.resolve_claim(%L::uuid, 'abierto', 'resolución válida aquí')$q$,
         test.var('claim1')));

do $$
begin
  perform public.resolve_claim(
    test.var('claim1')::uuid, 'rechazado',
    'El rayón estaba marcado y firmado en la inspección de recepción',
    0, 'Cliente no revisó la inspección al entregar el vehículo');
end $$;

select test.check('el reclamo queda cerrado con resolución, causa raíz y sello de tiempo',
  (select status = 'rechazado' and resolved_at is not null
          and root_cause = 'Cliente no revisó la inspección al entregar el vehículo'
     from public.claims where id = test.var('claim1')::uuid));

select test.expect_error('un reclamo cerrado no se cierra dos veces',
  format($q$select public.resolve_claim(%L::uuid, 'resuelto', 'otra resolución')$q$,
         test.var('claim1')));

-- ---- Un reclamo con costo asumido por el car wash.
do $$
declare v_c public.claims;
begin
  v_c := public.open_claim(
    'Cliente Con Razón', 'servicio_deficiente',
    'El interior quedó con residuos de químico y hubo que repetir el servicio');
  perform test.set_var('claim2', v_c.id::text);
  perform public.resolve_claim(
    v_c.id, 'resuelto', 'Se repitió el lavado sin costo y se entregó un lavado de cortesía',
    85000, 'Falta de enjuague en el aspirado', test.var('u_cashier_a')::uuid);
end $$;

select test.check('el costo asumido y el responsable quedan registrados',
  (select cost_cents = 85000 and responsible_id = test.var('u_cashier_a')::uuid
     from public.claims where id = test.var('claim2')::uuid));

select test.check('el cierre quedó en la bitácora de auditoría',
  (select count(*) >= 1 from public.audit_logs
    where action = 'CERRAR_RECLAMO' and entity_id = test.var('claim2')::uuid));

-- ---- La bitácora del reclamo es de solo inserción.
select test.expect_error('la bitácora del reclamo rechaza UPDATE',
  format($q$update public.claim_events set note = 'editado' where claim_id = %L$q$,
         test.var('claim1')));
select test.expect_error('la bitácora del reclamo rechaza DELETE',
  format($q$delete from public.claim_events where claim_id = %L$q$, test.var('claim1')));

-- ---- Aislamiento entre empresas.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve los reclamos ajenos',
  (select count(*) = 0 from public.claims where id = test.var('claim1')::uuid));
select test.check('otro car wash no ve la bitácora de un reclamo ajeno',
  (select count(*) = 0 from public.claim_events where claim_id = test.var('claim1')::uuid));
select test.expect_error('otro car wash no puede anotar en un reclamo ajeno',
  format($q$select public.add_claim_note(%L::uuid, 'intento de otra empresa')$q$, test.var('claim1')));
select test.expect_error('no se abre un reclamo sobre una orden de otra empresa',
  format($q$select public.open_claim('Intruso', 'otro', 'Intento de reclamo cruzado', %L::uuid)$q$,
         test.var('wo_rec')));

reset role;
