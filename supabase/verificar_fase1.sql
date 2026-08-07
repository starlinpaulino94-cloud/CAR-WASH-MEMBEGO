-- =============================================================================
-- VERIFICACIÓN de la Fase 1 · Ejecutar en el editor SQL de Supabase
-- =============================================================================
-- No cambia nada: solo comprueba que los 4 parches quedaron aplicados.
-- Debe devolver 12 filas, TODAS con estado ✅.
-- =============================================================================

select 'Tabla: kardex de inventario' as pieza,
       case when to_regclass('public.inventory_movements') is not null then '✅' else '❌ falta 0019' end as estado
union all
select 'Tabla: proveedores',
       case when to_regclass('public.suppliers') is not null then '✅' else '❌ falta 0020' end
union all
select 'Tabla: compras',
       case when to_regclass('public.purchases') is not null then '✅' else '❌ falta 0020' end
union all
select 'Tabla: abonos a proveedores',
       case when to_regclass('public.supplier_payments') is not null then '✅' else '❌ falta 0020' end
union all
select 'Tabla: recetas de servicios',
       case when to_regclass('public.service_recipes') is not null then '✅' else '❌ falta 0021' end
union all
select 'Tabla: consumos registrados',
       case when to_regclass('public.service_consumptions') is not null then '✅' else '❌ falta 0021' end
union all
select 'Columna: products.stock_frac',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='products' and column_name='stock_frac')
            then '✅' else '❌ falta 0021' end
union all
select 'Guardia: la existencia no se edita a mano',
       case when exists (select 1 from pg_trigger where tgname='products_stock_guard')
            then '✅' else '❌ falta 0019' end
union all
select 'Función: adjust_stock (ajuste con motivo)',
       case when exists (select 1 from pg_proc where proname='adjust_stock') then '✅' else '❌ falta 0019' end
union all
select 'Función: register_purchase (registrar compra)',
       case when exists (select 1 from pg_proc where proname='register_purchase') then '✅' else '❌ falta 0020' end
union all
select 'Función: pay_supplier (abonar)',
       case when exists (select 1 from pg_proc where proname='pay_supplier') then '✅' else '❌ falta 0020' end
union all
select 'Función: management_report (reportes)',
       case when exists (select 1 from pg_proc where proname='management_report') then '✅' else '❌ falta 0022' end
order by 1;
