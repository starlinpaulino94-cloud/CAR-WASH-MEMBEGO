-- =============================================================================
-- Resumen de facturas que respeta filtros (migración 20260912110000).
-- Universo propio: dos facturas vigentes y una anulada el 2099-10-01 en b_a,
-- y una factura FUERA del rango (2099-09-15) que NO debe contarse.
-- =============================================================================

set role postgres;
do $$
begin
  insert into public.invoices (company_id, branch_id, invoice_number, customer_name,
    subtotal_cents, tax_cents, total_cents, cashier_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-A', 'C1', 100000, 18000, 118000, test.var('u_cashier_a')::uuid, '2099-10-01 10:00:00-04'),
         (test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-B', 'C2', 50000, 9000, 59000, test.var('u_cashier_a')::uuid, '2099-10-01 12:00:00-04');
  insert into public.invoices (company_id, branch_id, invoice_number, customer_name,
    subtotal_cents, tax_cents, total_cents, cashier_id, created_at, is_annulled, annulled_reason, annulled_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-C', 'C3', 20000, 0, 20000, test.var('u_cashier_a')::uuid, '2099-10-01 14:00:00-04', true, 'prueba', now());
  -- Fuera del rango.
  insert into public.invoices (company_id, branch_id, invoice_number, customer_name,
    subtotal_cents, tax_cents, total_cents, cashier_id, created_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-FUERA', 'C4', 999999, 0, 999999, test.var('u_cashier_a')::uuid, '2099-09-15 10:00:00-04');
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('facturado del día = las dos vigentes, sin la de fuera del rango',
  (public.invoices_summary(test.var('b_a')::uuid, '2099-10-01','2099-10-01') ->> 'facturado_cents')::bigint = 118000 + 59000);
select test.check('dos facturas vigentes contadas',
  (public.invoices_summary(test.var('b_a')::uuid, '2099-10-01','2099-10-01') ->> 'facturas')::int = 2);
select test.check('el anulado cuenta la factura anulada',
  (public.invoices_summary(test.var('b_a')::uuid, '2099-10-01','2099-10-01') ->> 'anulado_cents')::bigint = 20000);
select test.check('ticket promedio del día = 177000 / 2',
  (public.invoices_summary(test.var('b_a')::uuid, '2099-10-01','2099-10-01') ->> 'ticket_promedio_cents')::bigint = 88500);
select test.check('la factura de otro día NO entra en el resumen',
  (public.invoices_summary(test.var('b_a')::uuid, '2099-10-01','2099-10-01') ->> 'facturado_cents')::bigint < 999999);

-- Aislamiento.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;
select test.expect_error('un usuario de B no puede pedir el resumen de una sucursal de A',
  format($q$select public.invoices_summary(%L::uuid)$q$, test.var('b_a')));

reset role;
