-- ============================================================================
-- Verificación de las migraciones 0038 a 0041.
--
-- Para correr en el SQL Editor después de aplicar los cuatro parches. Solo LEE:
-- no escribe nada. Las quince filas deben decir «ok».
--
-- «Sin error al pegar» y «quedó puesto» no son lo mismo: un parche idempotente
-- que se corta a la mitad tampoco da error, y esto es lo que distingue las dos
-- cosas.
-- ============================================================================
-- Verificación de las migraciones 0038 a 0041.
with piezas as (
  -- ── 0038 · niveles tarifarios de Membego
  select '0038 · tabla de niveles' as pieza, 1 as orden,
         (select count(*) from information_schema.tables
           where table_schema='public' and table_name='vehicle_category_levels') as hay, 1 as esperado
  union all select '0038 · función set_vehicle_category_levels', 2,
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='set_vehicle_category_levels'), 1
  union all select '0038 · permiso de borrado en niveles', 3,
         (select case when has_table_privilege('authenticated','public.vehicle_category_levels','DELETE')
                 then 1 else 0 end), 1

  -- ── 0039 · el canje de Membego en la factura
  union all select '0039 · columnas del canje en facturas', 4,
         (select count(*) from information_schema.columns
           where table_name='invoices' and column_name like 'membego_%'), 7
  union all select '0039 · funciones de canje y reversa', 5,
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public'
             and p.proname in ('record_membego_redemption','record_membego_reversal')), 2

  -- ── 0040 · editar y borrar
  union all select '0040 · permiso de borrado en las 11 tablas', 6,
         (select count(*) from (values
            ('services'),('products'),('customers'),('vehicles'),('suppliers'),
            ('promotions'),('equipment'),('bays'),('appointments'),('claims'),('fleets')
          ) as t(n)
          where has_table_privilege('authenticated','public.'||n,'DELETE')), 11
  union all select '0040 · candado de rol en las 11 tablas', 7,
         (select count(*) from pg_policies
           where schemaname='public' and policyname like '%_borrar_solo_admin'
             and cmd='DELETE' and permissive='RESTRICTIVE'
             and tablename <> 'profiles'), 11
  union all select '0040 · is_active en clientes y vehículos', 8,
         (select count(*) from information_schema.columns
           where table_name in ('customers','vehicles') and column_name='is_active'), 2
  union all select '0040 · las 11 claves ajenas en RESTRICT', 9,
         (select count(*) from pg_constraint
           where conname in (
             'invoices_customer_same_company','work_orders_customer_same_company',
             'memberships_customer_same_company','inventory_movements_product_same_company',
             'service_consumptions_product_same_company','redemptions_promotion_same_company',
             'maintenance_equipment_same_company','maintenance_supplier_same_company',
             'work_orders_vehicle_same_company','work_orders_bay_same_company',
             'work_orders_fleet_same_company')
             and confdeltype = 'r'), 11
  union all select '0040 · bitácora de borrados', 10,
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='app' and p.proname='registrar_borrado'), 1

  -- ── 0041 · cancelar órdenes y eliminar empleados
  union all select '0041 · columnas de cancelación en órdenes', 11,
         (select count(*) from information_schema.columns
           where table_name='work_orders'
             and column_name in ('cancel_reason','cancelled_at','cancelled_by')), 3
  union all select '0041 · función cancel_work_order', 12,
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='cancel_work_order'), 1
  union all select '0041 · permiso de borrado en empleados', 13,
         (select case when has_table_privilege('authenticated','public.profiles','DELETE')
                 then 1 else 0 end), 1
  union all select '0041 · candado de rol en empleados', 14,
         (select count(*) from pg_policies
           where schemaname='public' and tablename='profiles'
             and policyname='profiles_borrar_solo_admin'
             and cmd='DELETE' and permissive='RESTRICTIVE'), 1
  union all select '0041 · guardián del borrado de empleados', 15,
         (select count(*) from pg_trigger
           where tgname = 'profiles_frenar_borrado' and not tgisinternal), 1
)
select pieza,
       case when hay = esperado then 'ok'
            else 'FALTA (' || hay || ' de ' || esperado || ')' end as estado
  from piezas order by orden;
