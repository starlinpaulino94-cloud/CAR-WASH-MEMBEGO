-- =============================================================================
-- Pruebas de la agenda de citas (migración 0026)
-- =============================================================================
-- La capacidad sale de las bahías de la sucursal de Alfa.
-- =============================================================================

set role postgres;
-- Estado conocido de bahías: se dejan exactamente 2 disponibles para medir la
-- capacidad sin depender de lo que hicieron las pruebas anteriores.
update public.bays set status = 'mantenimiento'
where company_id = test.var('c_a')::uuid;
update public.bays set status = 'disponible'
where id in (select id from public.bays
             where company_id = test.var('c_a')::uuid and branch_id = test.var('b_a')::uuid
             order by name limit 2);

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('la disponibilidad refleja la capacidad de bahías',
  (public.appointment_availability(test.var('b_a')::uuid, now() + interval '2 days', 60)
    ->> 'capacity')::int = 2);

-- ---- Reservar: toma la duración del servicio si no se indica.
do $$
declare v_a public.appointments;
begin
  v_a := public.book_appointment(
    p_branch_id     => test.var('b_a')::uuid,
    p_customer_name => 'Cliente Agenda',
    p_scheduled_at  => date_trunc('hour', now()) + interval '2 days',
    p_service_id    => test.var('serv')::uuid,
    p_vehicle_plate => 'ag-0001',
    p_vehicle_category => 'suv',
    p_customer_phone => '809-555-0777');
  perform test.set_var('cita1', v_a.id::text);
end $$;

select test.check('la cita normaliza la placa igual que las órdenes',
  (select vehicle_plate = 'AG0001' and status = 'pendiente'
     from public.appointments where id = test.var('cita1')::uuid));

select test.check('la duración sale del servicio cuando no se indica',
  (select a.duration_minutes = s.estimated_minutes
     from public.appointments a join public.services s on s.id = a.service_id
    where a.id = test.var('cita1')::uuid));

select test.check('la franja ya muestra una plaza ocupada',
  (public.appointment_availability(test.var('b_a')::uuid,
     (select scheduled_at from public.appointments where id = test.var('cita1')::uuid), 60)
    ->> 'taken')::int = 1);

-- ---- Segunda cita en la misma franja: cabe (capacidad 2).
do $$
begin
  perform public.book_appointment(
    p_branch_id     => test.var('b_a')::uuid,
    p_customer_name => 'Segundo Cliente',
    p_scheduled_at  => (select scheduled_at from public.appointments where id = test.var('cita1')::uuid),
    p_service_id    => test.var('serv')::uuid,
    p_vehicle_plate => 'AG-0002');
end $$;

select test.check('una segunda cita cabe mientras haya bahías',
  (select count(*) = 2 from public.appointments
    where branch_id = test.var('b_a')::uuid and status = 'pendiente'));

-- ---- Tercera: se rechaza por capacidad.
select test.expect_error('la tercera cita en la misma franja se rechaza por capacidad',
  format($q$select public.book_appointment(%L::uuid, 'Tercero',
    (select scheduled_at from public.appointments where id = %L),
    %L::uuid, 'AG-0003')$q$,
    test.var('b_a'), test.var('cita1'), test.var('serv')));

-- ---- Validaciones.
select test.expect_error('no se agenda en el pasado',
  format($q$select public.book_appointment(%L::uuid, 'Tarde', now() - interval '2 days')$q$,
         test.var('b_a')));
select test.expect_error('no se agenda sin nombre de cliente',
  format($q$select public.book_appointment(%L::uuid, '  ', now() + interval '3 days')$q$,
         test.var('b_a')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_orphan'), false);
set role authenticated;
select test.expect_error('un usuario sin empresa no agenda',
  format($q$select public.book_appointment(%L::uuid, 'Intruso', now() + interval '3 days')$q$,
         test.var('b_a')));

-- ---- Convertir la cita en orden de servicio.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_o public.work_orders;
begin
  v_o := public.convert_appointment(test.var('cita1')::uuid, 'cita-a-orden-1');
  perform test.set_var('wo_cita', v_o.id::text);
end $$;

select test.check('convertir crea la orden con los datos de la cita',
  (select vehicle_plate = 'AG0001' and customer_name = 'Cliente Agenda'
     from public.work_orders where id = test.var('wo_cita')::uuid));

select test.check('la orden nace con el servicio reservado',
  (select count(*) = 1 from public.work_order_items
    where work_order_id = test.var('wo_cita')::uuid and item_type = 'service'));

select test.check('la cita queda marcada como convertida y apunta a su orden',
  (select status = 'convertida' and work_order_id = test.var('wo_cita')::uuid
     from public.appointments where id = test.var('cita1')::uuid));

select test.check('convertir liberó la plaza de esa franja',
  (public.appointment_availability(test.var('b_a')::uuid,
     (select scheduled_at from public.appointments where id = test.var('cita1')::uuid), 60)
    ->> 'taken')::int = 1);

select test.expect_error('una cita convertida no se convierte otra vez',
  format($q$select public.convert_appointment(%L::uuid, 'cita-a-orden-2')$q$, test.var('cita1')));

select test.check('la agenda quedó en la bitácora',
  (select count(*) >= 1 from public.audit_logs
    where action = 'CONVERTIR_CITA' and entity_id = test.var('cita1')::uuid));

-- ---- Cancelar exige motivo.
select test.expect_error('cancelar una cita sin motivo se rechaza',
  format($q$update public.appointments set status = 'cancelada' where id = %L$q$,
         (select id::text from public.appointments
           where branch_id = test.var('b_a')::uuid and status = 'pendiente' limit 1)));

-- ---- Aislamiento entre empresas.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve las citas ajenas',
  (select count(*) = 0 from public.appointments where id = test.var('cita1')::uuid));
select test.expect_error('otro car wash no agenda en una sucursal ajena',
  format($q$select public.book_appointment(%L::uuid, 'Intruso', now() + interval '3 days')$q$,
         test.var('b_a')));

reset role;
