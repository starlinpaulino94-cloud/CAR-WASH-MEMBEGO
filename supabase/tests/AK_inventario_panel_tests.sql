-- =============================================================================
-- Panel de inventario (migración 20260911180000).
-- Continúa sobre las vars de 10/20: c_a, b_a, u_owner_a, prod.
--
-- El error que esto vigila es el que motivó la migración: contar el bajo stock
-- en el navegador, sobre la página traída. Si hay 30 productos en bajo stock
-- repartidos en varias páginas, el sistema debe encontrar los 30, no los que
-- caigan en la primera página. Por eso la comprobación crea MÁS productos que
-- una página y confirma el conteo total.
-- =============================================================================

set role postgres;
do $$
declare i int;
begin
  -- 30 productos en bajo stock y 5 agotados y 2 en negativo, todos de la
  -- empresa A. Nombres que no chocan con los de otras pruebas.
  for i in 1..30 loop
    insert into public.products (company_id, code, name, cost_cents, price_cents, stock, min_stock, is_for_sale)
    values (test.var('c_a')::uuid, 'LOW-' || i, 'Bajo ' || i, 1000, 2000, 2, 5, true);
  end loop;
  for i in 1..5 loop
    insert into public.products (company_id, code, name, cost_cents, price_cents, stock, min_stock)
    values (test.var('c_a')::uuid, 'OUT-' || i, 'Agotado ' || i, 1000, 2000, 0, 3);
  end loop;
  insert into public.products (company_id, code, name, cost_cents, price_cents, stock, min_stock)
  values (test.var('c_a')::uuid, 'NEG-1', 'Negativo 1', 1000, 2000, -2, 1),
         (test.var('c_a')::uuid, 'NEG-2', 'Negativo 2', 1000, 2000, -1, 1);
  -- Uno bien surtido, para la valoración.
  insert into public.products (company_id, code, name, cost_cents, price_cents, stock, min_stock, is_for_sale)
  values (test.var('c_a')::uuid, 'OK-1', 'Surtido', 5000, 8000, 10, 2, true);
end $$;

-- ── La columna calculada existe y es correcta, fila a fila ──
select test.check('low_stock es verdadero cuando stock <= min_stock',
  (select low_stock from public.products where company_id = test.var('c_a')::uuid and code = 'LOW-1'));
select test.check('low_stock es falso en un producto bien surtido',
  (select not low_stock from public.products where company_id = test.var('c_a')::uuid and code = 'OK-1'));
select test.check('out_of_stock es verdadero en un agotado',
  (select out_of_stock from public.products where company_id = test.var('c_a')::uuid and code = 'OUT-1'));
select test.check('un negativo también cuenta como out_of_stock',
  (select out_of_stock from public.products where company_id = test.var('c_a')::uuid and code = 'NEG-1'));

-- ── El conteo del bajo stock es de TODO el inventario, no de una página ──
-- Es la prueba que representa el bug: contar con el predicado en la base.
select test.check('el bajo stock se cuenta entero: los 30 + los 5 agotados + 2 negativos',
  (select count(*) from public.products
    where company_id = test.var('c_a')::uuid and low_stock and is_active) >= 37);

-- ── Resumen (KPIs) como propietario ──
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('el resumen cuenta al menos los 5 agotados que se sembraron',
  (public.inventory_summary() ->> 'agotados')::int >= 5);
select test.check('el resumen cuenta los 2 negativos que se sembraron',
  (public.inventory_summary() ->> 'negativos')::int >= 2);
-- La invariante que importa: «bajo stock» y «agotados» son tarjetas DISTINTAS.
-- Un agotado no debe contarse también como bajo stock (sería contar doble).
-- low_stock se reparte en tres tarjetas que no se solapan: bajo stock (con
-- existencia), agotados (=0) y negativos (<0). Su suma es el total con low_stock.
select test.check('las tres tarjetas reparten el low_stock sin solaparse',
  (public.inventory_summary() ->> 'bajo_stock')::int
  + (public.inventory_summary() ->> 'agotados')::int
  + (public.inventory_summary() ->> 'negativos')::int
  = (select count(*) from public.products
      where company_id = test.var('c_a')::uuid and is_active and low_stock));
select test.check('y hay al menos los 30 productos de bajo stock sembrados',
  (public.inventory_summary() ->> 'bajo_stock')::int >= 30);
select test.check('la valoración a costo incluye el surtido (10 * 5000 = 50000)',
  (public.inventory_summary() ->> 'valor_costo_cents')::bigint >= 50000);
select test.check('la venta potencial usa el precio, no el costo (10 * 8000 = 80000)',
  (public.inventory_summary() ->> 'venta_potencial_cents')::bigint >= 80000);
select test.check('sin rango, el resumen no trae consumo (es opcional)',
  (public.inventory_summary()) -> 'consumo_cents' is null);
select test.check('con rango, el resumen SÍ trae consumo y merma',
  (public.inventory_summary('2099-06-01','2099-06-30')) -> 'consumo_cents' is not null);

-- ── Ficha de producto ──
select test.check('la ficha de un producto devuelve sus bloques',
  (public.product_detail(test.var('prod')::uuid)) ? 'ultimos_movimientos'
  and (public.product_detail(test.var('prod')::uuid)) ? 'ultimas_compras');
select test.expect_error('no se puede pedir la ficha de un producto de otra empresa',
  $q$select public.product_detail(
       (select id from public.products where company_id = test.var('c_b')::uuid limit 1))$q$);

reset role;
