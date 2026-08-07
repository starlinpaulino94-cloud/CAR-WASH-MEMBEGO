-- =============================================================================
-- Pruebas de la inspección de recepción/entrega (migración 0023)
-- =============================================================================
-- Usa la orden y la bahía creadas por 80_recipes (wo_rec) sobre la empresa Alfa.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ---- Recepción: se levanta la inspección con combustible y objetos de valor.
with i as (
  insert into public.vehicle_inspections
    (company_id, branch_id, work_order_id, stage, fuel_level, mileage, valuables, notes)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('wo_rec')::uuid,
          'recepcion', '1/2', 84000, 'Cargador y gafas en la guantera',
          'Cliente pide no tocar el retrovisor izquierdo')
  returning id
)
select test.set_var('insp', (select id::text from i));

select test.check('la inspección de recepción queda registrada con su combustible',
  (select fuel_level = '1/2' and mileage = 84000
     from public.vehicle_inspections where id = test.var('insp')::uuid));

-- ---- Daños marcados en el diagrama.
insert into public.inspection_damages
  (company_id, inspection_id, zone, kind, severity, note, pos_x, pos_y)
values
  (test.var('c_a')::uuid, test.var('insp')::uuid, 'Puerta delantera izquierda',
   'rayon', 'leve', 'Rayón superficial de 10 cm', 22.5, 48.0),
  (test.var('c_a')::uuid, test.var('insp')::uuid, 'Bumper trasero',
   'abolladura', 'moderado', null, 78.0, 62.5);

select test.check('los daños quedan con zona, tipo, gravedad y posición',
  (select count(*) = 2 from public.inspection_damages
    where inspection_id = test.var('insp')::uuid and pos_x is not null));

-- ---- Una posición fuera del diagrama se rechaza.
select test.expect_error('una posición fuera del diagrama (0-100) se rechaza',
  format($q$insert into public.inspection_damages (company_id, inspection_id, zone, pos_x, pos_y)
     values (%L::uuid, %L::uuid, 'Techo', 150, 20)$q$,
     test.var('c_a'), test.var('insp')));

-- ---- Firmar: exige firma y nombre; después congela la evidencia.
select test.expect_error('no se firma sin nombre de quien firma',
  format($q$select public.sign_inspection(%L::uuid, repeat('x', 40), '  ')$q$, test.var('insp')));
select test.expect_error('no se firma sin trazo de firma',
  format($q$select public.sign_inspection(%L::uuid, 'x', 'Juan Pérez')$q$, test.var('insp')));

-- Ojo: la firma se hace en un DO. Un `(funcion()).*` en el SELECT re-evaluaría
-- la función una vez por columna, y la segunda llamada chocaría con la primera.
do $$
begin
  perform public.sign_inspection(
    test.var('insp')::uuid,
    'data:image/png;base64,' || repeat('A', 40),
    'Juan Pérez');
end $$;

select test.check('al firmar quedan sello de tiempo, firmante y términos aceptados',
  (select signed_at is not null and signed_by = 'Juan Pérez' and terms_accepted
     from public.vehicle_inspections where id = test.var('insp')::uuid));

select test.check('la firma quedó en la bitácora',
  (select count(*) >= 1 from public.audit_logs
    where action = 'FIRMAR_INSPECCION' and entity_id = test.var('insp')::uuid));

-- ---- Inmutabilidad: la evidencia firmada no se reescribe.
select test.expect_error('una inspección firmada ya no se modifica',
  format($q$update public.vehicle_inspections set notes = 'editado' where id = %L$q$, test.var('insp')));
select test.expect_error('tampoco se agregan daños a una inspección firmada',
  format($q$insert into public.inspection_damages (company_id, inspection_id, zone)
     values (%L::uuid, %L::uuid, 'Capó')$q$, test.var('c_a'), test.var('insp')));
select test.expect_error('ni se borran los daños ya firmados',
  format($q$delete from public.inspection_damages where inspection_id = %L$q$, test.var('insp')));
select test.expect_error('no se firma dos veces',
  format($q$select public.sign_inspection(%L::uuid, repeat('y', 40), 'Otro')$q$, test.var('insp')));

-- ---- La de ENTREGA sí se puede levantar aparte (para comparar).
with i as (
  insert into public.vehicle_inspections
    (company_id, branch_id, work_order_id, stage, fuel_level, notes)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('wo_rec')::uuid,
          'entrega', '1/2', 'Se entrega sin novedades')
  returning id
)
select test.set_var('insp_out', (select id::text from i));

select test.check('la inspección de entrega convive con la de recepción',
  (select count(*) = 2 from public.vehicle_inspections
    where work_order_id = test.var('wo_rec')::uuid));

select test.expect_error('no se duplica la inspección de un mismo momento',
  format($q$insert into public.vehicle_inspections (company_id, work_order_id, stage)
     values (%L::uuid, %L::uuid, 'entrega')$q$, test.var('c_a'), test.var('wo_rec')));

-- ---- Aislamiento entre empresas.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve las inspecciones ajenas',
  (select count(*) = 0 from public.vehicle_inspections
    where work_order_id = test.var('wo_rec')::uuid));
select test.check('otro car wash no ve los daños ajenos',
  (select count(*) = 0 from public.inspection_damages
    where inspection_id = test.var('insp')::uuid));
select test.expect_error('otro car wash no puede firmar una inspección ajena',
  format($q$select public.sign_inspection(%L::uuid, repeat('z', 40), 'Intruso')$q$, test.var('insp_out')));

reset role;
