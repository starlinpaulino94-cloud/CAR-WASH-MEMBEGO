-- =============================================================================
-- Pruebas de equipos y mantenimiento (migración 0025)
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

with e as (
  insert into public.equipment
    (company_id, branch_id, code, name, category, brand, serial_number,
     purchase_date, purchase_cents, warranty_until, service_every_days, next_service_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'HID-01', 'Hidrolavadora 3000 PSI',
          'Lavado', 'Karcher', 'SN-9911', current_date - 200, 4500000,
          current_date + 165, 90, current_date + 10)
  returning id
)
select test.set_var('equip', (select id::text from e));

select test.check('el equipo queda con su serie, garantía y próxima revisión',
  (select serial_number = 'SN-9911' and next_service_at = current_date + 10
          and status = 'operativo'
     from public.equipment where id = test.var('equip')::uuid));

-- ---- Solo los roles de administración registran equipos.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no registra equipos',
  format($q$insert into public.equipment (company_id, code, name)
     values (%L::uuid, 'X-1', 'Equipo pirata')$q$, test.var('c_a')));
select test.expect_error('un cajero no abre intervenciones',
  format($q$select public.open_maintenance(%L::uuid, 'correctivo', 'intento no autorizado')$q$,
         test.var('equip')));

-- ---- Abrir intervención: deja el equipo en mantenimiento.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('una intervención sin descripción se rechaza',
  format($q$select public.open_maintenance(%L::uuid, 'correctivo', 'x')$q$, test.var('equip')));

do $$
declare v_m public.maintenance_orders;
begin
  v_m := public.open_maintenance(
    test.var('equip')::uuid, 'correctivo', 'Pierde presión: revisar empaques');
  perform test.set_var('mant', v_m.id::text);
end $$;

select test.check('abrir la intervención deja el equipo en mantenimiento',
  (select status = 'mantenimiento' from public.equipment where id = test.var('equip')::uuid));

select test.expect_error('no se abren dos intervenciones sobre el mismo equipo',
  format($q$select public.open_maintenance(%L::uuid, 'preventivo', 'otra intervención')$q$,
         test.var('equip')));

-- ---- Cerrar: acumula costo, devuelve a operativo y reprograma la revisión.
do $$
begin
  perform public.complete_maintenance(
    test.var('mant')::uuid, 185000, 'Empaques sustituidos y probada', 'Kit de empaques');
end $$;

select test.check('cerrar devuelve el equipo a operativo',
  (select status = 'operativo' from public.equipment where id = test.var('equip')::uuid));

select test.check('el costo se acumula en el equipo',
  (select maintenance_cents = 185000 from public.equipment where id = test.var('equip')::uuid));

select test.check('la próxima revisión se reprograma con la periodicidad',
  (select next_service_at = current_date + 90 and last_service_at = current_date
     from public.equipment where id = test.var('equip')::uuid));

select test.check('la intervención queda cerrada con su salida y resolución',
  (select status = 'completada' and finished_at is not null
          and resolution = 'Empaques sustituidos y probada'
     from public.maintenance_orders where id = test.var('mant')::uuid));

select test.check('el mantenimiento quedó en la bitácora (apertura y cierre)',
  (select count(*) = 2 from public.audit_logs
    where entity_id = test.var('equip')::uuid
      and action in ('ABRIR_MANTENIMIENTO', 'CERRAR_MANTENIMIENTO')));

select test.expect_error('una intervención cerrada no se cierra dos veces',
  format($q$select public.complete_maintenance(%L::uuid, 100)$q$, test.var('mant')));

-- ---- Aislamiento entre empresas.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve los equipos ajenos',
  (select count(*) = 0 from public.equipment where id = test.var('equip')::uuid));
select test.expect_error('otro car wash no puede intervenir un equipo ajeno',
  format($q$select public.open_maintenance(%L::uuid, 'correctivo', 'intento de otra empresa')$q$,
         test.var('equip')));

reset role;
