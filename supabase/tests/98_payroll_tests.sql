-- =============================================================================
-- Pruebas de turnos, asistencia y nómina (migración 0030)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls) y los operarios 'op1'/'op2' de 30_orders,
-- que ya tienen comisiones generadas al entregar. Lo que se demuestra: nadie se
-- fija su propio sueldo, las horas salen del marcaje real, y una comisión o un
-- adelanto solo se pagan una vez.
-- =============================================================================

set role postgres;

-- Un empleado más, por hora, para comprobar el cálculo por tiempo trabajado.
do $$
declare
  v_c   uuid := test.var('c_a')::uuid;
  v_b   uuid := test.var('b_a')::uuid;
  v_op3 uuid;
begin
  insert into auth.users (email) values ('op3@example.com') returning id into v_op3;
  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles set company_id = v_c, branch_id = v_b, role = 'operario',
         full_name = 'Operario Tres' where id = v_op3;
  perform set_config('app.branch_ctx', '', true);
  perform test.set_var('op3', v_op3::text);
end $$;

-- ================================================== Nadie se fija su sueldo
select set_config('request.jwt.claim.sub', test.var('op1'), false);
set role authenticated;

select test.expect_error('un operario no se sube su propia comisión',
  format($q$update public.profiles set commission_bps = 10000 where id = %L$q$, test.var('op1')));
select test.expect_error('un operario no se pone sueldo con un UPDATE directo',
  format($q$update public.profiles set base_salary_cents = 99999999 where id = %L$q$, test.var('op1')));

select test.check('la comisión del operario sigue intacta tras el intento',
  (select commission_bps = 1000 from public.profiles where id = test.var('op1')::uuid),
  (select commission_bps::text from public.profiles where id = test.var('op1')::uuid));

select test.expect_ok('el operario sí sigue editando sus datos de contacto',
  format($q$update public.profiles set phone = '809-555-0111' where id = %L$q$, test.var('op1')));

