-- =============================================================================
-- Pruebas del CÓDIGO DE BARRAS automático de productos (migración 0043)
-- =============================================================================
-- Lo que se demuestra:
--   · un producto creado sin código nace con un EAN-13 válido;
--   · el prefijo es 2 (uso interno del comercio), que es lo que evita chocar
--     con el código real de un fabricante;
--   · el dígito verificador cuadra — si no, ningún lector aceptaría la etiqueta;
--   · dos productos nunca comparten código, ni creados a la vez;
--   · un código escrito a mano (el del envase) se RESPETA, no se pisa;
--   · vaciar el código al editar lo repone: nunca queda un producto sin etiqueta;
--   · dos productos de la misma empresa no pueden tener el mismo código;
--   · el relleno histórico dejó con código a los productos que ya existían.
-- =============================================================================

set role postgres;

-- ------------------------------------------------- El verificador, a solas
-- Contra códigos REALES conocidos: si las pesas estuvieran al revés, estas tres
-- fallarían aunque la función fuese coherente consigo misma.
select test.check(
  'verificador EAN-13 de 400638133393 es 1',
  app.ean13_digito_verificador('400638133393') = 1);
select test.check(
  'verificador EAN-13 de 590123412345 es 7',
  app.ean13_digito_verificador('590123412345') = 7);
select test.check(
  'verificador EAN-13 de 978030640615 es 7',
  app.ean13_digito_verificador('978030640615') = 7);

select test.expect_error(
  'el verificador exige 12 dígitos',
  $$select app.ean13_digito_verificador('123')$$);

-- --------------------------------------------- Un producto nace etiquetado
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

do $$
declare v_id uuid;
begin
  insert into public.products (company_id, branch_id, code, name, price_cents)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'BAR-001', 'Fragancia pino', 15000)
  returning id into v_id;
  perform test.set_var('prd_bar1', v_id::text);
end $$;

select test.check(
  'un producto creado sin código de barras recibe uno',
  (select barcode is not null and length(barcode) = 13
     from public.products where id = test.var('prd_bar1')::uuid));

select test.check(
  'el código generado empieza por 2 (uso interno)',
  (select left(barcode, 1) = '2'
     from public.products where id = test.var('prd_bar1')::uuid));

select test.check(
  'el código generado es solo dígitos',
  (select barcode ~ '^[0-9]{13}$'
     from public.products where id = test.var('prd_bar1')::uuid));

-- El verificador del código generado tiene que cuadrar consigo mismo: es lo que
-- hace que un lector lo acepte.
select test.check(
  'el dígito verificador del código generado es correcto',
  (select app.ean13_digito_verificador(left(barcode, 12)) = right(barcode, 1)::integer
     from public.products where id = test.var('prd_bar1')::uuid));

-- ------------------------------------------------------ Nunca se repiten
do $$
declare v_id uuid;
begin
  insert into public.products (company_id, branch_id, code, name, price_cents)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'BAR-002', 'Shampoo', 25000)
  returning id into v_id;
  perform test.set_var('prd_bar2', v_id::text);
end $$;

select test.check(
  'dos productos reciben códigos distintos',
  (select p1.barcode <> p2.barcode
     from public.products p1, public.products p2
    where p1.id = test.var('prd_bar1')::uuid
      and p2.id = test.var('prd_bar2')::uuid));

-- ------------------------------------------- El código del envase se respeta
do $$
declare v_id uuid;
begin
  insert into public.products (company_id, branch_id, code, name, price_cents, barcode)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'BAR-003', 'Refresco', 5000,
          '7501234567890')
  returning id into v_id;
  perform test.set_var('prd_bar3', v_id::text);
end $$;

select test.check(
  'un código escrito a mano NO se pisa (es el del envase)',
  (select barcode = '7501234567890'
     from public.products where id = test.var('prd_bar3')::uuid));

-- Espacios de un copiar-pegar: se limpian, no se toman como «vacío».
do $$
declare v_id uuid;
begin
  insert into public.products (company_id, branch_id, code, name, price_cents, barcode)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'BAR-004', 'Cera', 45000,
          '  7501111111116  ')
  returning id into v_id;
  perform test.set_var('prd_bar4', v_id::text);
end $$;

select test.check(
  'un código pegado con espacios se guarda limpio',
  (select barcode = '7501111111116'
     from public.products where id = test.var('prd_bar4')::uuid));

-- ------------------------------------- Vaciarlo al editar lo repone
update public.products set barcode = '' where id = test.var('prd_bar3')::uuid;

select test.check(
  'vaciar el código al editar lo repone (nunca queda sin etiqueta)',
  (select barcode ~ '^2[0-9]{12}$'
     from public.products where id = test.var('prd_bar3')::uuid));

-- ------------------------------------------------ Unicidad por empresa
select test.expect_error(
  'dos productos de la misma empresa no pueden compartir código',
  $$insert into public.products (company_id, branch_id, code, name, price_cents, barcode)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'BAR-005', 'Clon', 100,
            (select barcode from public.products where id = test.var('prd_bar1')::uuid))$$);

-- ------------------------------------------------- Relleno histórico
-- Ningún producto de la base de pruebas puede haber quedado sin código: los que
-- crearon las pruebas anteriores entraron antes de esta migración.
select test.check(
  'ningún producto quedó sin código de barras',
  (select count(*) = 0 from public.products
    where barcode is null or btrim(barcode) = ''));

select test.check(
  'todos los códigos existentes tienen 13 dígitos',
  (select count(*) = 0 from public.products where barcode !~ '^[0-9]{13}$'));

set role postgres;
