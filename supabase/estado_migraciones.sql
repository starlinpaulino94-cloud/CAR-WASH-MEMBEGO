-- =============================================================================
-- ESTADO DE MIGRACIONES · Ejecutar en el editor SQL de Supabase
-- =============================================================================
-- Responde: ¿cuáles migraciones están aplicadas y cuáles faltan?
--
-- Como los parches se aplicaron a mano, no existía un registro de migraciones.
-- Este script hace dos cosas:
--
--   1. DETECTA el estado real inspeccionando el esquema: para cada migración
--      busca un objeto que solo ella crea (tabla, función, tipo, política o
--      constraint). Si el objeto está, la migración corrió.
--   2. Deja instalado `app.schema_migrations`, el registro que faltaba, y lo
--      siembra con lo detectado. De aquí en adelante cada migración nueva se
--      sella sola y este script deja de adivinar.
--
-- Es de solo lectura sobre tus datos: no toca ninguna tabla del negocio.
-- Puedes ejecutarlo las veces que quieras.
-- =============================================================================

-- ---------------------------------------------------------------- 1. Registro
create schema if not exists app;

create table if not exists app.schema_migrations (
  version     text primary key,          -- 0001, 0002, …
  name        text not null,             -- nombre del archivo de migración
  patch_file  text,                      -- parche equivalente para el editor SQL
  applied_at  timestamptz not null default now(),
  detected    boolean not null default false  -- true = deducido del esquema
);

comment on table app.schema_migrations is
  'Registro de migraciones aplicadas. Las marcadas detected=true se dedujeron '
  'inspeccionando el esquema, no se sellaron al aplicarse.';

-- ------------------------------------------------- 2. Catálogo y detección
with esperadas (version, name, patch_file, kind, obj) as (
  values
    ('0001','foundation',            null,                    'type',   'user_role'),
    ('0002','tenancy_identity',      null,                    'table',  'companies'),
    ('0003','catalog_customers',     null,                    'table',  'services'),
    ('0004','operations',            null,                    'table',  'work_orders'),
    ('0005','cash_billing_fiscal',   null,                    'table',  'invoices'),
    ('0006','audit_log',             null,                    'table',  'audit_logs'),
    ('0007','rls_policies',          null,                    'policy', 'work_orders_select'),
    ('0008','billing_rpc',           null,                    'func',   'create_invoice'),
    ('0009','tenant_composite_fks',  null,                    'constr', 'work_orders_id_company_key'),
    ('0010','orders_rpc',            null,                    'func',   'advance_work_order'),
    ('0011','admin_rpc',             null,                    'func',   'create_expense'),
    ('0012','fiscal_status',         null,                    'func',   'fiscal_status'),
    ('0013','employees_rpc',         null,                    'func',   'create_employee'),
    ('0014','membego_integration',   'membego_0014_0015.sql', 'table',  'membego_company_links'),
    ('0015','membego_sso',           'membego_0014_0015.sql', 'func',   'membego_sso_upsert_user'),
    ('0016','membego_sso_saliente',  'membego_0017_sso_saliente.sql', 'func', 'membego_sso_saliente'),
    ('0019','inventory_movements',   'inventario_0019.sql',   'table',  'inventory_movements'),
    ('0020','suppliers_purchases',   'compras_0020.sql',      'table',  'suppliers'),
    ('0021','service_recipes',       'recetas_0021.sql',      'table',  'service_recipes'),
    ('0022','management_report',     'reportes_0022.sql',     'func',   'management_report'),
    ('0023','inspections',           'inspeccion_0023.sql',   'table',  'vehicle_inspections'),
    ('0024','quality_control',       'calidad_0024.sql',      'table',  'qc_reviews'),
    ('0025','equipment',             'equipos_0025.sql',      'table',  'equipment'),
    ('0026','appointments',          'agenda_0026.sql',       'table',  'appointments'),
    ('0027','claims',                'reclamos_0027.sql',     'table',  'claims'),
    ('0028','customer_credit',       'credito_0028.sql',      'table',  'receivables'),
    ('0029','fleets',                'flotillas_0029.sql',    'table',  'fleets'),
    ('0030','payroll',               'nomina_0030.sql',       'table',  'payroll_periods'),
    ('0031','branches',              'sucursales_0031.sql',   'func',   'upsert_branch'),
    ('0032','promotions',            'promociones_0032.sql',  'table',  'promotions'),
    ('0033','notifications',         'avisos_0033.sql',       'table',  'notifications'),
    ('0034','credit_notes',          'notas_credito_0034.sql','func',   'credit_note_invoice')
),
detectadas as (
  select e.*,
    case e.kind
      when 'table'  then to_regclass('public.' || e.obj) is not null
      when 'type'   then exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                                 where n.nspname = 'app' and t.typname = e.obj)
      when 'func'   then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname = 'public' and p.proname = e.obj)
      when 'policy' then exists (select 1 from pg_policies where policyname = e.obj)
      when 'constr' then exists (select 1 from pg_constraint where conname = e.obj)
    end as presente
  from esperadas e
)
-- Sella en el registro lo que está presente y aún no figuraba.
insert into app.schema_migrations (version, name, patch_file, detected)
select version, name, patch_file, true
from detectadas
where presente
on conflict (version) do nothing;

