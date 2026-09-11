-- =============================================================================
-- Reportes gerenciales (migración 20260911160000).
-- Continúa sobre las vars de 10/20/30: c_a, b_a, u_owner_a, u_cashier_a,
-- op1, op2, serv.
--
-- Estos son los números que un dueño va a mirar para decidir. Los errores caros:
--   · que un KPI y su drill-down no sumen igual;
--   · que el corte de día cuente un lavado de la noche en el día siguiente;
--   · que las comisiones se descuenten dos veces (una en su línea y otra dentro
--     de la nómina) e inflen las pérdidas;
--   · que un lavador vea la producción de sus compañeros.
-- Se arma un universo propio en 2099 para no mezclarse con las demás pruebas.
-- =============================================================================

set role postgres;
do $$
declare
  v_inv1 uuid; v_inv2 uuid; v_inv3 uuid;
  v_ord  uuid;
  v_sess uuid;
  v_bsuc uuid;
begin
  -- Una sucursal aparte para la caja de esta prueba: solo se admite UNA sesión
  -- abierta por sucursal (la de b_a ya la ocupan otras pruebas) y una cerrada no
  -- admite movimientos. La FK de cash_movements pide misma EMPRESA, no sucursal.
  insert into public.branches (company_id, name, is_main)
  values (test.var('c_a')::uuid, 'Sucursal Reporte', false)
  returning id into v_bsuc;
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents, status)
  values (test.var('c_a')::uuid, v_bsuc, test.var('u_cashier_a')::uuid, 0, 'open')
  returning id into v_sess;
  -- Dos facturas vigentes y una anulada, el 15/06/2099 (hora local RD).
  insert into public.invoices (company_id, branch_id, invoice_number, ncf_type,
    customer_name, vehicle_plate, subtotal_cents, discount_cents, tax_cents, total_cents,
    cashier_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'RPT-1', null,
    'Cliente Uno', 'RPT001', 100000, 0, 18000, 118000,
    test.var('u_cashier_a')::uuid, '2099-06-15 10:00:00-04')
  returning id into v_inv1;

  insert into public.invoices (company_id, branch_id, invoice_number, ncf_type,
    customer_name, vehicle_plate, subtotal_cents, discount_cents, tax_cents, total_cents,
    cashier_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'RPT-2', null,
    'Cliente Dos', 'RPT002', 50000, 0, 9000, 59000,
    test.var('u_cashier_a')::uuid, '2099-06-15 15:00:00-04')
  returning id into v_inv2;

  -- Una factura después de las 20:00 LOCALES: es el caso que la zona horaria
  -- decide. 22:00 en RD (UTC-4) es 02:00 UTC del día 16. Debe contar el 15.
  insert into public.invoices (company_id, branch_id, invoice_number, ncf_type,
    customer_name, vehicle_plate, subtotal_cents, discount_cents, tax_cents, total_cents,
    cashier_id, created_at, is_annulled, annulled_reason, annulled_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'RPT-3', null,
    'Cliente Tres', 'RPT003', 20000, 0, 0, 20000,
    test.var('u_cashier_a')::uuid, '2099-06-15 22:00:00-04',
    true, 'prueba de anulada', now())
  returning id into v_inv3;

  insert into public.invoice_items (invoice_id, item_type, service_id, name, quantity, unit_price_cents)
  values (v_inv1, 'service', test.var('serv')::uuid, 'Lavado Alfa', 1, 100000),
         (v_inv2, 'service', test.var('serv')::uuid, 'Lavado Alfa', 1, 50000);

  -- Cobros en caja: efectivo y tarjeta. Sin sesión de caja para no arrastrar
  -- el arqueo; el reporte lee cash_movements por invoice_id.
  insert into public.cash_movements (company_id, cash_session_id, type, method, amount_cents, reason, invoice_id)
  values (test.var('c_a')::uuid, v_sess, 'inflow', 'efectivo', 118000, 'Factura RPT-1', v_inv1),
         (test.var('c_a')::uuid, v_sess, 'inflow', 'tarjeta', 59000, 'Factura RPT-2', v_inv2);

  -- Una orden entregada compartida por op1 y op2, con inicio y entrega a 30 min.
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at, started_at, delivered_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'RPT-ORD-1', 'Cliente Uno',
    'RPT001', 'entregado', '2099-06-15 09:00:00-04', '2099-06-15 09:10:00-04', '2099-06-15 09:40:00-04')
  returning id into v_ord;

  insert into public.work_order_items (work_order_id, item_type, service_id, name, quantity, unit_price_cents)
  values (v_ord, 'service', test.var('serv')::uuid, 'Lavado Alfa', 1, 100000);
  insert into public.work_order_assignees (work_order_id, profile_id, company_id)
  values (v_ord, test.var('op1')::uuid, test.var('c_a')::uuid),
         (v_ord, test.var('op2')::uuid, test.var('c_a')::uuid);

  -- La factura RPT-1 corresponde a esa orden: sin este enlace el filtro por
  -- lavador no encontraría la venta.
  update public.invoices set work_order_id = v_ord where id = v_inv1;

  -- Comisiones devengadas: 5000 a cada lavador.
  insert into public.commissions (company_id, branch_id, profile_id, work_order_id,
    service_name, base_cents, commission_bps, amount_cents, earned_on)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('op1')::uuid, v_ord,
          'Lavado Alfa', 50000, 1000, 5000, '2099-06-15'),
         (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('op2')::uuid, v_ord,
          'Lavado Alfa', 50000, 1000, 5000, '2099-06-15');

  -- Calidad: a op1 le rechazan una (reproceso) y le aprueban otra; op2 aprueba.
  insert into public.qc_reviews (company_id, branch_id, work_order_id, attempt, result, reject_reason, washer_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, v_ord, 1, 'rechazado', 'faltó secar', test.var('op1')::uuid, '2099-06-15 09:30:00-04');
  insert into public.qc_reviews (company_id, branch_id, work_order_id, attempt, result, washer_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, v_ord, 2, 'aprobado', test.var('op1')::uuid, '2099-06-15 09:38:00-04');

  -- Insumos consumidos por la orden: 10000.
  declare v_prod uuid;
  begin
    insert into public.products (company_id, code, name, unit, cost_cents, price_cents, stock, min_stock)
    values (test.var('c_a')::uuid, 'RPT-PROD', 'Insumo reporte', 'unidad', 10000, 15000, 100, 10)
    returning id into v_prod;
    insert into public.service_consumptions (company_id, work_order_id, service_id, product_id, quantity, cost_cents, created_at)
    values (test.var('c_a')::uuid, v_ord, test.var('serv')::uuid, v_prod, 1, 10000, '2099-06-15 09:40:00-04');
  end;

  -- Un gasto de 5000 en el periodo.
  insert into public.expenses (company_id, branch_id, description, amount_cents, expense_date)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'Prueba reporte', 5000, '2099-06-15');

  -- Nómina de junio 2099, aprobada, bruto 60000 con 10000 de comisiones dentro.
  declare v_per uuid;
  begin
    insert into public.payroll_periods (company_id, branch_id, period_from, period_to, status, gross_cents, net_cents)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid, '2099-06-01', '2099-06-30', 'aprobada', 60000, 50000)
    returning id into v_per;
    insert into public.payroll_items (company_id, period_id, profile_id, payroll_type, base_cents, commissions_cents, net_cents)
    values (test.var('c_a')::uuid, v_per, test.var('op1')::uuid, 'solo_comision', 0, 10000, 10000);
  end;
