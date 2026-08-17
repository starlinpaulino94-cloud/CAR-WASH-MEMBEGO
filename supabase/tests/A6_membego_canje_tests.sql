-- =============================================================================
-- Pruebas del canje de Membego en la factura (migración 0039)
-- =============================================================================
-- Lo que se demuestra, y todo cuesta dinero si se pierde:
--   · una factura sin beneficio no dice que tenga uno;
--   · anotar el canje dos veces deja el mismo resultado;
--   · un canje que llega TARDE no resucita un beneficio ya devuelto — este es
--     el que de verdad importa: sin ese guard, un reintento tras la anulación
--     le quitaría al cliente un lavado que ya se le había devuelto;
--   · revertir dos veces no es un error;
--   · una empresa no toca las facturas de la otra.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Una factura de Alfa sobre la que trabajar.
do $$
declare v_id uuid;
begin
  insert into public.invoices (
    company_id, branch_id, invoice_number, customer_name,
    subtotal_cents, tax_cents, total_cents, cashier_id
  ) values (
    test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-MG-1', 'Cliente Membego',
    100000, 18000, 118000, test.var('u_owner_a')::uuid
  ) returning id into v_id;
  perform test.set_var('inv_mg', v_id::text);
end $$;

select test.check('una factura nace sin beneficio de Membego',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg')::uuid)
    = 'sin_beneficio');

-- ==================================================== Anotar el canje
select public.record_membego_redemption(
  test.var('inv_mg')::uuid, 'visit-001', 'memb-001', 50000
);

select test.check('el canje queda anotado con su visita',
  (select membego_visit_id from public.invoices where id = test.var('inv_mg')::uuid) = 'visit-001');
select test.check('y con lo que cubrió, congelado en centavos',
  (select membego_covered_cents from public.invoices where id = test.var('inv_mg')::uuid) = 50000);
select test.check('el estado pasa a canjeado',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg')::uuid) = 'canjeado');

-- Repetir no cambia nada: un reintento tras un timeout es lo normal.
select public.record_membego_redemption(
  test.var('inv_mg')::uuid, 'visit-001', 'memb-001', 50000
);
select test.check('anotar el mismo canje dos veces deja el mismo resultado',
  (select count(*) from public.invoices
    where id = test.var('inv_mg')::uuid and membego_canje_estado = 'canjeado'
      and membego_visit_id = 'visit-001') = 1);

-- ==================================================== La reversa
select public.record_membego_reversal(test.var('inv_mg')::uuid);
select test.check('revertir deja la factura como revertida',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg')::uuid) = 'revertido');
select test.check('y sella cuándo',
  (select membego_revertido_at from public.invoices where id = test.var('inv_mg')::uuid) is not null);

select public.record_membego_reversal(test.var('inv_mg')::uuid);
select test.check('revertir dos veces no es un error',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg')::uuid) = 'revertido');

-- ==================================================== El canje que llega tarde
-- El caso que de verdad importa: la factura se anuló y se devolvió el lavado,
-- y DESPUÉS llega el reintento del canje que se había quedado colgado. Sin el
-- guard, le quitaría al cliente un lavado que ya se le había devuelto.
select public.record_membego_redemption(
  test.var('inv_mg')::uuid, 'visit-999', 'memb-001', 50000
);
select test.check('un canje que llega tarde NO resucita un beneficio ya devuelto',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg')::uuid) = 'revertido');
select test.check('y no le cambia la visita por la del reintento',
  (select membego_visit_id from public.invoices where id = test.var('inv_mg')::uuid) = 'visit-001');

-- ==================================================== Un canje fallido
do $$
declare v_id uuid;
begin
  insert into public.invoices (
    company_id, branch_id, invoice_number, customer_name,
    subtotal_cents, tax_cents, total_cents, cashier_id
  ) values (
    test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-MG-2', 'Cliente Membego',
    100000, 18000, 118000, test.var('u_owner_a')::uuid
  ) returning id into v_id;
  perform test.set_var('inv_mg2', v_id::text);
end $$;

select public.record_membego_redemption(
  test.var('inv_mg2')::uuid, null, 'memb-001', 0, 'Membego respondió 503'
);
select test.check('un canje fallido se guarda como fallido, no se pierde en un log',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg2')::uuid) = 'fallido');
select test.check('con el motivo, para poder reintentarlo sabiendo qué pasó',
  (select membego_canje_error from public.invoices where id = test.var('inv_mg2')::uuid)
    like '%503%');

select test.expect_error(
  'un canje confirmado sin visita se rechaza: sin ella no se podría deshacer',
  $$select public.record_membego_redemption(test.var('inv_mg2')::uuid, '', 'memb-001', 100)$$
);

-- ==================================================== La otra empresa
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.expect_error(
  'Beta no puede anotar un canje sobre una factura de Alfa',
  $$select public.record_membego_redemption(test.var('inv_mg2')::uuid, 'v-b', 'm-b', 100)$$
);

set role postgres;
select test.check('la factura de Alfa sigue como estaba',
  (select membego_canje_estado from public.invoices where id = test.var('inv_mg2')::uuid) = 'fallido');
set role authenticated;
