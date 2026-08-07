-- =============================================================================
-- Pruebas del reporte gerencial (migración 0022)
-- =============================================================================
-- Corre al final: aprovecha las facturas de 20_billing, los gastos de 40_admin,
-- las compras de 70 y los consumos de 80, todos de HOY.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.set_var('rep',
  public.management_report(current_date, current_date)::text);

select test.check('el reporte cuadra las ventas con las facturas vigentes de hoy',
  (test.var('rep')::jsonb #>> '{sales,total_cents}')::bigint = (
    select coalesce(sum(total_cents), 0) from public.invoices
    where company_id = test.var('c_a')::uuid and not is_annulled
      and ncf_type is distinct from 'B04' and created_at::date = current_date));

select test.check('el conteo de facturas coincide',
  (test.var('rep')::jsonb #>> '{sales,invoice_count}')::integer = (
    select count(*) from public.invoices
    where company_id = test.var('c_a')::uuid and not is_annulled
      and ncf_type is distinct from 'B04' and created_at::date = current_date));

select test.check('el costo de insumos consumidos cuadra con los registros de recetas',
  (test.var('rep')::jsonb ->> 'consumption_cents')::bigint = (
    select coalesce(sum(cost_cents), 0) from public.service_consumptions
    where company_id = test.var('c_a')::uuid and created_at::date = current_date));

select test.check('las cuentas por pagar del reporte cuadran con las compras con saldo',
  (test.var('rep')::jsonb ->> 'payables_cents')::bigint = (
    select coalesce(sum(total_cents - paid_cents), 0) from public.purchases
    where company_id = test.var('c_a')::uuid and status = 'recibida'
      and paid_cents < total_cents));

select test.check('la utilidad bruta estimada es ventas − insumos − gastos',
  (test.var('rep')::jsonb ->> 'gross_profit_cents')::bigint =
    (test.var('rep')::jsonb #>> '{sales,total_cents}')::bigint
    - (test.var('rep')::jsonb ->> 'consumption_cents')::bigint
    - (test.var('rep')::jsonb ->> 'expenses_total_cents')::bigint);

select test.check('el margen por servicio trae ventas y consumo del servicio con receta',
  (select count(*) >= 1 from jsonb_array_elements(test.var('rep')::jsonb -> 'service_margin') e
    where (e ->> 'consumption_cents')::bigint > 0));

-- ---- Permisos y aislamiento.
select test.expect_error('un rango invertido se rechaza',
  $q$select public.management_report(current_date, current_date - 1)$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede consultar el reporte gerencial',
  $q$select public.management_report(current_date, current_date)$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;
select test.check('el reporte de otra empresa no arrastra datos de Alfa (RLS)',
  (public.management_report(current_date, current_date) #>> '{sales,total_cents}')::bigint = 0);

reset role;