end $$;

-- ─────────────────────────────────────────────── Se consulta como PROPIETARIO
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ── sales_report ──
select test.check('ventas del día suman las dos facturas vigentes',
  (public.sales_report('2099-06-15','2099-06-15') -> 'kpis' ->> 'ventas_cents')::bigint = 177000);
select test.check('la factura de las 10 de la noche cuenta en SU día, no en el siguiente',
  (public.sales_report('2099-06-15','2099-06-15') -> 'kpis' ->> 'anulado_cents')::bigint = 20000);
select test.check('el día siguiente no ve ninguna de esas facturas',
  (public.sales_report('2099-06-16','2099-06-16') -> 'kpis' ->> 'ventas_cents')::bigint = 0);
select test.check('dos facturas vigentes contadas',
  (public.sales_report('2099-06-15','2099-06-15') -> 'kpis' ->> 'facturas')::int = 2);
select test.check('ticket promedio = 177000 / 2',
  (public.sales_report('2099-06-15','2099-06-15') -> 'kpis' ->> 'ticket_promedio_cents')::bigint = 88500);

-- Filtro por método: solo tarjeta deja la factura 2.
select test.check('filtrar por tarjeta deja solo la factura de 59000',
  (public.sales_report('2099-06-15','2099-06-15', '{"payment_method":"tarjeta"}'::jsonb) -> 'kpis' ->> 'ventas_cents')::bigint = 59000);
select test.check('y por efectivo, solo la de 118000',
  (public.sales_report('2099-06-15','2099-06-15', '{"payment_method":"efectivo"}'::jsonb) -> 'kpis' ->> 'ventas_cents')::bigint = 118000);

-- Filtro por lavador: solo las facturas de órdenes que trabajó op1.
select test.check('filtrar por un lavador acota a las órdenes que trabajó',
  (public.sales_report('2099-06-15','2099-06-15',
     jsonb_build_object('washer_id', test.var('op1'))) -> 'kpis' ->> 'ventas_cents')::bigint = 118000);

-- por_metodo y por_cajero
select test.check('por_metodo reparte efectivo y tarjeta',
  (select count(*) from jsonb_array_elements(
     public.sales_report('2099-06-15','2099-06-15') -> 'por_metodo')) = 2);
select test.check('por_cajero atribuye las dos facturas al cajero',
  (public.sales_report('2099-06-15','2099-06-15') -> 'por_cajero' -> 0 ->> 'sales_cents')::bigint = 177000);