-- ------------------------------------------------------------- 3. El informe
with esperadas (version, name, patch_file, kind, obj) as (
  values
    ('0001','foundation',            null,                    'type',   'user_role'),
    ('0002','tenancy_identity',      null,                    'table',  'companies'),
    ('0003','catalog_customers',     null,                    'table',  'services'),
    ('0004','operations',            null,                    'table',  'work_orders'),
    ('0005','cash_billing_fiscal',   null,                    'table',  'invoices'),
    ('0006','audit_log',             null,                    'table',  'audit_logs'),
    ('0007','rls_policies',          null,                    'policy', 'work_orders_select'),
    ('0008','billing_rpc',           null,                    'func',   'create_invoice'),
    ('0009','tenant_composite_fks',  null,                    'constr', 'work_orders_id_company_key'),
    ('0010','orders_rpc',            null,                    'func',   'advance_work_order'),
    ('0011','admin_rpc',             null,                    'func',   'create_expense'),
    ('0012','fiscal_status',         null,                    'func',   'fiscal_status'),
    ('0013','employees_rpc',         null,                    'func',   'create_employee'),
    ('0014','membego_integration',   'membego_0014_0015.sql', 'table',  'membego_company_links'),
    ('0015','membego_sso',           'membego_0014_0015.sql', 'func',   'membego_sso_upsert_user'),
    ('0016','membego_sso_saliente',  'membego_0017_sso_saliente.sql', 'func', 'membego_sso_saliente'),
    ('0019','inventory_movements',   'inventario_0019.sql',   'table',  'inventory_movements'),
    ('0020','suppliers_purchases',   'compras_0020.sql',      'table',  'suppliers'),
    ('0021','service_recipes',       'recetas_0021.sql',      'table',  'service_recipes'),
    ('0022','management_report',     'reportes_0022.sql',     'func',   'management_report'),
    ('0023','inspections',           'inspeccion_0023.sql',   'table',  'vehicle_inspections'),
    ('0024','quality_control',       'calidad_0024.sql',      'table',  'qc_reviews'),
    ('0025','equipment',             'equipos_0025.sql',      'table',  'equipment'),
    ('0026','appointments',          'agenda_0026.sql',       'table',  'appointments'),
    ('0027','claims',                'reclamos_0027.sql',     'table',  'claims'),
    ('0028','customer_credit',       'credito_0028.sql',      'table',  'receivables'),
    ('0029','fleets',                'flotillas_0029.sql',    'table',  'fleets'),
    ('0030','payroll',               'nomina_0030.sql',       'table',  'payroll_periods'),
    ('0031','branches',              'sucursales_0031.sql',   'func',   'upsert_branch'),
    ('0032','promotions',            'promociones_0032.sql',  'table',  'promotions'),
    ('0033','notifications',         'avisos_0033.sql',       'table',  'notifications'),
    ('0034','credit_notes',          'notas_credito_0034.sql','func',   'credit_note_invoice')
),
detectadas as (
  select e.*,
    case e.kind
      when 'table'  then to_regclass('public.' || e.obj) is not null
      when 'type'   then exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                                 where n.nspname = 'app' and t.typname = e.obj)
      when 'func'   then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname = 'public' and p.proname = e.obj)
      when 'policy' then exists (select 1 from pg_policies where policyname = e.obj)
      when 'constr' then exists (select 1 from pg_constraint where conname = e.obj)
    end as presente
  from esperadas e
)
select
  version                                  as "Nº",
  name                                     as "Migración",
  case when presente then '✅ aplicada' else '❌ FALTA' end as "Estado",
  coalesce(patch_file, '(esquema base)')   as "Parche a ejecutar si falta"
from detectadas
order by version;
