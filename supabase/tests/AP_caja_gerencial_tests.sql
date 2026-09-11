-- =============================================================================
-- Caja gerencial (migración 20260912100000).
-- Universo propio: dos cajas cerradas en b_a el 2099-09-01, una con faltante y
-- otra con sobrante, más una abierta. Diferencia = contado − esperado.
-- =============================================================================

set role postgres;
do $$
begin
  -- Caja cerrada con FALTANTE de 500 (contó 500 menos de lo esperado) y ventas.
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents,
    status, opened_at, closed_at, expected_cash_cents, counted_cash_cents, difference_cents,
    total_cash_sales_cents, total_card_sales_cents, total_transfer_sales_cents, total_membego_cents, total_outflows_cents)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('u_cashier_a')::uuid, 100000,
    'closed', '2099-09-01 08:00:00-04', '2099-09-01 20:00:00-04', 500000, 499500, -500,
    400000, 200000, 100000, 50000, 30000);

  -- Caja cerrada con SOBRANTE de 300.
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents,
    status, opened_at, closed_at, expected_cash_cents, counted_cash_cents, difference_cents,
    total_cash_sales_cents, total_card_sales_cents, total_transfer_sales_cents, total_membego_cents, total_outflows_cents)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, test.var('u_owner_a')::uuid, 100000,
    'closed', '2099-09-01 08:00:00-04', '2099-09-01 20:00:00-04', 300000, 300300, 300,
    250000, 0, 0, 0, 0);
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ── Resumen ──
select test.check('dos cajas cerradas el día',
  (public.cash_summary(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'cajas_cerradas')::int = 2);
select test.check('ventas del día = suma de todos los métodos',
  (public.cash_summary(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'ventas_cents')::bigint
    = (400000+200000+100000+50000) + 250000);
select test.check('efectivo del día',
  (public.cash_summary(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'efectivo_cents')::bigint = 650000);
select test.check('sobrantes y faltantes NO se netean: 300 y 500 por separado',
  (public.cash_summary(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'sobrantes_cents')::bigint = 300
  and (public.cash_summary(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'faltantes_cents')::bigint = 500);
select test.check('el descuadre neto es la suma con signo (300 − 500 = −200)',
  (public.cash_summary(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'descuadre_neto_cents')::bigint = -200);

-- ── Histórico y filtros ──
select test.check('el histórico trae las dos cajas del día',
  (public.cash_sessions_page(test.var('b_a')::uuid, '2099-09-01','2099-09-01') ->> 'total')::int = 2);
select test.check('filtrar «con diferencia» trae ambas (ninguna cuadró exacto)',
  (public.cash_sessions_page(test.var('b_a')::uuid, '2099-09-01','2099-09-01', null, null, 'con') ->> 'total')::int = 2);
select test.check('filtrar por el cajero deja solo su caja',
  (public.cash_sessions_page(test.var('b_a')::uuid, '2099-09-01','2099-09-01', test.var('u_cashier_a')::uuid) ->> 'total')::int = 1);
select test.check('la fila trae el nombre del cajero y su diferencia',
  (select (r ->> 'difference_cents')::bigint from jsonb_array_elements(
     public.cash_sessions_page(test.var('b_a')::uuid, '2099-09-01','2099-09-01', test.var('u_cashier_a')::uuid) -> 'rows') r
   limit 1) = -500);

-- ── Permiso ──
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no ve el resumen gerencial de caja',
  format($q$select public.cash_summary(%L::uuid)$q$, test.var('b_a')));

reset role;