-- ── drill-down cuadra con el KPI ──
select test.check('el drill-down devuelve exactamente las 2 facturas vigentes',
  (public.sales_report_invoices('2099-06-15','2099-06-15') ->> 'total')::int = 2);
select test.check('KPI y drill-down suman igual',
  (select sum((r ->> 'total_cents')::bigint)
     from jsonb_array_elements(public.sales_report_invoices('2099-06-15','2099-06-15') -> 'rows') r)
   = (public.sales_report('2099-06-15','2099-06-15') -> 'kpis' ->> 'ventas_cents')::bigint);

-- ── washer_report ──
select test.check('op1 tiene 1 lavado en el periodo',
  (select (w ->> 'lavados')::int from jsonb_array_elements(
     public.washer_report('2099-06-15','2099-06-15') -> 'lavadores') w
   where (w ->> 'profile_id') = test.var('op1')) = 1);
select test.check('generado de op1 = 100000 repartido entre dos = 50000',
  (select (w ->> 'generado_cents')::bigint from jsonb_array_elements(
     public.washer_report('2099-06-15','2099-06-15') -> 'lavadores') w
   where (w ->> 'profile_id') = test.var('op1')) = 50000);
select test.check('op1 registra 1 reproceso de 2 revisiones (50%)',
  (select (w ->> 'reproceso_pct')::int from jsonb_array_elements(
     public.washer_report('2099-06-15','2099-06-15') -> 'lavadores') w
   where (w ->> 'profile_id') = test.var('op1')) = 50);
select test.check('tiempo de ciclo de op1 = 30 minutos = 1800 s',
  (select (w ->> 'segundos_promedio')::bigint from jsonb_array_elements(
     public.washer_report('2099-06-15','2099-06-15') -> 'lavadores') w
   where (w ->> 'profile_id') = test.var('op1')) = 1800);
select test.check('comisión pendiente de op1 = 5000 (nada pagado aún)',
  (select (w ->> 'comision_pendiente_cents')::bigint from jsonb_array_elements(
     public.washer_report('2099-06-15','2099-06-15') -> 'lavadores') w
   where (w ->> 'profile_id') = test.var('op1')) = 5000);

-- drill-down del lavador
select test.check('el drill-down de op1 muestra su orden como compartida',
  (public.washer_report_orders('2099-06-15','2099-06-15', test.var('op1')::uuid) -> 'rows' -> 0 ->> 'compartida')::boolean = true);
select test.check('su parte en esa orden es 50000',
  (public.washer_report_orders('2099-06-15','2099-06-15', test.var('op1')::uuid) -> 'rows' -> 0 ->> 'parte_cents')::bigint = 50000);

-- ── profit_report: la cascada, con la nómina SIN doble conteo ──
select test.check('ingreso neto = 150000 (subtotales, sin descuentos ni NC)',
  (public.profit_report('2099-06-15','2099-06-15') ->> 'ingreso_neto_cents')::bigint = 150000);
select test.check('insumos consumidos = 10000',
  (public.profit_report('2099-06-15','2099-06-15') ->> 'insumos_cents')::bigint = 10000);
select test.check('comisiones directas = 10000',
  (public.profit_report('2099-06-15','2099-06-15') ->> 'comisiones_cents')::bigint = 10000);
select test.check('margen de contribución = 150000 - 10000 - 10000 = 130000',
  (public.profit_report('2099-06-15','2099-06-15') ->> 'margen_contribucion_cents')::bigint = 130000);
-- La nómina del mes solapa el rango de UN día: se prorratea 1/30 del bruto sin
-- comisiones. (60000 - 10000) * 1 / 30 = 1666. Lo que importa es que NO sea
-- 60000 (bruto entero) ni incluya otra vez las comisiones.
select test.check('la nómina se prorratea por días y sin sus comisiones',
  (public.profit_report('2099-06-15','2099-06-15') ->> 'nomina_cents')::bigint = round((60000-10000)*1.0/30));
select test.check('mirando el mes entero, la nómina es el bruto menos comisiones (50000)',
  (public.profit_report('2099-06-01','2099-06-30') ->> 'nomina_cents')::bigint = 50000);
select test.check('margen por servicio descuenta insumos Y comisiones',
  (select (s ->> 'margin_cents')::bigint from jsonb_array_elements(
     public.profit_report('2099-06-15','2099-06-15') -> 'margen_por_servicio') s
   where (s ->> 'name') = 'Lavado Alfa') = 150000 - 10000 - 10000);

-- ── permisos: consultar como CAJERO y como OPERARIO debe fallar ──
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero NO puede ver el rendimiento de los lavadores',
  $q$select public.washer_report('2099-06-15','2099-06-15')$q$);
select test.expect_error('un cajero NO puede ver el estado de resultados',
  $q$select public.profit_report('2099-06-15','2099-06-15')$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('op1'), false);
set role authenticated;
select test.expect_error('un operario NO puede ver washer_performance (ya no es libre)',
  $q$select * from public.washer_performance('2099-06-15','2099-06-15')$q$);

reset role;
