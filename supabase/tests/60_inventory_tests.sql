-- =============================================================================
-- Pruebas del inventario real (migración 0019): movimientos, guard y ajustes
-- =============================================================================
-- Continúa sobre los datos de 10_rls (empresas Alfa/Beta) y 20_billing (el
-- producto 'prod' de Alfa ya vendió y anuló: debe tener kardex).
-- =============================================================================

-- ---- La venta y la anulación de 20_billing dejaron movimientos clasificados.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.check('la venta quedó en el kardex como movimiento «venta» con su factura',
  (select count(*) > 0 from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'venta' and invoice_id is not null));

select test.check('la anulación quedó como «devolucion» apuntando a la nota de crédito',
  (select count(*) > 0 from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'devolucion'
      and invoice_id = test.var('nc1')::uuid));

select test.check('cada movimiento cuadra: después = antes + cambio',
  (select count(*) = 0 from public.inventory_movements
    where qty_after <> qty_before + qty_change));

select test.check('el alta del producto registró la existencia inicial como «entrada»',
  (select count(*) = 1 from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'entrada' and qty_before = 0 and qty_after = 40));

-- ---- La existencia YA NO se edita directamente: el guard lo rechaza.
select test.expect_error('editar la existencia directamente está bloqueado (use adjust_stock)',
  format($q$update public.products set stock = 999 where id = %L$q$, test.var('prod')));

-- ---- adjust_stock: el cajero no puede ajustar a mano.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero no puede ajustar inventario a mano',
  format($q$select public.adjust_stock(%L::uuid, 10, 'conteo físico de prueba')$q$, test.var('prod')));

-- ---- adjust_stock: el propietario sí, y todo queda registrado.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.set_var('stock_antes',
  (select stock::text from public.products where id = test.var('prod')::uuid));

select test.check('el propietario ajusta con motivo y la existencia cambia',
  (public.adjust_stock(test.var('prod')::uuid, 37, 'Conteo físico: diferencia de almacén')).stock = 37);

select test.check('el ajuste quedó en el kardex con antes/después y motivo',
  (select count(*) = 1 from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'ajuste'
      and qty_before = test.var('stock_antes')::integer and qty_after = 37
      and reason = 'Conteo físico: diferencia de almacén'));

select test.check('el ajuste quedó en la bitácora de auditoría',
  (select count(*) >= 1 from public.audit_logs
    where action = 'AJUSTAR_INVENTARIO' and entity_id = test.var('prod')));

select test.check('ajustar a la misma cantidad no genera movimiento vacío',
  ((public.adjust_stock(test.var('prod')::uuid, 37, 'sin cambios reales')).stock = 37)
  and (select count(*) = 1 from public.inventory_movements
        where product_id = test.var('prod')::uuid and kind = 'ajuste'));

-- ---- El motivo es OPCIONAL. El registro NO.
--
-- Antes se exigían cinco caracteres. La longitud nunca midió la calidad de
-- nada —«xxxxx» pasaba el filtro— y sí impedía corregir la existencia: quien
-- acaba de contar la nevera y ve 24 donde el sistema dice 1 se quedaba sin
-- poder ajustarla hasta redactar una frase. Lo que se protege aquí es lo que
-- de verdad hace auditable un ajuste, que nunca fue el motivo: el antes, el
-- después, el autor y la hora.
select test.check('un ajuste SIN motivo se acepta',
  (public.adjust_stock(test.var('prod')::uuid, 41)).stock = 41);

select test.check('y queda en el kardex con antes, después y AUTOR, aunque no haya motivo',
  (select count(*) = 1 from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'ajuste'
      and qty_before = 37 and qty_after = 41
      and reason is null
      and created_by = test.var('u_owner_a')::uuid));

-- Nulo y no una cadena inventada: el kardex tiene que poder distinguir «no se
-- dijo nada» de «se dijo esto».
select test.check('la bitácora dice que no se indicó motivo, en vez de callarlo',
  (select count(*) = 1 from public.audit_logs
    where action = 'AJUSTAR_INVENTARIO' and entity_id = test.var('prod')
      and details like '%sin motivo indicado%'));

select test.check('un motivo corto ya no se rechaza: se guarda tal cual',
  (public.adjust_stock(test.var('prod')::uuid, 42, 'ok')).stock = 42);

select test.check('y el motivo corto queda literal en el kardex',
  (select reason from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'ajuste'
    order by id desc limit 1) = 'ok');

-- Los espacios en blanco no son un motivo: cuentan como no haber dicho nada.
--
-- El ajuste y la comprobación van en DOS sentencias a propósito. Metidos en un
-- `and`, SQL no garantiza en qué orden evalúa los dos lados: la subconsulta
-- puede correr antes que el ajuste y leer el movimiento ANTERIOR. Esta prueba
-- ya falló así una vez, y el fallo no era del código sino de la prueba.
select test.check('un ajuste con un motivo de solo espacios se acepta',
  (public.adjust_stock(test.var('prod')::uuid, 43, '   ')).stock = 43);

select test.check('y ese motivo se guarda como nulo, no como «   »',
  (select reason is null from public.inventory_movements
    where product_id = test.var('prod')::uuid and kind = 'ajuste'
    order by id desc limit 1));

-- El rol NO se relajó: quitar la fricción de escribir una frase no es abrir el
-- inventario a cualquiera. (El caso del cajero se comprueba más arriba, con
-- motivo; aquí se comprueba que tampoco pasa SIN él, que es la puerta nueva.)
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
select test.expect_error('un cajero sigue sin poder ajustar, tampoco sin motivo',
  format($q$select public.adjust_stock(%L::uuid, 99)$q$, test.var('prod')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ---- Aislamiento: Beta no ve el kardex de Alfa ni puede ajustarlo.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('otro car wash no ve los movimientos de inventario ajenos',
  (select count(*) = 0 from public.inventory_movements
    where product_id = test.var('prod')::uuid));

select test.expect_error('otro car wash no puede ajustar un producto ajeno',
  format($q$select public.adjust_stock(%L::uuid, 5, 'intento de otra empresa')$q$, test.var('prod')));

reset role;