select test.expect_error('un operario tampoco fija sueldos por el RPC',
  format($q$select public.set_employee_pay(%L::uuid, 'mensual', 1500000)$q$, test.var('op1')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('un sueldo mensual sin importe se rechaza',
  format($q$select public.set_employee_pay(%L::uuid, 'mensual', 0)$q$, test.var('op1')));
select test.expect_error('un pago por hora sin tarifa se rechaza',
  format($q$select public.set_employee_pay(%L::uuid, 'por_hora', 0, 0)$q$, test.var('op3')));
select test.expect_error('una comisión fuera de rango se rechaza',
  format($q$select public.set_employee_pay(%L::uuid, 'solo_comision', 0, 0, 20000)$q$, test.var('op2')));

-- Op1: sueldo mensual de 15.000,00. Op3: 250,00 la hora.
do $$
begin
  perform public.set_employee_pay(test.var('op1')::uuid, 'mensual', 1500000);
  perform public.set_employee_pay(test.var('op3')::uuid, 'por_hora', 0, 25000);
end $$;

select test.check('el sueldo mensual quedó fijado por la vía correcta',
  (select payroll_type = 'mensual' and base_salary_cents = 1500000
     from public.profiles where id = test.var('op1')::uuid));

select test.check('cambiar de modalidad no deja residuos de la anterior',
  (select hourly_rate_cents = 0 from public.profiles where id = test.var('op1')::uuid));

select test.check('el sueldo quedó en la bitácora',
  (select count(*) >= 1 from public.audit_logs
    where action = 'FIJAR_SUELDO' and entity_id = test.var('op1')::uuid));

-- ==================================================================== Turnos
select test.expect_error('un turno que acaba antes de empezar se rechaza',
  format($q$select public.schedule_shift(%L::uuid, now() + interval '2 hours', now())$q$,
         test.var('op3')));

select test.set_var('turno',
  (public.schedule_shift(test.var('op3')::uuid,
     now() - interval '30 minutes', now() + interval '7 hours')).id::text);

select test.check('el turno quedó programado con su sucursal',
  (select branch_id = test.var('b_a')::uuid from public.work_shifts
    where id = test.var('turno')::uuid));

select test.expect_error('dos turnos encima del mismo empleado se rechazan',
  format($q$select public.schedule_shift(%L::uuid, now(), now() + interval '3 hours')$q$,
         test.var('op3')));

select test.expect_ok('un turno que no solapa sí se acepta',
  format($q$select public.schedule_shift(%L::uuid,
    now() + interval '2 days', now() + interval '2 days 8 hours')$q$, test.var('op3')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no programa turnos',
  format($q$select public.schedule_shift(%L::uuid, now() + interval '5 days', now() + interval '5 days 4 hours')$q$,
         test.var('op3')));

-- =============================================================== Asistencia
set role postgres;
select set_config('request.jwt.claim.sub', test.var('op3'), false);
set role authenticated;

select test.set_var('marca', (public.clock_in()).id::text);

select test.check('la entrada se ata al turno del día y mide la tardanza',
  (select shift_id = test.var('turno')::uuid and late_minutes between 29 and 31
     from public.attendance_records where id = test.var('marca')::uuid),
  (select late_minutes::text from public.attendance_records where id = test.var('marca')::uuid));

select test.expect_error('no se marca entrada dos veces sin cerrar la jornada',
  $q$select public.clock_in()$q$);

select test.expect_error('un operario no marca la entrada de otro',
  format($q$select public.clock_in(%L::uuid)$q$, test.var('op1')));

-- Se retrasa la entrada tres horas para que la salida deje horas trabajadas.
set role postgres;
update public.attendance_records
   set checked_in_at = now() - interval '3 hours'
 where id = test.var('marca')::uuid;
select set_config('request.jwt.claim.sub', test.var('op3'), false);
set role authenticated;

-- La salida se marca dentro de un bloque: `(f()).campo between a and b` expande
-- BETWEEN en dos referencias y llama a la función DOS veces. La segunda no
-- encontraría jornada abierta y tumbaría la sentencia entera.
do $$
declare v_rec public.attendance_records;
begin
  v_rec := public.clock_out();
  perform test.set_var('minutos', v_rec.worked_minutes::text);
end $$;

select test.check('la salida calcula los minutos trabajados',
  test.var('minutos')::integer between 179 and 181,
  test.var('minutos') || ' minutos');

select test.expect_error('sin jornada abierta no hay salida que marcar',
  $q$select public.clock_out()$q$);

-- ================================================================ Adelantos
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no da adelantos',
  format($q$select public.register_payroll_advance(%L::uuid, 50000)$q$, test.var('op1')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('un adelanto de cero se rechaza',
  format($q$select public.register_payroll_advance(%L::uuid, 0)$q$, test.var('op1')));

-- Con caja abierta: el adelanto sale de la gaveta y se ve en el arqueo.
do $$
declare v_sess uuid;
begin
  select id into v_sess from public.cash_sessions
  where branch_id = test.var('b_a')::uuid and status = 'open';
  if v_sess is null then
    insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
      values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('u_cashier_a')::uuid, 500000)
      returning id into v_sess;
  end if;
  perform test.set_var('nom_sess', v_sess::text);
end $$;

select test.set_var('cash_pre_adelanto',
  (select expected_cash_cents::text from public.cash_sessions where id = test.var('nom_sess')::uuid));

do $$
begin
  perform public.register_payroll_advance(test.var('op1')::uuid, 30000,
    'Adelanto de quincena', test.var('nom_sess')::uuid);
end $$;

select test.check('el adelanto salió de la caja en la misma operación',
  (select expected_cash_cents from public.cash_sessions where id = test.var('nom_sess')::uuid)
    = test.var('cash_pre_adelanto')::bigint - 30000,
  format('%s → %s', test.var('cash_pre_adelanto'),
         (select expected_cash_cents from public.cash_sessions where id = test.var('nom_sess')::uuid)));

select test.check('el adelanto nace pendiente de descontar',
  (select count(*) = 1 from public.payroll_advances
    where profile_id = test.var('op1')::uuid and payroll_item_id is null));

-- ==================================================================== Nómina
select test.expect_error('un rango de fechas inválido se rechaza',
  $q$select public.open_payroll_period(current_date, current_date - 5)$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no abre nóminas',
  $q$select public.open_payroll_period(current_date - 14, current_date)$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.set_var('nomina',
  (public.open_payroll_period(current_date - 14, current_date, null, 'Quincena de prueba')).id::text);

select test.check('la nómina nace en borrador',
  (select status = 'borrador' from public.payroll_periods where id = test.var('nomina')::uuid));

-- 15 días sobre 30: la mitad de 15.000,00 = 7.500,00.
select test.check('el sueldo mensual se prorratea por los días del periodo',
  (select base_cents = 750000 from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op1')::uuid),
  (select base_cents::text from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op1')::uuid));

-- 3 horas a 250,00 = 750,00.
select test.check('el pago por hora sale de los minutos realmente trabajados',
  (select base_cents between 74500 and 75500 and worked_minutes between 179 and 181
     from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op3')::uuid),
  (select format('%s centavos / %s min', base_cents, worked_minutes) from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op3')::uuid));

select test.check('el adelanto se descontó del neto',
  (select advances_cents = 30000 and net_cents = base_cents + commissions_cents - 30000
     from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op1')::uuid));

select test.check('las comisiones del operario entraron en su partida',
  (select commissions_cents > 0 from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op2')::uuid),
  (select coalesce((select commissions_cents::text from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op2')::uuid), '(sin partida)')));

select test.check('la comisión queda amarrada a la partida que la recoge',
  (select count(*) = 0 from public.commissions c
    where c.company_id = test.var('c_a')::uuid and c.payroll_item_id is null and not c.is_paid
      and c.earned_on between current_date - 14 and current_date));

select test.check('los totales del periodo cuadran con sus partidas',
  (select p.net_cents = (select sum(i.net_cents) from public.payroll_items i where i.period_id = p.id)
     from public.payroll_periods p where p.id = test.var('nomina')::uuid));

select test.expect_error('no se abre dos veces la nómina del mismo periodo',
  $q$select public.open_payroll_period(current_date - 14, current_date)$q$);

-- ---- Ajustes: solo en borrador.
select test.set_var('partida',
  (select id::text from public.payroll_items
    where period_id = test.var('nomina')::uuid and profile_id = test.var('op1')::uuid));

select test.expect_error('un bono negativo se rechaza',
  format($q$select public.adjust_payroll_item(%L::uuid, -100)$q$, test.var('partida')));

select test.check('el bono se suma y la deducción se resta del neto',
  (select net_cents = base_cents + commissions_cents + 20000 - advances_cents - 5000
     from public.adjust_payroll_item(test.var('partida')::uuid, 20000, 5000, 'Bono por puntualidad')));

select test.check('el ajuste se propagó al total del periodo',
  (select p.net_cents = (select sum(i.net_cents) from public.payroll_items i where i.period_id = p.id)
     from public.payroll_periods p where p.id = test.var('nomina')::uuid));

-- ---- Aprobación y pago.
select test.expect_error('no se paga una nómina sin aprobar',
  format($q$select public.pay_payroll(%L::uuid, 'transferencia')$q$, test.var('nomina')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no aprueba la nómina',
  format($q$select public.approve_payroll(%L::uuid)$q$, test.var('nomina')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('el propietario aprueba la nómina',
  (public.approve_payroll(test.var('nomina')::uuid)).status = 'aprobada');

select test.expect_error('una nómina aprobada ya no admite ajustes',
  format($q$select public.adjust_payroll_item(%L::uuid, 1000)$q$, test.var('partida')));
select test.expect_error('una nómina aprobada no se aprueba dos veces',
  format($q$select public.approve_payroll(%L::uuid)$q$, test.var('nomina')));
select test.expect_error('la nómina no se paga a crédito',
  format($q$select public.pay_payroll(%L::uuid, 'credito')$q$, test.var('nomina')));
select test.expect_error('pagar en efectivo exige caja abierta',
  format($q$select public.pay_payroll(%L::uuid, 'efectivo')$q$, test.var('nomina')));

select test.set_var('cash_pre_nomina',
  (select expected_cash_cents::text from public.cash_sessions where id = test.var('nom_sess')::uuid));
select test.set_var('neto_nomina',
  (select net_cents::text from public.payroll_periods where id = test.var('nomina')::uuid));

select test.check('pagar la nómina la deja pagada',
  (public.pay_payroll(test.var('nomina')::uuid, 'efectivo', test.var('nom_sess')::uuid)).status = 'pagada');

select test.check('el pago salió de la caja, una línea por empleado',
  (select count(*) from public.cash_movements
    where cash_session_id = test.var('nom_sess')::uuid and reason like 'Nómina %')
  = (select count(*) from public.payroll_items
      where period_id = test.var('nomina')::uuid and net_cents > 0));

select test.check('la gaveta bajó exactamente el neto de la nómina',
  (select expected_cash_cents from public.cash_sessions where id = test.var('nom_sess')::uuid)
    = test.var('cash_pre_nomina')::bigint - test.var('neto_nomina')::bigint,
  format('%s → %s (neto %s)', test.var('cash_pre_nomina'),
         (select expected_cash_cents from public.cash_sessions where id = test.var('nom_sess')::uuid),
         test.var('neto_nomina')));

-- Lo que de verdad importa: `is_paid` deja de ser decorativo.
select test.check('las comisiones recogidas quedaron marcadas como pagadas',
  (select count(*) = 0 from public.commissions c
    join public.payroll_items i on i.id = c.payroll_item_id
   where i.period_id = test.var('nomina')::uuid and not c.is_paid));

select test.expect_error('una nómina pagada no se paga otra vez',
  format($q$select public.pay_payroll(%L::uuid, 'transferencia')$q$, test.var('nomina')));
select test.expect_error('una nómina pagada no se descarta',
  format($q$select public.delete_payroll_period(%L::uuid)$q$, test.var('nomina')));

-- El adelanto ya cobrado no vuelve a descontarse en la siguiente quincena.
select test.set_var('nomina2',
  (public.open_payroll_period(current_date + 1, current_date + 15)).id::text);

select test.check('el adelanto ya descontado no reaparece en la nómina siguiente',
  (select coalesce(sum(advances_cents), 0) = 0 from public.payroll_items
    where period_id = test.var('nomina2')::uuid));

select test.check('las comisiones ya pagadas no vuelven a entrar',
  (select coalesce(sum(commissions_cents), 0) = 0 from public.payroll_items
    where period_id = test.var('nomina2')::uuid));

-- Descartar un borrador suelta lo que tenía amarrado.
do $$
begin
  perform public.delete_payroll_period(test.var('nomina2')::uuid);
end $$;

select test.check('descartar el borrador borra el periodo y sus partidas',
  (select count(*) = 0 from public.payroll_periods where id = test.var('nomina2')::uuid));

-- ============================================== Aislamiento entre empresas
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('Beta no ve la nómina de Alfa',
  (select count(*) = 0 from public.payroll_periods));
select test.check('Beta no ve los turnos de Alfa',
  (select count(*) = 0 from public.work_shifts));
select test.check('Beta no ve los adelantos de Alfa',
  (select count(*) = 0 from public.payroll_advances));
select test.expect_error('Beta no fija el sueldo de un empleado de Alfa',
  format($q$select public.set_employee_pay(%L::uuid, 'mensual', 100000)$q$, test.var('op1')));
select test.expect_error('Beta no programa turnos a un empleado de Alfa',
  format($q$select public.schedule_shift(%L::uuid, now() + interval '9 days', now() + interval '9 days 4 hours')$q$,
         test.var('op3')));
select test.expect_error('Beta no da adelantos a un empleado de Alfa',
  format($q$select public.register_payroll_advance(%L::uuid, 10000)$q$, test.var('op1')));

set role postgres;
