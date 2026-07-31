-- =============================================================================
-- MEMBEGO CAR WASH — Esquema completo para el editor SQL de Supabase
-- =============================================================================
-- Reúne las migraciones de supabase/migrations/ EN ORDEN. Pega todo en el editor
-- SQL de Supabase (proyecto nuevo/vacío) y pulsa Run. No incluye el shim de auth.
-- Después: bootstrap y, opcional, seed de catálogo. Verificado contra PostgreSQL 16.
-- =============================================================================



-- #############################################################################
-- ###  20260729000100_foundation.sql
-- #############################################################################

-- =============================================================================
-- 0001 · Cimientos: extensiones, esquema privado, enumeraciones y utilidades
-- =============================================================================
-- Traduce los tipos de src/types/index.ts a tipos de PostgreSQL.
--
-- Decisiones que la auditoría marcó como innegociables desde la primera línea
-- (sección 20, corto plazo) y que quedan fijadas aquí:
--
--   * El dinero NUNCA es coma flotante. Todos los importes son BIGINT en la
--     unidad menor (centavos). El modelo anterior usaba `number` de JavaScript
--     y acumulaba deriva imposible de reconciliar contra el conteo físico.
--   * Toda tabla de negocio lleva company_id y queda bajo RLS (ver 0007).
--   * Los identificadores son UUID generados por la base de datos, no cadenas
--     derivadas de Date.now() que colisionan en el mismo milisegundo.
-- =============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists pg_trgm;       -- búsqueda por placa y nombre

-- Esquema privado para funciones auxiliares. No se expone vía PostgREST.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------- Enumeraciones

create type app.user_role as enum (
  'propietario', 'administrador', 'supervisor', 'cajero',
  'recepcionista', 'operario', 'contador', 'superadmin'
);

create type app.vehicle_category as enum (
  'sedan', 'suv', 'jeep', 'pickup', 'van', 'truck', 'motorcycle', 'special'
);

create type app.order_status as enum (
  'pendiente', 'en_espera', 'asignada', 'en_proceso',
  'control_calidad', 'listo', 'entregado', 'cancelado'
);

create type app.payment_status as enum ('pendiente', 'pagado', 'parcial', 'reembolsado');

create type app.payment_method as enum (
  'efectivo', 'tarjeta', 'transferencia', 'pago_movil',
  'membego_beneficio', 'credito', 'cortesia', 'mixto'
);

create type app.benefit_status as enum (
  'validado', 'reservado', 'en_proceso', 'consumido', 'cancelado'
);

create type app.membego_status as enum ('active', 'inactive', 'none');

create type app.bay_type as enum ('prelavado', 'lavado', 'aspirado', 'secado', 'detallado', 'qc');
create type app.bay_status as enum ('disponible', 'ocupada', 'mantenimiento', 'limpieza');

create type app.item_type as enum ('service', 'package', 'product');

create type app.expense_category as enum (
  'quimicos_insumos', 'servicios_publicos', 'mantenimiento_equipos',
  'nomina_extras', 'varios'
);

create type app.cash_session_status as enum ('open', 'closed');
create type app.cash_movement_type as enum ('inflow', 'outflow');
create type app.printer_width as enum ('58mm', '80mm', 'letter');
create type app.fuel_level as enum ('reserva', '1/4', '1/2', '3/4', 'lleno');

-- Tipos de Comprobante Fiscal (DGII, República Dominicana).
-- B01 crédito fiscal · B02 consumidor final · B04 nota de crédito
-- B14 régimen especial · B15 gubernamental
create type app.ncf_type as enum ('B01', 'B02', 'B04', 'B14', 'B15');

-- ---------------------------------------------------------------- Utilidades

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function app.touch_updated_at is
  'Trigger BEFORE UPDATE: mantiene updated_at. Necesario para concurrencia optimista.';


-- #############################################################################
-- ###  20260729000200_tenancy_identity.sql
-- #############################################################################

-- =============================================================================
-- 0002 · Multi-tenancy e identidad
-- =============================================================================
-- Resuelve los riesgos C2 (sin autenticación) y C10 (aislamiento multi-tenant
-- inexistente) de la auditoría.
--
-- En la aplicación auditada, company_id y branch_id existían en todos los tipos
-- pero NINGUNA consulta los usaba: cambiar de sucursal solo cambiaba una
-- etiqueta. Aquí el aislamiento pasa a ser una invariante de la base de datos,
-- no una convención que el código de la interfaz pueda olvidar.
-- =============================================================================

-- ---------------------------------------------------------------- Empresas

create table public.companies (
  id                    uuid primary key default gen_random_uuid(),
  trade_name            text        not null check (length(trim(trade_name)) > 0),
  legal_name            text        not null,
  tax_id                text        not null,
  logo_url              text,
  currency              char(3)     not null default 'DOP',
  currency_symbol       text        not null default 'RD$',
  timezone              text        not null default 'America/Santo_Domingo',
  -- Puntos base: 1800 = 18,00%. Entero, para no arrastrar coma flotante al ITBIS.
  tax_rate_bps          integer     not null default 1800 check (tax_rate_bps between 0 and 10000),
  allow_guest_checkout  boolean     not null default true,
  thermal_printer_width app.printer_width not null default '80mm',
  header_note           text,
  footer_note           text,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tax_id)
);

create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- Sucursales

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  address     text,
  phone       text,
  is_main     boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index branches_company_idx on public.branches (company_id);

-- Una sola sucursal principal por empresa.
create unique index branches_one_main_per_company
  on public.branches (company_id) where is_main;

create trigger branches_touch before update on public.branches
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- Perfiles

-- Extiende auth.users de Supabase con la pertenencia al tenant y el rol.
--
-- IMPORTANTE (escalada de privilegios): el perfil NO se crea con el company_id
-- que venga en los metadatos del registro. Ese valor lo controla quien se
-- registra, así que aceptarlo permitiría a cualquiera unirse al tenant ajeno
-- escribiendo su UUID. El perfil nace SIN empresa y sin acceso a nada; un
-- administrador debe asignarlo. Fallo cerrado por defecto.
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  company_id       uuid references public.companies(id) on delete restrict,
  branch_id        uuid references public.branches(id) on delete set null,
  full_name        text not null default '',
  email            text,
  phone            text,
  role             app.user_role,
  avatar_url       text,
  -- Hash del PIN de caja. NUNCA el PIN en claro: en la app auditada el campo
  -- pinCode existía sembrado con '1234' y no se verificaba en ninguna parte.
  cash_pin_hash    text,
  commission_bps   integer check (commission_bps between 0 and 10000),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Un perfil operativo necesita empresa y rol, o ninguno de los dos.
  constraint profiles_tenant_complete check (
    (company_id is null and role is null) or (company_id is not null and role is not null)
  )
);

create index profiles_company_idx on public.profiles (company_id);
create index profiles_branch_idx  on public.profiles (branch_id);

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- La sucursal asignada debe pertenecer a la empresa del perfil.
create or replace function app.check_profile_branch()
returns trigger
language plpgsql
as $$
begin
  if new.branch_id is not null then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id and b.company_id = new.company_id
    ) then
      raise exception 'La sucursal % no pertenece a la empresa %', new.branch_id, new.company_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_branch_belongs_to_company
  before insert or update of branch_id, company_id on public.profiles
  for each row execute function app.check_profile_branch();

-- Alta automática del perfil al registrarse, sin tenant ni rol.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ------------------------------------------------- Helpers de contexto (RLS)

-- SECURITY DEFINER a propósito: estas funciones leen public.profiles saltándose
-- RLS. Sin eso, una política sobre profiles que consultase profiles entraría en
-- recursión infinita. STABLE permite a PostgreSQL evaluarlas una vez por
-- sentencia en lugar de una vez por fila.

create or replace function app.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id
  from public.profiles
  where id = auth.uid() and is_active
$$;

create or replace function app.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select branch_id
  from public.profiles
  where id = auth.uid() and is_active
$$;

create or replace function app.current_role()
returns app.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.profiles
  where id = auth.uid() and is_active
$$;

-- ¿El usuario actual tiene alguno de estos roles?
create or replace function app.has_role(variadic roles app.user_role[])
returns boolean
language sql
stable
as $$
  select app.current_role() = any(roles)
$$;

-- Pertenencia al tenant. Si el perfil aún no tiene empresa asignada devuelve
-- false para TODO: un usuario recién registrado no ve absolutamente nada.
create or replace function app.belongs_to_tenant(target_company uuid)
returns boolean
language sql
stable
as $$
  select target_company is not null
     and target_company = app.current_company_id()
$$;

comment on function app.belongs_to_tenant is
  'Predicado base de todas las políticas RLS. Fallo cerrado: sin empresa asignada, sin acceso.';


-- #############################################################################
-- ###  20260729000300_catalog_customers.sql
-- #############################################################################

-- =============================================================================
-- 0003 · Catálogo, clientes y vehículos
-- =============================================================================

-- ---------------------------------------------------------------- Servicios

create table public.services (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  code                 text not null,
  name                 text not null check (length(trim(name)) > 0),
  description          text not null default '',
  category             text not null default '',
  estimated_minutes    integer not null default 30 check (estimated_minutes > 0),
  commission_bps       integer not null default 0 check (commission_bps between 0 and 10000),
  requires_inspection  boolean not null default false,
  included_in_membego  boolean not null default false,
  is_popular           boolean not null default false,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, code)
);

create index services_company_active_idx on public.services (company_id) where is_active;

create trigger services_touch before update on public.services
  for each row execute function app.touch_updated_at();

-- Matriz de precios normalizada.
--
-- En el modelo auditado esto era un objeto plano de 8 claves (ServicePriceByVehicle),
-- así que añadir una categoría de vehículo obligaba a migrar el tipo. Como tabla,
-- una categoría nueva es una fila.
create table public.service_prices (
  service_id       uuid not null references public.services(id) on delete cascade,
  vehicle_category app.vehicle_category not null,
  price_cents      bigint not null check (price_cents >= 0),
  primary key (service_id, vehicle_category)
);

-- ---------------------------------------------------------------- Productos

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  code         text not null,
  barcode      text,
  name         text not null check (length(trim(name)) > 0),
  category     text not null default '',
  cost_cents   bigint not null default 0 check (cost_cents >= 0),
  price_cents  bigint not null default 0 check (price_cents >= 0),
  -- El stock puede ser negativo de forma transitoria si se vende sin registrar
  -- entrada; se permite para no bloquear la operación, pero queda visible.
  stock        integer not null default 0,
  min_stock    integer not null default 0 check (min_stock >= 0),
  unit         text not null default 'Unidad',
  is_for_sale  boolean not null default true,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, code)
);

create index products_company_idx on public.products (company_id);
create index products_low_stock_idx on public.products (company_id)
  where is_active and stock <= min_stock;

create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- Bahías

create table public.bays (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  branch_id              uuid not null references public.branches(id) on delete cascade,
  name                   text not null,
  type                   app.bay_type not null default 'lavado',
  status                 app.bay_status not null default 'disponible',
  current_work_order_id  uuid,   -- FK diferida: work_orders se crea en 0004
  assigned_profile_id    uuid references public.profiles(id) on delete set null,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (branch_id, name)
);

create index bays_branch_idx on public.bays (branch_id);

create trigger bays_touch before update on public.bays
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- Clientes

create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  branch_id            uuid references public.branches(id) on delete set null,
  name                 text not null check (length(trim(name)) > 0),
  phone                text,
  email                text,
  tax_id               text,
  address              text,
  notes                text,
  is_anonymous_guest   boolean not null default false,
  membego_customer_id  text,
  membego_status       app.membego_status not null default 'none',
  membego_tier         text,
  -- Contadores derivados. Se mantienen por trigger (0004) para no recalcular
  -- agregados sobre todo el histórico en cada pantalla, que es lo que hacía
  -- el dashboard auditado.
  total_visits         integer not null default 0 check (total_visits >= 0),
  total_spent_cents    bigint  not null default 0 check (total_spent_cents >= 0),
  last_visit_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index customers_company_idx on public.customers (company_id);
create index customers_name_trgm    on public.customers using gin (name gin_trgm_ops);
create index customers_phone_idx    on public.customers (company_id, phone) where phone is not null;

-- El identificador de Membego es único dentro de la empresa cuando existe.
create unique index customers_membego_unique
  on public.customers (company_id, membego_customer_id)
  where membego_customer_id is not null;

create trigger customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- Vehículos

create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  customer_id   uuid references public.customers(id) on delete set null,
  plate         text not null check (length(trim(plate)) > 0),
  make          text not null default '',
  model         text not null default '',
  year          integer check (year between 1900 and 2200),
  color         text not null default '',
  category      app.vehicle_category not null default 'sedan',
  notes         text,
  last_visit_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Una placa identifica un vehículo dentro de la empresa. En el modelo
  -- auditado nada lo impedía y cada llegada podía duplicar el registro.
  unique (company_id, plate)
);

create index vehicles_customer_idx on public.vehicles (customer_id);
create index vehicles_plate_trgm   on public.vehicles using gin (plate gin_trgm_ops);

create trigger vehicles_touch before update on public.vehicles
  for each row execute function app.touch_updated_at();

-- Normaliza la placa: sin espacios ni guiones y en mayúsculas, para que la
-- restricción de unicidad no se pueda esquivar escribiéndola distinto.
create or replace function app.normalize_plate()
returns trigger
language plpgsql
as $$
begin
  new.plate = upper(regexp_replace(new.plate, '[^A-Za-z0-9]', '', 'g'));
  return new;
end;
$$;

create trigger vehicles_normalize_plate
  before insert or update of plate on public.vehicles
  for each row execute function app.normalize_plate();


-- #############################################################################
-- ###  20260729000400_operations.sql
-- #############################################################################

-- =============================================================================
-- 0004 · Órdenes de trabajo
-- =============================================================================
-- Resuelve los riesgos I1/I2 (colisión de números de orden e identificadores)
-- e I12 (fórmula de impuestos divergente) de la auditoría.
-- =============================================================================

-- -------------------------------------------------- Numeración de documentos

-- Contador transaccional y correlativo. Sustituye a
-- `Math.floor(1000 + Math.random() * 9000)`, que sobre 9.000 valores posibles
-- tenía un 50% de probabilidad de colisión a las ~112 órdenes: un día y medio.
create table public.document_counters (
  company_id uuid   not null references public.companies(id) on delete cascade,
  scope      text   not null,
  period     text   not null default 'ALL',
  next_value bigint not null default 1 check (next_value > 0),
  primary key (company_id, scope, period)
);

create or replace function app.next_document_number(
  p_company uuid,
  p_scope   text,
  p_period  text default 'ALL'
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value bigint;
begin
  insert into public.document_counters (company_id, scope, period)
  values (p_company, p_scope, p_period)
  on conflict (company_id, scope, period) do nothing;

  -- El UPDATE toma un bloqueo de fila: dos cajeros simultáneos se serializan
  -- y ninguno puede obtener el mismo número.
  update public.document_counters
     set next_value = next_value + 1
   where company_id = p_company and scope = p_scope and period = p_period
  returning next_value - 1 into v_value;

  if v_value is null then
    raise exception 'No se pudo asignar número de documento (%/%/%)', p_company, p_scope, p_period;
  end if;
  return v_value;
end;
$$;

comment on function app.next_document_number is
  'Asigna números correlativos y sin huecos. Serializa por bloqueo de fila.';

-- ---------------------------------------------------------------- Órdenes

create table public.work_orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  branch_id             uuid not null references public.branches(id) on delete restrict,
  order_number          text not null,

  customer_id           uuid references public.customers(id) on delete set null,
  customer_name         text not null,
  customer_phone        text,

  vehicle_id            uuid references public.vehicles(id) on delete set null,
  vehicle_plate         text not null,
  vehicle_make_model    text not null default '',
  vehicle_category      app.vehicle_category not null default 'sedan',
  vehicle_color         text not null default '',

  status                app.order_status  not null default 'pendiente',
  priority              text not null default 'normal'
                          check (priority in ('normal', 'alta', 'vip_membego')),
  bay_id                uuid references public.bays(id) on delete set null,

  -- Importes derivados de work_order_items por trigger. No los fija el cliente:
  -- en la aplicación auditada los calculaba el navegador con tres fórmulas
  -- distintas en tres archivos distintos.
  subtotal_cents        bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents        bigint not null default 0 check (discount_cents >= 0),
  membego_benefit_cents bigint not null default 0 check (membego_benefit_cents >= 0),
  tax_cents             bigint not null default 0 check (tax_cents >= 0),
  total_cents           bigint not null default 0 check (total_cents >= 0),

  payment_status        app.payment_status not null default 'pendiente',
  payment_method        app.payment_method,

  membego_customer_id   text,
  membego_membership_id text,
  membego_benefit_id    text,
  membego_redemption_id text,
  benefit_status        app.benefit_status,

  arrival_at            timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  delivered_at          timestamptz,
  estimated_ready_at    timestamptz,

  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (company_id, order_number)
);

create index work_orders_branch_status_idx on public.work_orders (branch_id, status);
create index work_orders_arrival_idx       on public.work_orders (company_id, arrival_at desc);
create index work_orders_customer_idx      on public.work_orders (customer_id);
create index work_orders_plate_trgm        on public.work_orders using gin (vehicle_plate gin_trgm_ops);
-- La cola activa es la consulta más caliente del sistema (Kanban y badge lateral).
create index work_orders_active_queue_idx  on public.work_orders (branch_id, status, arrival_at)
  where status not in ('entregado', 'cancelado');

create trigger work_orders_touch before update on public.work_orders
  for each row execute function app.touch_updated_at();

-- Ahora que existe work_orders, se cierra la referencia pendiente de bays.
alter table public.bays
  add constraint bays_current_work_order_fk
  foreign key (current_work_order_id) references public.work_orders(id) on delete set null;

-- ---------------------------------------------------------------- Líneas

create table public.work_order_items (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references public.work_orders(id) on delete cascade,
  item_type           app.item_type not null,
  service_id          uuid references public.services(id) on delete restrict,
  product_id          uuid references public.products(id) on delete restrict,
  name                text not null,
  quantity            integer not null default 1 check (quantity > 0),
  unit_price_cents    bigint  not null check (unit_price_cents >= 0),
  discount_cents      bigint  not null default 0 check (discount_cents >= 0),
  is_membego_covered  boolean not null default false,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),

  -- Una línea apunta al catálogo que le corresponde y solo a ese.
  constraint work_order_items_ref_matches_type check (
    (item_type = 'product' and product_id is not null and service_id is null) or
    (item_type in ('service', 'package') and product_id is null)
  ),
  -- El descuento no puede superar el importe de la línea.
  constraint work_order_items_discount_within_line
    check (discount_cents <= unit_price_cents * quantity)
);

create index work_order_items_order_idx on public.work_order_items (work_order_id);

-- ------------------------------------------------- Recálculo de totales

-- ÚNICA implementación de la fórmula fiscal en todo el sistema.
-- La auditoría encontró tres versiones distintas y divergentes: una orden con
-- beneficio Membego producía un ITBIS diferente al de su propia factura.
create or replace function app.recalc_work_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_membego  bigint;
  v_taxable  bigint;
  v_rate_bps integer;
  v_tax      bigint;
begin
  select
    coalesce(sum(unit_price_cents * quantity), 0),
    coalesce(sum(case when is_membego_covered then 0 else discount_cents end), 0),
    coalesce(sum(case when is_membego_covered then unit_price_cents * quantity else 0 end), 0)
  into v_subtotal, v_discount, v_membego
  from public.work_order_items
  where work_order_id = p_order_id;

  select c.tax_rate_bps into v_rate_bps
  from public.work_orders o
  join public.companies c on c.id = o.company_id
  where o.id = p_order_id;

  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  -- Redondeo al centavo, no al peso entero como hacía Math.round() sobre pesos.
  v_tax := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;

  update public.work_orders
     set subtotal_cents        = v_subtotal,
         discount_cents        = v_discount,
         membego_benefit_cents = v_membego,
         tax_cents             = v_tax,
         total_cents           = v_taxable + v_tax
   where id = p_order_id;
end;
$$;

create or replace function app.work_order_items_changed()
returns trigger
language plpgsql
as $$
begin
  perform app.recalc_work_order_totals(coalesce(new.work_order_id, old.work_order_id));
  return null;
end;
$$;

create trigger work_order_items_recalc
  after insert or update or delete on public.work_order_items
  for each row execute function app.work_order_items_changed();

-- ------------------------------------------------- Numeración automática

create or replace function app.assign_order_number()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'CW-' || v_year || '-' ||
      lpad(app.next_document_number(new.company_id, 'work_order', v_year)::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger work_orders_number
  before insert on public.work_orders
  for each row execute function app.assign_order_number();

-- ------------------------------------------------- Coherencia de estados

create or replace function app.work_order_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'en_proceso' and new.started_at is null then
      new.started_at := now();
    elsif new.status in ('listo', 'control_calidad') and new.finished_at is null then
      new.finished_at := now();
    elsif new.status = 'entregado' then
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  end if;
  return new;
end;
$$;

create trigger work_orders_status_timestamps
  before update of status on public.work_orders
  for each row execute function app.work_order_status_timestamps();

-- Contadores del cliente al entregar. Evita recalcular agregados sobre todo el
-- histórico en cada render, que es lo que hacía el dashboard auditado.
create or replace function app.bump_customer_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado'
     and new.customer_id is not null then
    update public.customers
       set total_visits      = total_visits + 1,
           total_spent_cents = total_spent_cents + new.total_cents,
           last_visit_at     = now()
     where id = new.customer_id;

    update public.vehicles
       set last_visit_at = now()
     where id = new.vehicle_id;
  end if;
  return new;
end;
$$;

create trigger work_orders_customer_stats
  after update of status on public.work_orders
  for each row execute function app.bump_customer_stats();


-- #############################################################################
-- ###  20260729000500_cash_billing_fiscal.sql
-- #############################################################################

-- =============================================================================
-- 0005 · Caja, facturación y comprobantes fiscales
-- =============================================================================
-- Resuelve C6 (numeración fiscal aleatoria y sin NCF), C9 (la anulación no
-- revertía caja ni inventario) e I13 (el histórico de sesiones de caja se
-- destruía al abrir la siguiente).
-- =============================================================================

-- ---------------------------------------------------------------- Caja

create table public.cash_sessions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  branch_id             uuid not null references public.branches(id) on delete restrict,
  cashier_id            uuid not null references public.profiles(id) on delete restrict,
  opened_at             timestamptz not null default now(),
  closed_at             timestamptz,
  initial_amount_cents  bigint not null check (initial_amount_cents >= 0),

  -- Totales derivados de cash_movements por trigger.
  total_cash_sales_cents      bigint not null default 0,
  total_card_sales_cents      bigint not null default 0,
  total_transfer_sales_cents  bigint not null default 0,
  total_membego_cents         bigint not null default 0,
  total_inflows_cents         bigint not null default 0,
  total_outflows_cents        bigint not null default 0,

  -- Puede ser negativo: un descuadre real debe verse, no taparse. La aplicación
  -- auditada hacía Math.max(0, ...) al registrar gastos, lo que falseaba el
  -- arqueo en silencio.
  expected_cash_cents   bigint not null default 0,
  counted_cash_cents    bigint,
  difference_cents      bigint,

  status                app.cash_session_status not null default 'open',
  opening_notes         text,
  closing_notes         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint cash_sessions_closed_is_complete check (
    (status = 'open'   and closed_at is null and counted_cash_cents is null) or
    (status = 'closed' and closed_at is not null and counted_cash_cents is not null)
  )
);

create index cash_sessions_branch_idx on public.cash_sessions (branch_id, opened_at desc);

-- Una sola caja abierta por sucursal. El modelo auditado guardaba UNA sesión
-- global y la sobrescribía al abrir la siguiente, destruyendo el arqueo anterior
-- (documento de control primario de un negocio de efectivo).
create unique index cash_sessions_one_open_per_branch
  on public.cash_sessions (branch_id) where status = 'open';

create trigger cash_sessions_touch before update on public.cash_sessions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------- Movimientos de efectivo

-- Única fuente de verdad del flujo de caja. En el modelo auditado el tipo
-- CashMovement existía y no se instanciaba nunca, y total_inflows jamás se
-- incrementaba.
create table public.cash_movements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  cash_session_id  uuid not null references public.cash_sessions(id) on delete restrict,
  type             app.cash_movement_type not null,
  method           app.payment_method not null default 'efectivo',
  amount_cents     bigint not null check (amount_cents > 0),
  reason           text not null,
  invoice_id       uuid,   -- FK diferida hasta crear invoices
  expense_id       uuid,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index cash_movements_session_idx on public.cash_movements (cash_session_id);

-- Recalcula los totales de la sesión a partir de sus movimientos.
create or replace function app.recalc_cash_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cash_in  bigint;
  v_card     bigint;
  v_transfer bigint;
  v_membego  bigint;
  v_inflows  bigint;
  v_outflows bigint;
  v_initial  bigint;
begin
  select
    coalesce(sum(case when type='inflow'  and method='efectivo'          then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'  and method='tarjeta'           then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'  and method='transferencia'     then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'  and method='membego_beneficio' then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'                                 then amount_cents else 0 end), 0),
    coalesce(sum(case when type='outflow'                                then amount_cents else 0 end), 0)
  into v_cash_in, v_card, v_transfer, v_membego, v_inflows, v_outflows
  from public.cash_movements
  where cash_session_id = p_session_id;

  select initial_amount_cents into v_initial
  from public.cash_sessions where id = p_session_id;

  update public.cash_sessions
     set total_cash_sales_cents     = v_cash_in,
         total_card_sales_cents     = v_card,
         total_transfer_sales_cents = v_transfer,
         total_membego_cents        = v_membego,
         total_inflows_cents        = v_inflows,
         total_outflows_cents       = v_outflows,
         -- Solo el efectivo afecta a lo que debe haber físicamente en la gaveta.
         expected_cash_cents        = v_initial + v_cash_in
                                      - coalesce((select sum(amount_cents)
                                                    from public.cash_movements
                                                   where cash_session_id = p_session_id
                                                     and type = 'outflow'
                                                     and method = 'efectivo'), 0)
   where id = p_session_id;
end;
$$;

create or replace function app.cash_movements_changed()
returns trigger
language plpgsql
as $$
begin
  perform app.recalc_cash_session(coalesce(new.cash_session_id, old.cash_session_id));
  return null;
end;
$$;

create trigger cash_movements_recalc
  after insert or update or delete on public.cash_movements
  for each row execute function app.cash_movements_changed();

-- No se registran movimientos contra una caja ya cerrada.
create or replace function app.guard_closed_cash_session()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.cash_sessions
              where id = new.cash_session_id and status = 'closed') then
    raise exception 'La sesión de caja % está cerrada: no admite movimientos', new.cash_session_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cash_movements_guard_closed
  before insert on public.cash_movements
  for each row execute function app.guard_closed_cash_session();

-- ------------------------------------------- Secuencias fiscales (NCF/DGII)

-- Un NCF debe provenir de un rango autorizado por la DGII y consumirse de forma
-- correlativa y sin huecos (Norma 06-2018). La aplicación auditada generaba
-- `FAC-${Math.random()}` y NUNCA asignaba NCF: todo comprobante salía como
-- "Consumidor Final".
create table public.ncf_sequences (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid references public.branches(id) on delete set null,
  ncf_type          app.ncf_type not null,
  series            text not null default 'B',
  range_start       bigint not null check (range_start > 0),
  range_end         bigint not null,
  next_value        bigint not null,
  authorized_until  date   not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint ncf_sequences_range_valid check (range_end >= range_start),
  constraint ncf_sequences_next_within_range
    check (next_value >= range_start and next_value <= range_end + 1)
);

create index ncf_sequences_lookup_idx
  on public.ncf_sequences (company_id, ncf_type) where is_active;

create trigger ncf_sequences_touch before update on public.ncf_sequences
  for each row execute function app.touch_updated_at();

-- Asigna el siguiente NCF del rango vigente. Serializa por bloqueo de fila,
-- valida el agotamiento del rango y la fecha de vencimiento de la autorización.
create or replace function app.allocate_ncf(p_company uuid, p_type app.ncf_type)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq   public.ncf_sequences%rowtype;
  v_value bigint;
begin
  select * into v_seq
  from public.ncf_sequences
  where company_id = p_company
    and ncf_type   = p_type
    and is_active
    and next_value <= range_end
    and authorized_until >= current_date
  order by range_start
  limit 1
  for update;   -- serializa a los cajeros concurrentes

  if v_seq.id is null then
    raise exception
      'No hay secuencia NCF % vigente y con existencias para la empresa %. '
      'Solicite una nueva autorización a la DGII antes de facturar.',
      p_type, p_company
      using errcode = 'insufficient_resources';
  end if;

  v_value := v_seq.next_value;

  update public.ncf_sequences
     set next_value = next_value + 1
   where id = v_seq.id;

  -- Formato DGII: letra de serie + tipo (2 dígitos) + secuencia de 8 dígitos.
  return v_seq.series
       || substring(p_type::text from 2)
       || lpad(v_value::text, 8, '0');
end;
$$;

comment on function app.allocate_ncf is
  'Asigna un NCF correlativo de un rango autorizado. Falla si el rango se agotó o venció.';

-- ---------------------------------------------------------------- Facturas

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete restrict,
  invoice_number    text not null,
  ncf               text,
  ncf_type          app.ncf_type,

  work_order_id     uuid references public.work_orders(id) on delete set null,
  customer_id       uuid references public.customers(id) on delete set null,
  customer_name     text not null,
  customer_tax_id   text,
  vehicle_plate     text,

  subtotal_cents    bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  tax_cents         bigint not null default 0 check (tax_cents >= 0),
  total_cents       bigint not null default 0 check (total_cents >= 0),
  change_cents      bigint not null default 0 check (change_cents >= 0),

  cash_session_id   uuid references public.cash_sessions(id) on delete set null,
  cashier_id        uuid not null references public.profiles(id) on delete restrict,

  -- La anulación deja de ser un booleano suelto: exige nota de crédito.
  is_annulled       boolean not null default false,
  annulled_reason   text,
  annulled_at       timestamptz,
  annulled_by       uuid references public.profiles(id) on delete set null,
  credit_note_id    uuid references public.invoices(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (company_id, invoice_number),
  constraint invoices_annulled_is_justified check (
    (not is_annulled) or
    (annulled_at is not null and annulled_reason is not null and length(trim(annulled_reason)) > 0)
  )
);

-- Un NCF no puede repetirse dentro de la empresa.
create unique index invoices_ncf_unique
  on public.invoices (company_id, ncf) where ncf is not null;

create index invoices_created_idx  on public.invoices (company_id, created_at desc);
create index invoices_session_idx  on public.invoices (cash_session_id);
create index invoices_customer_idx on public.invoices (customer_id);

create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

create table public.invoice_items (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices(id) on delete cascade,
  item_type          app.item_type not null,
  service_id         uuid references public.services(id) on delete restrict,
  product_id         uuid references public.products(id) on delete restrict,
  name               text not null,
  quantity           integer not null check (quantity > 0),
  unit_price_cents   bigint not null check (unit_price_cents >= 0),
  discount_cents     bigint not null default 0 check (discount_cents >= 0),
  is_membego_covered boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint invoice_items_discount_within_line
    check (discount_cents <= unit_price_cents * quantity)
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- Numeración correlativa de facturas, análoga a la de órdenes.
create or replace function app.assign_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null or new.invoice_number = '' then
    new.invoice_number := 'FAC-' ||
      lpad(app.next_document_number(new.company_id, 'invoice')::text, 8, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_number
  before insert on public.invoices
  for each row execute function app.assign_invoice_number();

-- Cierra las referencias pendientes de cash_movements.
alter table public.cash_movements
  add constraint cash_movements_invoice_fk
  foreign key (invoice_id) references public.invoices(id) on delete set null;

-- ---------------------------------------------------------------- Gastos

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete restrict,
  category        app.expense_category not null default 'varios',
  description     text not null check (length(trim(description)) > 0),
  amount_cents    bigint not null check (amount_cents > 0),
  payment_method  app.payment_method not null default 'efectivo',
  supplier_name   text,
  invoice_ref     text,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  expense_date    date not null default current_date,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index expenses_company_date_idx on public.expenses (company_id, expense_date desc);

create trigger expenses_touch before update on public.expenses
  for each row execute function app.touch_updated_at();

alter table public.cash_movements
  add constraint cash_movements_expense_fk
  foreign key (expense_id) references public.expenses(id) on delete set null;

-- ---------------------------------------------------------------- Comisiones

create table public.commissions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete restrict,
  profile_id        uuid not null references public.profiles(id) on delete restrict,
  work_order_id     uuid not null references public.work_orders(id) on delete cascade,
  work_order_item_id uuid references public.work_order_items(id) on delete set null,
  service_name      text not null,
  base_cents        bigint not null check (base_cents >= 0),
  commission_bps    integer not null check (commission_bps between 0 and 10000),
  amount_cents      bigint not null check (amount_cents >= 0),
  earned_on         date not null default current_date,
  is_paid           boolean not null default false,
  paid_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index commissions_profile_idx on public.commissions (profile_id, earned_on desc);
create index commissions_unpaid_idx  on public.commissions (company_id) where not is_paid;


-- #############################################################################
-- ###  20260729000600_audit_log.sql
-- #############################################################################

-- =============================================================================
-- 0006 · Bitácora de auditoría inalterable
-- =============================================================================
-- Resuelve el riesgo C.. de la sección 7.6: la aplicación auditada titulaba la
-- pantalla "Audit Trail Inalterable" mientras la bitácora vivía solo en memoria
-- y se perdía en cada refresco de página. Aquí "inalterable" se cumple: la tabla
-- solo admite inserciones, garantizado por permisos, por RLS y por trigger.
-- =============================================================================

create table public.audit_logs (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete restrict,
  branch_id    uuid references public.branches(id) on delete set null,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text not null default '',
  actor_role   app.user_role,
  action       text not null check (length(trim(action)) > 0),
  entity       text not null,
  entity_id    text,
  details      text not null default '',
  metadata     jsonb not null default '{}'::jsonb,
  ip_address   inet,
  user_agent   text,
  occurred_at  timestamptz not null default now()
);

create index audit_logs_company_time_idx on public.audit_logs (company_id, occurred_at desc);
create index audit_logs_entity_idx       on public.audit_logs (company_id, entity, entity_id);
create index audit_logs_actor_idx        on public.audit_logs (actor_id, occurred_at desc);

-- Defensa 1: permisos. Ni siquiera se concede UPDATE/DELETE al rol autenticado.
revoke update, delete, truncate on public.audit_logs from authenticated, anon;

-- Defensa 2: trigger. Cubre también a roles con privilegios elevados que
-- pudieran saltarse la capa de permisos.
create or replace function app.forbid_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La bitácora de auditoría es de solo inserción (intento de % en audit_logs)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_no_update
  before update or delete on public.audit_logs
  for each row execute function app.forbid_audit_mutation();

-- El actor y su empresa se toman del perfil autenticado, nunca de lo que envíe
-- el cliente: en la aplicación auditada `createdBy` estaba codificado a
-- 'usr-3'/'Ana Beltrán' con independencia de quién operase, de modo que la
-- trazabilidad atribuía las acciones a la persona equivocada.
create or replace function app.stamp_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = auth.uid();

  if v_profile.id is not null then
    new.actor_id   := v_profile.id;
    new.actor_name := coalesce(nullif(v_profile.full_name, ''), v_profile.email, '');
    new.actor_role := v_profile.role;
    new.company_id := coalesce(v_profile.company_id, new.company_id);
    new.branch_id  := coalesce(new.branch_id, v_profile.branch_id);
  end if;

  new.occurred_at := now();   -- siempre reloj de servidor
  return new;
end;
$$;

create trigger audit_logs_stamp_actor
  before insert on public.audit_logs
  for each row execute function app.stamp_audit_actor();

comment on table public.audit_logs is
  'Bitácora de solo inserción. El actor y la marca de tiempo los fija el servidor.';


-- #############################################################################
-- ###  20260729000700_rls_policies.sql
-- #############################################################################

-- =============================================================================
-- 0007 · Row-Level Security
-- =============================================================================
-- Toda la superficie de seguridad en un solo archivo, para que sea auditable de
-- una lectura en lugar de estar repartida entre migraciones.
--
-- Reglas del diseño:
--   1. RLS activo en TODAS las tablas de negocio. Sin excepciones.
--   2. FORCE ROW LEVEL SECURITY: se aplica también al propietario de la tabla.
--   3. Fallo cerrado: sin política que lo permita, no hay acceso. Un usuario sin
--      empresa asignada (recién registrado) no ve absolutamente nada.
--   4. El aislamiento entre empresas es SIEMPRE company_id = app.current_company_id().
--      Nunca se delega en que la interfaz recuerde filtrar.
-- =============================================================================

-- Atajo: activa RLS y la fuerza en la tabla indicada.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'branches', 'profiles',
    'services', 'service_prices', 'products', 'bays',
    'customers', 'vehicles',
    'work_orders', 'work_order_items',
    'cash_sessions', 'cash_movements',
    'ncf_sequences', 'invoices', 'invoice_items',
    'expenses', 'commissions', 'audit_logs',
    'document_counters'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- =============================================================================
-- Empresas y sucursales
-- =============================================================================

create policy companies_select on public.companies
  for select to authenticated
  using (id = app.current_company_id());

-- Solo el propietario modifica los datos fiscales de la empresa.
create policy companies_update on public.companies
  for update to authenticated
  using (id = app.current_company_id() and app.has_role('propietario', 'superadmin'))
  with check (id = app.current_company_id());

create policy branches_select on public.branches
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy branches_write on public.branches
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Perfiles
-- =============================================================================

-- Cada quien se ve a sí mismo; el resto del directorio, solo dentro del tenant.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_tenant on public.profiles
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Datos propios editables, PERO sin poder cambiar empresa ni rol: eso sería
-- una escalada de privilegios en una sola sentencia UPDATE.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and company_id is not distinct from app.current_company_id()
    and role is not distinct from app.current_role()
  );

create policy profiles_admin_manage on public.profiles
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- -------------------------------------------------------------------
-- Barreras RESTRICTIVE contra la escalada de privilegios.
--
-- Las políticas permisivas se combinan con OR: `profiles_admin_manage`
-- permitía a un propietario o administrador editar CUALQUIER fila de su
-- empresa, incluida la suya, anulando el `with check` de
-- `profiles_update_self`. Un propietario podía convertirse en superadmin con
-- un solo UPDATE. Las políticas RESTRICTIVE se combinan con AND, así que se
-- aplican siempre, por encima de cualquier permiso concedido arriba.
--
-- Detectado por la batería de pruebas de RLS, no por revisión visual.
-- -------------------------------------------------------------------

-- Nadie modifica su propia empresa ni su propio rol. Ni el propietario.
-- Cambiar de rol a alguien es siempre una acción sobre OTRA persona.
create policy profiles_no_self_escalation on public.profiles
  as restrictive
  for update to authenticated
  using (true)
  with check (
    id <> auth.uid()
    or (
      company_id is not distinct from app.current_company_id()
      and role is not distinct from app.current_role()
    )
  );

-- Techo de concesión: para otorgar los roles de mayor privilegio hay que
-- tenerlos. Impide que un administrador fabrique propietarios o superadmins.
create policy profiles_role_ceiling_update on public.profiles
  as restrictive
  for update to authenticated
  using (true)
  with check (
    role is null
    or role not in ('propietario', 'superadmin')
    or app.has_role('propietario', 'superadmin')
  );

create policy profiles_role_ceiling_insert on public.profiles
  as restrictive
  for insert to authenticated
  with check (
    role is null
    or role not in ('propietario', 'superadmin')
    or app.has_role('propietario', 'superadmin')
  );

-- =============================================================================
-- Catálogo
-- =============================================================================

create policy services_select on public.services
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Cambiar precios es una acción sensible: queda restringida y auditada.
create policy services_write on public.services
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- service_prices no lleva company_id: hereda el tenant de su servicio.
create policy service_prices_select on public.service_prices
  for select to authenticated
  using (exists (
    select 1 from public.services s
    where s.id = service_id and app.belongs_to_tenant(s.company_id)
  ));

create policy service_prices_write on public.service_prices
  for all to authenticated
  using (exists (
    select 1 from public.services s
    where s.id = service_id and app.belongs_to_tenant(s.company_id)
  ) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (exists (
    select 1 from public.services s
    where s.id = service_id and app.belongs_to_tenant(s.company_id)
  ));

create policy products_select on public.products
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- El stock lo ajusta también el cajero (venta) y el supervisor (mermas).
create policy products_write on public.products
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

create policy bays_select on public.bays
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy bays_write on public.bays
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Clientes y vehículos
-- =============================================================================

create policy customers_select on public.customers
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy customers_write on public.customers
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

create policy vehicles_select on public.vehicles
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy vehicles_write on public.vehicles
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Órdenes de trabajo
-- =============================================================================

create policy work_orders_select on public.work_orders
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy work_orders_insert on public.work_orders
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

create policy work_orders_update on public.work_orders
  for update to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- Nadie borra órdenes: se cancelan. Ausencia deliberada de política DELETE.

create policy work_order_items_select on public.work_order_items
  for select to authenticated
  using (exists (
    select 1 from public.work_orders o
    where o.id = work_order_id and app.belongs_to_tenant(o.company_id)
  ));

create policy work_order_items_write on public.work_order_items
  for all to authenticated
  using (exists (
    select 1 from public.work_orders o
    where o.id = work_order_id and app.belongs_to_tenant(o.company_id)
  ))
  with check (exists (
    select 1 from public.work_orders o
    where o.id = work_order_id and app.belongs_to_tenant(o.company_id)
  ));

-- =============================================================================
-- Caja
-- =============================================================================

create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy cash_sessions_insert on public.cash_sessions
  for insert to authenticated
  with check (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'superadmin')
  );

create policy cash_sessions_update on public.cash_sessions
  for update to authenticated
  using (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'superadmin')
  )
  with check (app.belongs_to_tenant(company_id));

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Los movimientos solo se insertan. Corregir un error exige un asiento
-- compensatorio, no reescribir el histórico.
create policy cash_movements_insert on public.cash_movements
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Facturación y fiscalidad
-- =============================================================================

-- Los rangos NCF solo los ve y gestiona la administración: son un recurso
-- fiscal controlado, no un dato operativo.
create policy ncf_sequences_select on public.ncf_sequences
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'contador', 'superadmin'));

create policy ncf_sequences_write on public.ncf_sequences
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

create policy invoices_select on public.invoices
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'cajero', 'superadmin')
  );

-- Anular es la acción más sensible del sistema. En la aplicación auditada
-- estaba disponible para cualquiera, sin confirmación y con motivo codificado.
create policy invoices_annul on public.invoices
  for update to authenticated
  using (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin')
  )
  with check (app.belongs_to_tenant(company_id));

-- Sin política DELETE: una factura emitida no se borra jamás.

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.belongs_to_tenant(i.company_id)
  ));

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.belongs_to_tenant(i.company_id)
  ));

-- =============================================================================
-- Gastos y comisiones
-- =============================================================================

create policy expenses_select on public.expenses
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy expenses_write on public.expenses
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'contador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- Un operario ve sus propias comisiones y nada más.
create policy commissions_select_own on public.commissions
  for select to authenticated
  using (profile_id = auth.uid());

create policy commissions_select_management on public.commissions
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin'));

create policy commissions_write on public.commissions
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Auditoría y contadores
-- =============================================================================

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin'));

-- Cualquier usuario del tenant puede dejar constancia; el trigger sella quién.
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

-- Los contadores de documentos no se tocan directamente: solo a través de
-- app.next_document_number(), que es SECURITY DEFINER. Sin políticas para
-- `authenticated`, RLS los deja fuera de alcance por completo.

-- =============================================================================
-- Permisos base
-- =============================================================================

-- El rol anónimo no tiene nada que hacer aquí: no hay superficie pública.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Y por encima de los grants mandan las políticas de arriba.
revoke delete on all tables in schema public from authenticated;
revoke update, delete on public.audit_logs from authenticated;
revoke all on public.document_counters from authenticated;


-- #############################################################################
-- ###  20260729000800_billing_rpc.sql
-- #############################################################################

-- =============================================================================
-- 0008 · Facturación transaccional y notas de crédito
-- =============================================================================
-- Resuelve C9 y §4.1 (cuatro mutaciones que debían ser atómicas y no lo eran),
-- H3/I8 (doble clic = dos facturas) y completa C6 (la anulación no emitía nota
-- de crédito ni revertía caja e inventario).
--
-- Todo ocurre dentro de una única función y, por tanto, de una única
-- transacción: o se aplica entero o no se aplica nada.
--
-- Las funciones son SECURITY INVOKER a propósito. La autorización sigue siendo
-- responsabilidad de RLS (migración 0007): un cajero puede facturar pero no
-- anular, y eso lo decide la política, no el código de esta función.
-- =============================================================================

-- ------------------------------------------------------- Columnas nuevas

alter table public.invoices
  -- Clave de idempotencia generada por el cliente UNA vez por operación (no por
  -- intento). En la aplicación auditada la clave incluía Date.now(), así que
  -- cada reintento generaba una distinta y la protección nunca podía funcionar.
  add column client_request_id text,
  -- Si esta fila ES una nota de crédito, a qué factura anula.
  add column credits_invoice_id uuid references public.invoices(id) on delete restrict;

create unique index invoices_idempotency_unique
  on public.invoices (company_id, client_request_id)
  where client_request_id is not null;

create index invoices_credits_idx on public.invoices (credits_invoice_id)
  where credits_invoice_id is not null;

-- Una nota de crédito siempre es de tipo B04 y siempre apunta a un original.
alter table public.invoices
  add constraint invoices_credit_note_is_coherent check (
    (credits_invoice_id is null) or (ncf_type = 'B04')
  );

-- =============================================================================
-- app.resolve_item_price · el precio SIEMPRE lo pone el servidor
-- =============================================================================
-- Nunca se acepta el precio que envía el cliente: un navegador manipulado
-- podría facturar a cero. Se resuelve contra el catálogo y, para servicios,
-- contra la matriz de precios por categoría de vehículo.
create or replace function app.resolve_item_price(
  p_item_type        app.item_type,
  p_service_id       uuid,
  p_product_id       uuid,
  p_vehicle_category app.vehicle_category
)
returns bigint
language plpgsql
stable
as $$
declare
  v_price bigint;
begin
  if p_item_type = 'product' then
    select price_cents into v_price from public.products where id = p_product_id;
    if v_price is null then
      raise exception 'Producto % inexistente o sin precio', p_product_id
        using errcode = 'foreign_key_violation';
    end if;
  else
    select price_cents into v_price
    from public.service_prices
    where service_id = p_service_id and vehicle_category = p_vehicle_category;

    if v_price is null then
      raise exception
        'El servicio % no tiene precio definido para la categoría %',
        p_service_id, p_vehicle_category
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return v_price;
end;
$$;

-- =============================================================================
-- public.create_invoice · emisión atómica
-- =============================================================================
create or replace function public.create_invoice(
  p_branch_id         uuid,
  p_client_request_id text,
  p_items             jsonb,
  p_payments          jsonb,
  p_vehicle_category  app.vehicle_category default 'sedan',
  p_work_order_id     uuid    default null,
  p_customer_id       uuid    default null,
  p_customer_name     text    default 'Consumidor Final',
  p_customer_tax_id   text    default null,
  p_vehicle_plate     text    default null,
  p_ncf_type          app.ncf_type default null,
  p_cash_session_id   uuid    default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company      uuid;
  v_existing     public.invoices;
  v_invoice      public.invoices;
  v_item         record;
  v_payment      record;
  v_price        bigint;
  v_subtotal     bigint := 0;
  v_discount     bigint := 0;
  v_membego      bigint := 0;
  v_taxable      bigint;
  v_rate_bps     integer;
  v_tax          bigint;
  v_total        bigint;
  v_paid         bigint := 0;
  v_cash_paid    bigint := 0;
  v_change       bigint;
  v_ncf          text := null;
  v_session      public.cash_sessions;
  v_rows         integer;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia (p_client_request_id)'
      using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------- Idempotencia
  -- Un segundo clic sobre "Cobrar" devuelve la MISMA factura en lugar de emitir
  -- otra, duplicar el descuento de stock y volver a sumar el ingreso a la caja.
  select * into v_existing
  from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;

  if v_existing.id is not null then
    return v_existing;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura no tiene líneas' using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------- Totales
  -- Calculados en el servidor a partir del catálogo. Lo que envía el cliente
  -- sobre precios se ignora deliberadamente.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      item_type          app.item_type,
      service_id         uuid,
      product_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida en la línea "%"', v_item.name
        using errcode = 'invalid_parameter_value';
    end if;

    v_price := app.resolve_item_price(
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category
    );

    if coalesce(v_item.is_membego_covered, false) then
      v_membego := v_membego + v_price * v_item.quantity;
    else
      v_discount := v_discount + coalesce(v_item.discount_cents, 0);
    end if;
    v_subtotal := v_subtotal + v_price * v_item.quantity;
  end loop;

  select tax_rate_bps into v_rate_bps from public.companies where id = v_company;

  -- MISMA fórmula que app.recalc_work_order_totals(). En la aplicación auditada
  -- había tres versiones divergentes y la factura de una orden con beneficio
  -- Membego calculaba un ITBIS distinto al de la propia orden.
  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  v_tax     := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;
  v_total   := v_taxable + v_tax;

  -- ------------------------------------------------------------- Pagos
  for v_payment in
    select * from jsonb_to_recordset(p_payments) as x(
      method       app.payment_method,
      amount_cents bigint,
      reference    text
    )
  loop
    if coalesce(v_payment.amount_cents, 0) <= 0 then
      raise exception 'Importe de pago inválido' using errcode = 'invalid_parameter_value';
    end if;
    v_paid := v_paid + v_payment.amount_cents;
    if v_payment.method = 'efectivo' then
      v_cash_paid := v_cash_paid + v_payment.amount_cents;
    end if;
  end loop;

  if v_paid < v_total then
    raise exception 'Pago insuficiente: recibido % de un total de %', v_paid, v_total
      using errcode = 'invalid_parameter_value';
  end if;

  -- El cambio se calcula UNA vez sobre el total, no una vez por pago. El código
  -- auditado hacía `cashAdd += p.amount - changeAmount` dentro de un bucle, de
  -- modo que con dos pagos en efectivo restaba el cambio dos veces.
  v_change := v_paid - v_total;

  if v_change > 0 and v_cash_paid < v_change then
    raise exception 'Solo puede devolverse cambio sobre pagos en efectivo'
      using errcode = 'invalid_parameter_value';
  end if;

  -- --------------------------------------------------------- Caja abierta
  if v_cash_paid > 0 then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and status = 'open';

    if v_session.id is null then
      raise exception 'No hay una sesión de caja abierta para registrar el efectivo'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- ---------------------------------------------------------------- NCF
  if p_ncf_type is not null then
    if p_ncf_type = 'B04' then
      raise exception 'B04 es exclusivo de notas de crédito: use annul_invoice()'
        using errcode = 'invalid_parameter_value';
    end if;
    v_ncf := app.allocate_ncf(v_company, p_ncf_type);
  end if;

  -- ------------------------------------------------------------- Escritura
  insert into public.invoices (
    company_id, branch_id, client_request_id, ncf, ncf_type,
    work_order_id, customer_id, customer_name, customer_tax_id, vehicle_plate,
    subtotal_cents, discount_cents, tax_cents, total_cents, change_cents,
    cash_session_id, cashier_id
  ) values (
    v_company, p_branch_id, p_client_request_id, v_ncf, p_ncf_type,
    p_work_order_id, p_customer_id, p_customer_name, p_customer_tax_id, p_vehicle_plate,
    v_subtotal, v_discount + v_membego, v_tax, v_total, v_change,
    p_cash_session_id, auth.uid()
  )
  returning * into v_invoice;

  -- Líneas, de nuevo con el precio del servidor.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      item_type          app.item_type,
      service_id         uuid,
      product_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    v_price := app.resolve_item_price(
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category
    );

    insert into public.invoice_items (
      invoice_id, item_type, service_id, product_id, name,
      quantity, unit_price_cents, discount_cents, is_membego_covered
    ) values (
      v_invoice.id, v_item.item_type, v_item.service_id, v_item.product_id, v_item.name,
      v_item.quantity, v_price,
      case when coalesce(v_item.is_membego_covered,false) then 0 else coalesce(v_item.discount_cents,0) end,
      coalesce(v_item.is_membego_covered, false)
    );

    -- Inventario
    if v_item.item_type = 'product' then
      update public.products
         set stock = stock - v_item.quantity
       where id = v_item.product_id and company_id = v_company;
    end if;
  end loop;

  -- ------------------------------------------------------- Movimientos de caja
  if p_cash_session_id is not null then
    for v_payment in
      select * from jsonb_to_recordset(p_payments) as x(
        method app.payment_method, amount_cents bigint, reference text
      )
    loop
      insert into public.cash_movements (
        company_id, cash_session_id, type, method, amount_cents, reason, invoice_id, created_by
      ) values (
        v_company, p_cash_session_id, 'inflow', v_payment.method,
        -- Solo del efectivo se descuenta el cambio entregado, y una sola vez.
        case when v_payment.method = 'efectivo'
             then v_payment.amount_cents - v_change
             else v_payment.amount_cents end,
        'Factura ' || v_invoice.invoice_number
          || case when v_payment.reference is not null then ' · ref ' || v_payment.reference else '' end,
        v_invoice.id, auth.uid()
      );
    end loop;
  end if;

  -- --------------------------------------------------------- Orden de trabajo
  if p_work_order_id is not null then
    update public.work_orders
       set payment_status = 'pagado',
           payment_method = (p_payments -> 0 ->> 'method')::app.payment_method
     where id = p_work_order_id and company_id = v_company;

    get diagnostics v_rows = row_count;
    -- RLS filtra en silencio: sin esta comprobación, una orden no autorizada
    -- quedaría sin marcar y nadie se enteraría.
    if v_rows = 0 then
      raise exception 'No se pudo marcar como pagada la orden %', p_work_order_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, p_branch_id, 'EMITIR_FACTURA', 'Invoice', v_invoice.id::text,
    'Factura ' || v_invoice.invoice_number || ' por ' || v_total || ' centavos'
      || coalesce(' · NCF ' || v_ncf, ' · sin NCF'),
    jsonb_build_object('total_cents', v_total, 'ncf', v_ncf, 'idempotency', p_client_request_id)
  );

  return v_invoice;
end;
$$;

comment on function public.create_invoice is
  'Emisión atómica: factura, líneas, caja, inventario, orden y auditoría en una transacción. Idempotente por client_request_id.';

-- =============================================================================
-- public.annul_invoice · anulación con nota de crédito B04
-- =============================================================================
create or replace function public.annul_invoice(
  p_invoice_id        uuid,
  p_reason            text,
  p_client_request_id text
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company     uuid;
  v_original    public.invoices;
  v_existing    public.invoices;
  v_credit      public.invoices;
  v_item        record;
  v_movement    record;
  v_session     uuid;
  v_ncf         text;
  v_rows        integer;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'La anulación exige un motivo' using errcode = 'invalid_parameter_value';
  end if;
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();

  -- Idempotencia: un segundo clic devuelve la nota de crédito ya emitida.
  select * into v_existing
  from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  -- FOR UPDATE serializa dos anulaciones simultáneas de la misma factura.
  select * into v_original from public.invoices
  where id = p_invoice_id and company_id = v_company
  for update;

  if v_original.id is null then
    raise exception 'Factura % inexistente o fuera de su alcance', p_invoice_id
      using errcode = 'no_data_found';
  end if;
  if v_original.is_annulled then
    raise exception 'La factura % ya está anulada', v_original.invoice_number
      using errcode = 'invalid_parameter_value';
  end if;
  if v_original.credits_invoice_id is not null then
    raise exception 'Una nota de crédito no se anula' using errcode = 'invalid_parameter_value';
  end if;

  -- Caja donde se registra la devolución: la original si sigue abierta; si no,
  -- la que esté abierta ahora en esa sucursal. Devolver efectivo contra una caja
  -- cerrada descuadraría un arqueo ya firmado.
  if v_original.total_cents > 0 then
    select id into v_session from public.cash_sessions
    where id = v_original.cash_session_id and status = 'open';

    if v_session is null then
      select id into v_session from public.cash_sessions
      where branch_id = v_original.branch_id and status = 'open'
      order by opened_at desc limit 1;
    end if;

    if v_session is null then
      raise exception
        'No hay caja abierta en la sucursal para registrar la devolución. Abra la caja antes de anular.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Solo se emite NCF de nota de crédito si la factura original llevaba NCF.
  if v_original.ncf is not null then
    v_ncf := app.allocate_ncf(v_company, 'B04');
  end if;

  insert into public.invoices (
    company_id, branch_id, client_request_id, ncf, ncf_type, credits_invoice_id,
    work_order_id, customer_id, customer_name, customer_tax_id, vehicle_plate,
    subtotal_cents, discount_cents, tax_cents, total_cents, change_cents,
    cash_session_id, cashier_id
  ) values (
    v_company, v_original.branch_id, p_client_request_id, v_ncf,
    case when v_ncf is not null then 'B04'::app.ncf_type else null end,
    v_original.id,
    v_original.work_order_id, v_original.customer_id, v_original.customer_name,
    v_original.customer_tax_id, v_original.vehicle_plate,
    v_original.subtotal_cents, v_original.discount_cents, v_original.tax_cents,
    v_original.total_cents, 0,
    v_session, auth.uid()
  )
  returning * into v_credit;

  -- Las líneas se copian tal cual: la nota de crédito debe poder leerse sola.
  insert into public.invoice_items (
    invoice_id, item_type, service_id, product_id, name,
    quantity, unit_price_cents, discount_cents, is_membego_covered
  )
  select v_credit.id, item_type, service_id, product_id, name,
         quantity, unit_price_cents, discount_cents, is_membego_covered
  from public.invoice_items where invoice_id = v_original.id;

  -- ------------------------------------------------------ Reversión de stock
  for v_item in
    select product_id, quantity from public.invoice_items
    where invoice_id = v_original.id and item_type = 'product' and product_id is not null
  loop
    update public.products
       set stock = stock + v_item.quantity
     where id = v_item.product_id and company_id = v_company;
  end loop;

  -- ------------------------------------------------------- Reversión de caja
  -- Asiento compensatorio, nunca borrado del original: el histórico de caja es
  -- inmutable y una corrección debe verse como tal.
  for v_movement in
    select method, amount_cents from public.cash_movements
    where invoice_id = v_original.id and type = 'inflow'
  loop
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, invoice_id, created_by
    ) values (
      v_company, v_session, 'outflow', v_movement.method, v_movement.amount_cents,
      'Anulación de ' || v_original.invoice_number
        || coalesce(' · NC ' || v_ncf, '') || ' · ' || p_reason,
      v_credit.id, auth.uid()
    );
  end loop;

  -- --------------------------------------------------------- Marcar original
  update public.invoices
     set is_annulled     = true,
         annulled_reason = p_reason,
         annulled_at     = now(),
         annulled_by     = auth.uid(),
         credit_note_id  = v_credit.id
   where id = v_original.id;

  get diagnostics v_rows = row_count;
  -- Sin esta comprobación, un cajero sin permiso vería la anulación como
  -- realizada: RLS habría filtrado la fila sin lanzar ningún error.
  if v_rows = 0 then
    raise exception 'No tiene permiso para anular facturas'
      using errcode = 'insufficient_privilege';
  end if;

  -- La orden vuelve a quedar pendiente de cobro.
  if v_original.work_order_id is not null then
    update public.work_orders
       set payment_status = 'pendiente', payment_method = null
     where id = v_original.work_order_id and company_id = v_company;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, v_original.branch_id, 'ANULAR_FACTURA', 'Invoice', v_original.id::text,
    'Anulada ' || v_original.invoice_number || ' mediante nota de crédito '
      || v_credit.invoice_number || coalesce(' (NCF ' || v_ncf || ')', '') || ' · Motivo: ' || p_reason,
    jsonb_build_object('credit_note_id', v_credit.id, 'reversed_cents', v_original.total_cents)
  );

  return v_credit;
end;
$$;

comment on function public.annul_invoice is
  'Anula con nota de crédito B04, revierte inventario y caja, y libera la orden. Atómico e idempotente.';

grant execute on function public.create_invoice to authenticated;
grant execute on function public.annul_invoice  to authenticated;


-- #############################################################################
-- ###  20260729000900_tenant_composite_fks.sql
-- #############################################################################

-- =============================================================================
-- 0009 · Integridad de tenant mediante claves foráneas compuestas
-- =============================================================================
-- Cierra una vulnerabilidad de corrupción financiera entre empresas encontrada
-- atacando el propio esquema.
--
-- EL FALLO
-- Las políticas RLS validan `company_id`, pero las claves foráneas
-- (`cash_session_id`, `branch_id`, `customer_id`, ...) las envía el cliente y
-- nadie comprobaba que apuntasen al mismo tenant. Con el UUID de la sesión de
-- caja de otra empresa —un valor que la API acepta sin más— el cajero de la
-- empresa A podía insertar un movimiento con `company_id` = A y
-- `cash_session_id` = caja de B. RLS lo aceptaba (company_id era el suyo) y el
-- trigger `app.recalc_cash_session`, que es SECURITY DEFINER, recalculaba
-- alegremente la caja de B.
--
-- Reproducido: una salida de 400.000 contra la caja de la empresa vecina
-- cambió su efectivo esperado de 0 a 100.000.
--
-- LA CORRECCIÓN
-- No un trigger de validación —que habría que recordar poner en cada tabla
-- nueva— sino claves foráneas COMPUESTAS que incluyen company_id. Con ellas el
-- desajuste de tenant es estructuralmente imposible: PostgreSQL no permite
-- siquiera describir la fila incoherente.
-- =============================================================================

-- ------------------------------------------------- Claves candidatas compuestas
-- Necesarias para poder referenciarlas desde las FK compuestas.
--
-- NOTA sobre ON DELETE SET NULL: en una clave foránea compuesta, la forma
-- simple anula TODAS las columnas del lado hijo, company_id incluida — que es
-- NOT NULL, de modo que borrar el padre reventaba la operación. Se acota con
-- `on delete set null (columna)`, sintaxis disponible desde PostgreSQL 15.
-- Lo detectó el borrado de una sesión de caja en las pruebas.

alter table public.branches      add constraint branches_id_company_key      unique (id, company_id);
alter table public.customers     add constraint customers_id_company_key     unique (id, company_id);
alter table public.vehicles      add constraint vehicles_id_company_key      unique (id, company_id);
alter table public.services      add constraint services_id_company_key      unique (id, company_id);
alter table public.products      add constraint products_id_company_key      unique (id, company_id);
alter table public.bays          add constraint bays_id_company_key          unique (id, company_id);
alter table public.work_orders   add constraint work_orders_id_company_key   unique (id, company_id);
alter table public.cash_sessions add constraint cash_sessions_id_company_key unique (id, company_id);
alter table public.invoices      add constraint invoices_id_company_key      unique (id, company_id);
alter table public.profiles      add constraint profiles_id_company_key      unique (id, company_id);
alter table public.expenses      add constraint expenses_id_company_key      unique (id, company_id);

-- ------------------------------------------------------------- Perfiles

alter table public.profiles drop constraint profiles_branch_id_fkey;
alter table public.profiles
  add constraint profiles_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id)
  on delete set null (branch_id);

-- ------------------------------------------------------------- Catálogo

alter table public.products drop constraint products_branch_id_fkey;
alter table public.products
  add constraint products_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id)
  on delete set null (branch_id);

alter table public.bays drop constraint bays_branch_id_fkey;
alter table public.bays
  add constraint bays_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id)
  on delete cascade;

alter table public.bays drop constraint bays_current_work_order_fk;
alter table public.bays
  add constraint bays_work_order_same_company
  foreign key (current_work_order_id, company_id) references public.work_orders(id, company_id)
  on delete set null (current_work_order_id);

alter table public.vehicles drop constraint vehicles_customer_id_fkey;
alter table public.vehicles
  add constraint vehicles_customer_same_company
  foreign key (customer_id, company_id) references public.customers(id, company_id)
  on delete set null (customer_id);

-- ------------------------------------------------------------- Órdenes

alter table public.work_orders drop constraint work_orders_branch_id_fkey;
alter table public.work_orders
  add constraint work_orders_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.work_orders drop constraint work_orders_customer_id_fkey;
alter table public.work_orders
  add constraint work_orders_customer_same_company
  foreign key (customer_id, company_id) references public.customers(id, company_id)
  on delete set null (customer_id);

alter table public.work_orders drop constraint work_orders_vehicle_id_fkey;
alter table public.work_orders
  add constraint work_orders_vehicle_same_company
  foreign key (vehicle_id, company_id) references public.vehicles(id, company_id)
  on delete set null (vehicle_id);

alter table public.work_orders drop constraint work_orders_bay_id_fkey;
alter table public.work_orders
  add constraint work_orders_bay_same_company
  foreign key (bay_id, company_id) references public.bays(id, company_id)
  on delete set null (bay_id);

-- ------------------------------------------------------------- Caja

alter table public.cash_sessions drop constraint cash_sessions_branch_id_fkey;
alter table public.cash_sessions
  add constraint cash_sessions_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

-- La que hacía posible el ataque descrito arriba.
alter table public.cash_movements drop constraint cash_movements_cash_session_id_fkey;
alter table public.cash_movements
  add constraint cash_movements_session_same_company
  foreign key (cash_session_id, company_id) references public.cash_sessions(id, company_id);

alter table public.cash_movements drop constraint cash_movements_invoice_fk;
alter table public.cash_movements
  add constraint cash_movements_invoice_same_company
  foreign key (invoice_id, company_id) references public.invoices(id, company_id)
  on delete set null (invoice_id);

-- ------------------------------------------------------------- Facturación

alter table public.invoices drop constraint invoices_branch_id_fkey;
alter table public.invoices
  add constraint invoices_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.invoices drop constraint invoices_work_order_id_fkey;
alter table public.invoices
  add constraint invoices_work_order_same_company
  foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
  on delete set null (work_order_id);

alter table public.invoices drop constraint invoices_customer_id_fkey;
alter table public.invoices
  add constraint invoices_customer_same_company
  foreign key (customer_id, company_id) references public.customers(id, company_id)
  on delete set null (customer_id);

alter table public.invoices drop constraint invoices_cash_session_id_fkey;
alter table public.invoices
  add constraint invoices_cash_session_same_company
  foreign key (cash_session_id, company_id) references public.cash_sessions(id, company_id)
  on delete set null (cash_session_id);

alter table public.invoices drop constraint invoices_credits_invoice_id_fkey;
alter table public.invoices
  add constraint invoices_credits_same_company
  foreign key (credits_invoice_id, company_id) references public.invoices(id, company_id);

alter table public.invoices drop constraint invoices_credit_note_id_fkey;
alter table public.invoices
  add constraint invoices_credit_note_same_company
  foreign key (credit_note_id, company_id) references public.invoices(id, company_id);

-- ------------------------------------------------------- Gastos y comisiones

alter table public.expenses drop constraint expenses_branch_id_fkey;
alter table public.expenses
  add constraint expenses_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.expenses drop constraint expenses_cash_session_id_fkey;
alter table public.expenses
  add constraint expenses_cash_session_same_company
  foreign key (cash_session_id, company_id) references public.cash_sessions(id, company_id)
  on delete set null (cash_session_id);

alter table public.cash_movements drop constraint cash_movements_expense_fk;
alter table public.cash_movements
  add constraint cash_movements_expense_same_company
  foreign key (expense_id, company_id) references public.expenses(id, company_id)
  on delete set null (expense_id);


alter table public.commissions drop constraint commissions_branch_id_fkey;
alter table public.commissions
  add constraint commissions_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.commissions drop constraint commissions_work_order_id_fkey;
alter table public.commissions
  add constraint commissions_work_order_same_company
  foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
  on delete cascade;

-- =============================================================================
-- Líneas de detalle: heredan el tenant del documento padre
-- =============================================================================
-- work_order_items e invoice_items no tenían company_id, así que una línea podía
-- referenciar el servicio o el producto de otra empresa. Se denormaliza la
-- columna, se rellena por trigger desde el padre y se encadena todo con FK
-- compuestas: el valor no lo pone el cliente.

alter table public.work_order_items add column company_id uuid;
alter table public.invoice_items    add column company_id uuid;

update public.work_order_items i
   set company_id = o.company_id
  from public.work_orders o where o.id = i.work_order_id;

update public.invoice_items i
   set company_id = v.company_id
  from public.invoices v where v.id = i.invoice_id;

alter table public.work_order_items alter column company_id set not null;
alter table public.invoice_items    alter column company_id set not null;

create or replace function app.inherit_company_from_work_order()
returns trigger language plpgsql as $$
begin
  select company_id into new.company_id
  from public.work_orders where id = new.work_order_id;
  if new.company_id is null then
    raise exception 'Orden de trabajo % inexistente', new.work_order_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create or replace function app.inherit_company_from_invoice()
returns trigger language plpgsql as $$
begin
  select company_id into new.company_id
  from public.invoices where id = new.invoice_id;
  if new.company_id is null then
    raise exception 'Factura % inexistente', new.invoice_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger work_order_items_inherit_company
  before insert or update of work_order_id on public.work_order_items
  for each row execute function app.inherit_company_from_work_order();

create trigger invoice_items_inherit_company
  before insert or update of invoice_id on public.invoice_items
  for each row execute function app.inherit_company_from_invoice();

alter table public.work_order_items drop constraint work_order_items_work_order_id_fkey;
alter table public.work_order_items
  add constraint work_order_items_order_same_company
  foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
  on delete cascade;

alter table public.work_order_items drop constraint work_order_items_service_id_fkey;
alter table public.work_order_items
  add constraint work_order_items_service_same_company
  foreign key (service_id, company_id) references public.services(id, company_id);

alter table public.work_order_items drop constraint work_order_items_product_id_fkey;
alter table public.work_order_items
  add constraint work_order_items_product_same_company
  foreign key (product_id, company_id) references public.products(id, company_id);

alter table public.invoice_items drop constraint invoice_items_invoice_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_invoice_same_company
  foreign key (invoice_id, company_id) references public.invoices(id, company_id)
  on delete cascade;

alter table public.invoice_items drop constraint invoice_items_service_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_service_same_company
  foreign key (service_id, company_id) references public.services(id, company_id);

alter table public.invoice_items drop constraint invoice_items_product_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_product_same_company
  foreign key (product_id, company_id) references public.products(id, company_id);

-- service_prices cuelga de services vía CASCADE, sin columna de tenant propia:
-- no admite desajuste posible.

-- --------------------------------------------------- RLS de las columnas nuevas

-- Ahora que las líneas llevan company_id, sus políticas pueden usarlo
-- directamente en lugar de un EXISTS contra el documento padre.
drop policy work_order_items_select on public.work_order_items;
drop policy work_order_items_write  on public.work_order_items;

create policy work_order_items_select on public.work_order_items
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy work_order_items_write on public.work_order_items
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

drop policy invoice_items_select on public.invoice_items;
drop policy invoice_items_insert on public.invoice_items;

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

create index work_order_items_company_idx on public.work_order_items (company_id);
create index invoice_items_company_idx    on public.invoice_items (company_id);

-- --------------------------------------------------------------- Índices de FK

-- PostgreSQL no indexa automáticamente el lado hijo de una FK. Sin estos
-- índices, borrar una fila padre obliga a un recorrido secuencial del hijo.
create index if not exists cash_movements_invoice_idx on public.cash_movements (invoice_id);
create index if not exists cash_movements_expense_idx on public.cash_movements (expense_id);
create index if not exists invoices_work_order_idx    on public.invoices (work_order_id);
create index if not exists work_orders_bay_idx        on public.work_orders (bay_id);
create index if not exists work_orders_vehicle_idx    on public.work_orders (vehicle_id);


-- #############################################################################
-- ###  20260729001000_orders_rpc.sql
-- #############################################################################

-- =============================================================================
-- 0010 · Órdenes de trabajo: máquina de estados, bahías y comisiones
-- =============================================================================
-- Necesario para que las vistas de Órdenes y Kanban signifiquen algo.
--
-- Lo que resuelve, de la auditoría:
--
--   M7  La lógica de bahías era ficticia: el Kanban llamaba a updateOrderStatus
--       con 'bay-1' codificado y washers[0], sin comprobar capacidad, y
--       updateBayStatus NUNCA se invocaba desde el flujo de órdenes, de modo
--       que las bahías y las órdenes discrepaban de forma permanente.
--   §14.4 Las comisiones se sembraban y mostraban, pero ningún camino de código
--       las generaba: setCommissions se declaraba y no se llamaba jamás.
--   §4.1 Cambiar de estado tocaba varias entidades sin atomicidad.
--
-- Y algo que la aplicación auditada no tenía en absoluto: **validación de las
-- transiciones**. Cualquier estado podía saltar a cualquier otro, incluso desde
-- una llamada directa al API. Aquí la máquina de estados la impone la base.
-- =============================================================================

-- Idempotencia también al crear órdenes: dos toques en "Registrar llegada" no
-- deben producir dos órdenes para el mismo vehículo.
alter table public.work_orders add column client_request_id text;

create unique index work_orders_idempotency_unique
  on public.work_orders (company_id, client_request_id)
  where client_request_id is not null;

-- ------------------------------------------------------- Máquina de estados

/**
 * Transiciones permitidas. `entregado` y `cancelado` son terminales.
 * Se admite retroceso de `control_calidad` y `listo` a `en_proceso` porque el
 * repaso de un lavado mal terminado es parte normal de la operación.
 */
create or replace function app.order_transition_allowed(
  p_from app.order_status,
  p_to   app.order_status
)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'pendiente'       then p_to in ('en_espera','asignada','en_proceso','cancelado')
    when 'en_espera'       then p_to in ('asignada','en_proceso','cancelado')
    when 'asignada'        then p_to in ('en_proceso','en_espera','cancelado')
    when 'en_proceso'      then p_to in ('control_calidad','listo','cancelado')
    when 'control_calidad' then p_to in ('listo','en_proceso','cancelado')
    when 'listo'           then p_to in ('entregado','control_calidad')
    else false                                  -- entregado y cancelado: terminales
  end
$$;

create or replace function app.enforce_order_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not app.order_transition_allowed(old.status, new.status) then
    raise exception 'Transición no permitida: % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger work_orders_enforce_transition
  before update of status on public.work_orders
  for each row execute function app.enforce_order_transition();

-- ---------------------------------------------------- Asignación de operarios

-- Los operarios asignados dejan de vivir como array de texto dentro de la orden
-- (donde el nombre se copiaba y quedaba obsoleto) y pasan a ser una relación.
create table public.work_order_assignees (
  work_order_id uuid not null,
  profile_id    uuid not null,
  company_id    uuid not null,
  assigned_at   timestamptz not null default now(),
  primary key (work_order_id, profile_id),
  constraint work_order_assignees_order_same_company
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
    on delete cascade,
  constraint work_order_assignees_profile_same_company
    foreign key (profile_id, company_id) references public.profiles(id, company_id)
    on delete cascade
);

create index work_order_assignees_profile_idx on public.work_order_assignees (profile_id);

alter table public.work_order_assignees enable row level security;
alter table public.work_order_assignees force row level security;

create policy work_order_assignees_select on public.work_order_assignees
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy work_order_assignees_write on public.work_order_assignees
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- Los `grant` de la migración 0007 se aplicaron sobre las tablas que existían
-- ENTONCES: una tabla creada después nace sin permisos y RLS ni siquiera llega
-- a evaluarse (el error es "permission denied", no "no rows"). Lo detectaron
-- las pruebas de esta misma migración.
-- Esta tabla es la única excepción a la regla de «el rol autenticado no borra».
-- No es un registro contable: es la asignación vigente de operarios a una
-- orden, y reasignar a un lavador exige retirar la anterior. Qué filas puede
-- tocar cada usuario lo sigue decidiendo RLS.
grant select, insert, update, delete on public.work_order_assignees to authenticated;

-- Y para que no vuelva a ocurrir con la siguiente tabla: las que cree este rol
-- de aquí en adelante reciben los permisos automáticamente. Las políticas RLS
-- siguen siendo obligatorias — un grant no sustituye a una política.
alter default privileges in schema public
  grant select, insert, update on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- ---------------------------------------------------------- Crear una orden

create or replace function public.create_work_order(
  p_branch_id         uuid,
  p_client_request_id text,
  p_vehicle_plate     text,
  p_vehicle_category  app.vehicle_category,
  p_items             jsonb,
  p_customer_name     text default null,
  p_customer_id       uuid default null,
  p_customer_phone    text default null,
  p_vehicle_make      text default '',
  p_vehicle_model     text default '',
  p_vehicle_color     text default '',
  p_priority          text default 'normal',
  p_notes             text default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_existing public.work_orders;
  v_order    public.work_orders;
  v_customer uuid := p_customer_id;
  v_vehicle  uuid;
  v_plate    text;
  v_item     record;
  v_price    bigint;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- Un segundo toque en "Registrar llegada" devuelve la orden ya creada.
  select * into v_existing from public.work_orders
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden necesita al menos un servicio'
      using errcode = 'invalid_parameter_value';
  end if;

  v_plate := upper(regexp_replace(coalesce(p_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_plate) = 0 then
    raise exception 'La placa del vehículo es obligatoria' using errcode = 'invalid_parameter_value';
  end if;

  -- Cliente. `p_customer_name` a NULL significa visitante anónimo: no se crea
  -- ficha para no llenar el directorio de "Cliente General" duplicados. Si la
  -- recepción escribió un nombre O un teléfono, sí se registra: es información
  -- que alguien se molestó en pedir.
  if v_customer is null and (p_customer_name is not null or p_customer_phone is not null) then
    insert into public.customers (company_id, branch_id, name, phone)
    values (v_company, p_branch_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente General'),
            p_customer_phone)
    returning id into v_customer;
  end if;

  -- Vehículo: la placa es única por empresa, así que se reutiliza el registro.
  select id into v_vehicle from public.vehicles
  where company_id = v_company and plate = v_plate;

  if v_vehicle is null then
    insert into public.vehicles (company_id, customer_id, plate, make, model, color, category)
    values (v_company, v_customer, v_plate, p_vehicle_make, p_vehicle_model,
            p_vehicle_color, p_vehicle_category)
    returning id into v_vehicle;
  elsif v_customer is not null then
    update public.vehicles set customer_id = v_customer
    where id = v_vehicle and customer_id is null;
  end if;

  insert into public.work_orders (
    company_id, branch_id, client_request_id, customer_id, customer_name, customer_phone,
    vehicle_id, vehicle_plate, vehicle_make_model, vehicle_category, vehicle_color,
    status, priority, notes, created_by
  ) values (
    v_company, p_branch_id, p_client_request_id, v_customer,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente General'), p_customer_phone,
    v_vehicle, v_plate, trim(coalesce(p_vehicle_make,'') || ' ' || coalesce(p_vehicle_model,'')),
    p_vehicle_category, coalesce(p_vehicle_color,''),
    'pendiente', p_priority, p_notes, auth.uid()
  )
  returning * into v_order;

  -- Líneas con el precio del catálogo. El cliente no fija importes.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      service_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida en "%"', v_item.name using errcode = 'invalid_parameter_value';
    end if;

    v_price := app.resolve_item_price('service', v_item.service_id, null, p_vehicle_category);

    insert into public.work_order_items (
      work_order_id, item_type, service_id, name, quantity,
      unit_price_cents, discount_cents, is_membego_covered
    ) values (
      v_order.id, 'service', v_item.service_id, v_item.name, v_item.quantity,
      v_price,
      case when coalesce(v_item.is_membego_covered,false) then 0 else coalesce(v_item.discount_cents,0) end,
      coalesce(v_item.is_membego_covered, false)
    );
  end loop;

  -- Los totales los recalculó el trigger de las líneas.
  select * into v_order from public.work_orders where id = v_order.id;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'NUEVA_LLEGADA_ORDEN', 'WorkOrder', v_order.id::text,
          'Orden ' || v_order.order_number || ' · ' || v_plate || ' · ' || v_order.customer_name);

  return v_order;
end;
$$;

-- ------------------------------------------------------ Avanzar de estado

/**
 * Cambia el estado de una orden y todo lo que ello arrastra, atómicamente:
 * ocupación de la bahía, operarios asignados y, al entregar, las comisiones.
 *
 * La bahía se libera al SALIR de `en_proceso`: es cuando el vehículo abandona
 * físicamente la estación de lavado.
 */
create or replace function public.advance_work_order(
  p_order_id     uuid,
  p_new_status   app.order_status,
  p_bay_id       uuid   default null,
  p_assignees    uuid[] default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_order    public.work_orders;
  v_bay      public.bays;
  v_result   public.work_orders;
  v_rows     integer;
  v_profile  uuid;
  v_service  record;
  v_n        integer;
  v_share    bigint;
  v_bps      integer;
begin
  v_company := app.current_company_id();

  -- FOR UPDATE serializa a dos operarios moviendo la misma tarjeta a la vez.
  select * into v_order from public.work_orders
  where id = p_order_id and company_id = v_company
  for update;

  if v_order.id is null then
    raise exception 'Orden % inexistente o fuera de su alcance', p_order_id
      using errcode = 'no_data_found';
  end if;

  if not app.order_transition_allowed(v_order.status, p_new_status) then
    raise exception 'No se puede pasar de "%" a "%"', v_order.status, p_new_status
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------------------- Bahía
  if p_new_status = 'en_proceso' then
    if p_bay_id is null then
      raise exception 'Iniciar el lavado exige indicar la bahía'
        using errcode = 'invalid_parameter_value';
    end if;

    select * into v_bay from public.bays
    where id = p_bay_id and company_id = v_company
    for update;

    if v_bay.id is null then
      raise exception 'Bahía inexistente' using errcode = 'no_data_found';
    end if;
    if v_bay.branch_id <> v_order.branch_id then
      raise exception 'La bahía pertenece a otra sucursal' using errcode = 'check_violation';
    end if;
    if v_bay.status = 'mantenimiento' then
      raise exception 'La bahía "%" está en mantenimiento', v_bay.name
        using errcode = 'check_violation';
    end if;
    -- Comprobación de capacidad que no existía: el Kanban auditado metía TODOS
    -- los vehículos en 'bay-1'.
    if v_bay.current_work_order_id is not null and v_bay.current_work_order_id <> p_order_id then
      raise exception 'La bahía "%" ya está ocupada', v_bay.name
        using errcode = 'unique_violation';
    end if;

    update public.bays
       set status = 'ocupada', current_work_order_id = p_order_id
     where id = p_bay_id;

  elsif v_order.status = 'en_proceso' then
    -- Sale de lavado: la bahía queda libre.
    update public.bays
       set status = 'disponible', current_work_order_id = null, assigned_profile_id = null
     where current_work_order_id = p_order_id and company_id = v_company;
  end if;

  -- --------------------------------------------------------- Operarios
  if p_assignees is not null then
    delete from public.work_order_assignees where work_order_id = p_order_id;
    foreach v_profile in array p_assignees loop
      insert into public.work_order_assignees (work_order_id, profile_id, company_id)
      values (p_order_id, v_profile, v_company)
      on conflict do nothing;
    end loop;
  end if;

  update public.work_orders
     set status = p_new_status,
         bay_id = case when p_new_status = 'en_proceso' then p_bay_id
                       when v_order.status = 'en_proceso' then null
                       else bay_id end
   where id = p_order_id
  returning * into v_result;

  get diagnostics v_rows = row_count;
  -- RLS filtra en silencio en UPDATE: sin esto, un cambio denegado se
  -- mostraría al operario como realizado.
  if v_rows = 0 then
    raise exception 'No tiene permiso para modificar esta orden'
      using errcode = 'insufficient_privilege';
  end if;

  -- -------------------------------------------------------- Comisiones
  -- Se generan al entregar, que es cuando el trabajo está cobrado y cerrado.
  -- En la aplicación auditada la tabla existía y nada la alimentaba.
  if p_new_status = 'entregado' then
    select count(*) into v_n from public.work_order_assignees where work_order_id = p_order_id;

    if v_n > 0 then
      for v_service in
        select i.id, i.name, i.service_id,
               (i.unit_price_cents * i.quantity - i.discount_cents) as line_cents,
               coalesce(s.commission_bps, 0) as service_bps
        from public.work_order_items i
        left join public.services s on s.id = i.service_id
        where i.work_order_id = p_order_id and i.item_type = 'service'
      loop
        -- Reparto exacto entre los operarios: la división entera se hace sobre
        -- la base, no sobre el importe, para no perder centavos por redondeo.
        v_share := v_service.line_cents / v_n;

        insert into public.commissions (
          company_id, branch_id, profile_id, work_order_id, work_order_item_id,
          service_name, base_cents, commission_bps, amount_cents
        )
        select v_company, v_order.branch_id, a.profile_id, p_order_id, v_service.id,
               v_service.name, v_share,
               coalesce(nullif(p.commission_bps, 0), v_service.service_bps),
               round(v_share::numeric
                     * coalesce(nullif(p.commission_bps, 0), v_service.service_bps) / 10000)::bigint
        from public.work_order_assignees a
        join public.profiles p on p.id = a.profile_id
        where a.work_order_id = p_order_id;
      end loop;
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_order.branch_id, 'CAMBIO_ESTADO_ORDEN', 'WorkOrder', p_order_id::text,
          'Orden ' || v_order.order_number || ': ' || v_order.status || ' → ' || p_new_status,
          jsonb_build_object('from', v_order.status, 'to', p_new_status, 'bay_id', p_bay_id));

  return v_result;
end;
$$;

comment on function public.advance_work_order is
  'Cambio de estado atómico: valida la transición, ocupa o libera la bahía, asigna operarios y genera comisiones al entregar.';

grant execute on function public.create_work_order  to authenticated;
grant execute on function public.advance_work_order to authenticated;


-- #############################################################################
-- ###  20260729001100_admin_rpc.sql
-- #############################################################################

-- =============================================================================
-- 0011 · Gastos, métricas y bitácora de integración
-- =============================================================================
-- Últimas piezas de servidor que faltaban para migrar el resto de vistas.
--
--   §4.1  Registrar un gasto tocaba el gasto Y la caja sin atomicidad.
--   M8/M11 Los indicadores "de hoy" sumaban TODO el histórico sin filtro de
--         fecha, y se calculaban recorriendo arrays completos en el navegador.
--   §7.6  La bitácora de sincronización con Membego vivía en memoria y se
--         perdía al refrescar, igual que la de auditoría.
-- =============================================================================

-- ---------------------------------------------------------------- Gastos

alter table public.expenses add column client_request_id text;

create unique index expenses_idempotency_unique
  on public.expenses (company_id, client_request_id)
  where client_request_id is not null;

/**
 * Registra un gasto y, si se paga en efectivo, su salida de caja: o las dos
 * cosas o ninguna.
 */
create or replace function public.create_expense(
  p_branch_id         uuid,
  p_client_request_id text,
  p_description       text,
  p_amount_cents      bigint,
  p_category          app.expense_category default 'varios',
  p_payment_method    app.payment_method default 'efectivo',
  p_supplier_name     text default null,
  p_invoice_ref       text default null,
  p_expense_date      date default null,
  p_cash_session_id   uuid default null
)
returns public.expenses
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_existing public.expenses;
  v_expense  public.expenses;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'El importe del gasto debe ser mayor que cero'
      using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();

  select * into v_existing from public.expenses
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  -- Un gasto en efectivo sin caja abierta no puede registrarse: saldría dinero
  -- de una gaveta que nadie está cuadrando.
  if p_payment_method = 'efectivo' then
    if p_cash_session_id is null
       or not exists (select 1 from public.cash_sessions
                      where id = p_cash_session_id and status = 'open') then
      raise exception 'Un gasto en efectivo exige una caja abierta'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  insert into public.expenses (
    company_id, branch_id, client_request_id, category, description, amount_cents,
    payment_method, supplier_name, invoice_ref, cash_session_id, expense_date, created_by
  ) values (
    v_company, p_branch_id, p_client_request_id, p_category, p_description, p_amount_cents,
    p_payment_method, p_supplier_name, p_invoice_ref, p_cash_session_id,
    coalesce(p_expense_date, current_date), auth.uid()
  )
  returning * into v_expense;

  if p_payment_method = 'efectivo' then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, expense_id, created_by
    ) values (
      v_company, p_cash_session_id, 'outflow', 'efectivo', p_amount_cents,
      'Gasto: ' || p_description, v_expense.id, auth.uid()
    );
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'REGISTRAR_GASTO', 'Expense', v_expense.id::text,
          p_description || ' · ' || p_amount_cents || ' centavos (' || p_payment_method || ')');

  return v_expense;
end;
$$;

-- --------------------------------------------------------------- Métricas

/**
 * Indicadores operativos de un periodo, calculados por el servidor.
 *
 * El panel auditado sumaba TODAS las facturas del histórico bajo el rótulo
 * "Ventas de hoy" y recorría los arrays completos en cada render. Aquí el
 * navegador recibe seis números y el rango de fechas es explícito.
 */
create or replace function public.dashboard_metrics(
  p_branch_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with orders as (
    select * from public.work_orders
    where branch_id = p_branch_id and arrival_at >= p_from and arrival_at < p_to
  ),
  billed as (
    select * from public.invoices
    where branch_id = p_branch_id and created_at >= p_from and created_at < p_to
      and not is_annulled and credits_invoice_id is null
  ),
  queue as (
    select * from public.work_orders
    where branch_id = p_branch_id
      and status not in ('entregado', 'cancelado')
  )
  select jsonb_build_object(
    -- La cola es un estado del ahora, no del periodo: no lleva filtro de fecha.
    'in_queue',        (select count(*) from queue where status in ('pendiente','en_espera','asignada')),
    'in_process',      (select count(*) from queue where status in ('en_proceso','control_calidad')),
    'ready',           (select count(*) from queue where status = 'listo'),
    'arrived',         (select count(*) from orders),
    'delivered',       (select count(*) from orders where status = 'entregado'),
    'membego_orders',  (select count(*) from orders where membego_benefit_id is not null),
    'sales_cents',     (select coalesce(sum(total_cents), 0) from billed),
    'invoice_count',   (select count(*) from billed),
    'avg_ticket_cents',(select case when count(*) = 0 then 0
                          else round(sum(total_cents)::numeric / count(*))::bigint end from billed),
    'annulled_cents',  (select coalesce(sum(total_cents), 0) from public.invoices
                         where branch_id = p_branch_id and created_at >= p_from and created_at < p_to
                           and is_annulled)
  );
$$;

-- ------------------------------------------------- Bitácora de integración

create table public.membego_sync_logs (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  action         text not null,
  idempotency_key text,
  status         text not null check (status in ('success','failed','retry_pending')),
  request_payload  jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message  text,
  actor_id       uuid references public.profiles(id) on delete set null,
  occurred_at    timestamptz not null default now()
);

create index membego_sync_logs_company_time_idx
  on public.membego_sync_logs (company_id, occurred_at desc);

alter table public.membego_sync_logs enable row level security;
alter table public.membego_sync_logs force row level security;

create policy membego_sync_logs_select on public.membego_sync_logs
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy membego_sync_logs_insert on public.membego_sync_logs
  for insert to authenticated with check (app.belongs_to_tenant(company_id));

-- Igual que la auditoría: solo se inserta. Un registro de integración que se
-- puede reescribir no sirve para diagnosticar nada.
revoke update, delete on public.membego_sync_logs from authenticated;

create trigger membego_sync_logs_no_mutation
  before update or delete on public.membego_sync_logs
  for each row execute function app.forbid_audit_mutation();

create or replace function app.stamp_membego_actor()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  new.actor_id   := auth.uid();
  new.occurred_at := now();
  new.company_id := coalesce(app.current_company_id(), new.company_id);
  return new;
end;
$$;

create trigger membego_sync_logs_stamp
  before insert on public.membego_sync_logs
  for each row execute function app.stamp_membego_actor();

grant execute on function public.create_expense     to authenticated;
grant execute on function public.dashboard_metrics  to authenticated;


-- #############################################################################
-- ###  20260729001200_fiscal_status.sql
-- #############################################################################

-- =============================================================================
-- 0012 · Estado fiscal (¿hay NCF utilizables?)
-- =============================================================================
-- La facturación fiscal requiere rangos NCF autorizados por la DGII cargados en
-- `ncf_sequences`. Mientras no los haya, la interfaz debe DESACTIVAR el cobro y
-- decirlo con claridad, en lugar de dejar que el cajero choque contra el error
-- de `allocate_ncf` a mitad de una venta.
--
-- Problema: la política `ncf_sequences_select` solo deja LEER esa tabla a
-- propietario/administrador/contador. Un CAJERO —que es quien usa el POS— no la
-- ve, así que una consulta directa de conteo le daría 0 aunque haya rangos, y le
-- bloquearía el cobro para siempre.
--
-- Solución: una función SECURITY DEFINER que revela SOLO un booleano (y los
-- tipos disponibles), acotado a la empresa del propio usuario. No expone rangos,
-- números ni fechas: nada sensible. Cualquier rol del tenant puede llamarla.
-- =============================================================================

create or replace function public.fiscal_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with usable as (
    select s.ncf_type
    from public.ncf_sequences s
    where s.company_id = app.current_company_id()
      and s.is_active
      and s.next_value <= s.range_end        -- rango no agotado
      and s.authorized_until >= current_date -- autorización vigente
  )
  select jsonb_build_object(
    'ready', exists (select 1 from usable),
    'types', coalesce((select jsonb_agg(distinct ncf_type order by ncf_type) from usable), '[]'::jsonb)
  );
$$;

comment on function public.fiscal_status is
  'Booleano de preparación fiscal + tipos NCF utilizables, acotado a la empresa del usuario. '
  'SECURITY DEFINER para que también el cajero (que no puede leer ncf_sequences) sepa si puede facturar.';

-- Sin empresa asignada, current_company_id() es null y no hay filas: ready=false.
-- Fallo cerrado, coherente con el resto del sistema.
grant execute on function public.fiscal_status() to authenticated;


-- #############################################################################
-- ###  20260729001300_employees_rpc.sql
-- #############################################################################

-- =============================================================================
-- 0013 · Alta de empleados desde la interfaz
-- =============================================================================
-- El propietario/administrador necesita crear los usuarios de su equipo (cajero,
-- lavador, supervisor, ...) sin entrar al panel de Supabase ni escribir SQL.
--
-- Crear un usuario de acceso para OTRA persona no se puede hacer con seguridad
-- desde el navegador: la API de administración de auth exige la service_role,
-- que jamás debe viajar al cliente. La vía correcta y verificable es esta
-- función SECURITY DEFINER, que:
--   * comprueba que quien llama es propietario/administrador de una empresa,
--   * aplica el techo de rol (nadie crea un rol por encima del suyo),
--   * fuerza el tenant al del llamante (no puede colar usuarios en otra empresa),
--   * crea el usuario de acceso confirmado y su identidad,
--   * completa el perfil con empresa, sucursal y rol.
-- =============================================================================

create or replace function public.create_employee(
  p_email          text,
  p_password       text,
  p_full_name      text,
  p_role           app.user_role,
  p_branch_id      uuid    default null,
  p_phone          text    default null,
  p_commission_bps integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company     uuid := app.current_company_id();
  v_caller_role app.user_role := app.current_role();
  v_uid         uuid := gen_random_uuid();
  v_profile     public.profiles;
begin
  -- 1. El llamante pertenece a una empresa y puede gestionar personal.
  if v_company is null then
    raise exception 'No perteneces a ninguna empresa.' using errcode = 'check_violation';
  end if;
  if v_caller_role not in ('propietario', 'administrador', 'superadmin') then
    raise exception 'Tu rol no permite dar de alta empleados.' using errcode = 'insufficient_privilege';
  end if;

  -- 2. Techo de rol: solo un propietario/superadmin puede crear otro.
  if p_role in ('propietario', 'superadmin')
     and v_caller_role not in ('propietario', 'superadmin') then
    raise exception 'No puedes crear un usuario con el rol %.', p_role using errcode = 'insufficient_privilege';
  end if;

  -- 3. La sucursal, si se indica, debe ser de la empresa del llamante.
  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.company_id = v_company
  ) then
    raise exception 'La sucursal indicada no pertenece a tu empresa.' using errcode = 'check_violation';
  end if;

  -- 4. Validaciones de credenciales.
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'Correo electrónico inválido.' using errcode = 'check_violation';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from auth.users where lower(email) = lower(trim(p_email))) then
    raise exception 'Ya existe un usuario con el correo %.', p_email using errcode = 'unique_violation';
  end if;

  -- 5. Usuario de acceso, confirmado (puede entrar de inmediato) y su identidad.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(trim(p_email)), crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name)),
    '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email)), 'email_verified', true),
    'email', now(), now(), now()
  );

  -- 6. El trigger on_auth_user_created creó el perfil vacío; lo completamos con
  --    el tenant del llamante, la sucursal y el rol.
  update public.profiles
  set company_id     = v_company,
      branch_id      = p_branch_id,
      role           = p_role,
      full_name      = trim(p_full_name),
      phone          = p_phone,
      email          = lower(trim(p_email)),
      commission_bps = p_commission_bps,
      is_active      = true
  where id = v_uid
  returning * into v_profile;

  -- 7. Bitácora (el actor lo sella el servidor por trigger).
  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ALTA_EMPLEADO', 'Profile', v_uid::text,
          trim(p_full_name) || ' (' || p_role || ')');

  return v_profile;
end;
$$;

comment on function public.create_employee is
  'Alta de empleado: crea el usuario de acceso y su perfil en la empresa del llamante. '
  'Solo propietario/administrador; aplica techo de rol y aislamiento de tenant.';

grant execute on function
  public.create_employee(text, text, text, app.user_role, uuid, text, integer)
  to authenticated;


-- #############################################################################
-- ###  20260729001400_membego_integration.sql
-- #############################################################################

-- =============================================================================
-- 0014 · Integración con Membego (lado satélite receptor)
-- =============================================================================
-- Membego es el hub de identidad y fidelización; este car wash es un satélite.
-- Membego EMPUJA eventos firmados (HMAC) a un webhook; la función serverless de
-- Vercel verifica la firma y reenvía el sobre a `membego_ingest_event`, que hace
-- todo el trabajo con aislamiento por empresa.
--
-- Contrato: docs/INTEGRACIONES.md (lo entrega Membego). Cada evento trae un
-- `companyId` de Membego que se mapea a UNA empresa de este sistema. Un cliente
-- solo entra en un car wash cuando Membego emite un evento suyo para ESA empresa.
-- =============================================================================

-- ------------------------------------ Mapa empresa Membego (companyId) ↔ empresa
create table public.membego_company_links (
  company_id         uuid primary key references public.companies(id) on delete cascade,
  membego_company_id text not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (membego_company_id)   -- una empresa de Membego mapea a UNA empresa aquí
);

create trigger membego_company_links_touch before update on public.membego_company_links
  for each row execute function app.touch_updated_at();

-- ------------------------------------------- Idempotencia de eventos de webhook
create table public.membego_webhook_events (
  event_id     text primary key,     -- id del evento en Membego (clave de idempotencia)
  company_id   uuid not null references public.companies(id) on delete cascade,
  tipo         text not null,
  received_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- Membresías
create table public.memberships (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  customer_id           uuid not null,
  membego_membership_id text not null,
  plan_name             text not null default '',
  tier                  text,
  status                text not null default 'active'
                          check (status in ('active', 'paused', 'cancelled', 'expired')),
  is_paid               boolean not null default false,
  valid_from            date,
  valid_until           date,
  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, membego_membership_id),
  constraint memberships_customer_same_company
    foreign key (customer_id, company_id) references public.customers(id, company_id) on delete cascade
);

create index memberships_customer_idx on public.memberships (customer_id);
create index memberships_company_idx  on public.memberships (company_id) where status = 'active';

create trigger memberships_touch before update on public.memberships
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------- Promociones / ofertas
create table public.customer_promotions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  customer_id           uuid not null,
  membego_promotion_id  text not null,
  code                  text,
  title                 text not null default '',
  kind                  text not null default 'free' check (kind in ('free', 'paid')),
  status                text not null default 'available'
                          check (status in ('available', 'redeemed', 'expired', 'cancelled')),
  value_cents           bigint not null default 0 check (value_cents >= 0),
  acquired_at           timestamptz not null default now(),
  redeemed_at           timestamptz,
  expires_at            timestamptz,
  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, membego_promotion_id),
  constraint promotions_customer_same_company
    foreign key (customer_id, company_id) references public.customers(id, company_id) on delete cascade
);

create index promotions_customer_idx  on public.customer_promotions (customer_id);
create index promotions_available_idx on public.customer_promotions (company_id) where status = 'available';

create trigger customer_promotions_touch before update on public.customer_promotions
  for each row execute function app.touch_updated_at();

-- ============================================================ RLS (solo lectura)
-- Las escrituras entran solo por membego_ingest_event (SECURITY DEFINER). Desde
-- el cliente estas tablas son de solo lectura y acotadas al tenant.
alter table public.membego_company_links  enable row level security;
alter table public.membego_company_links  force  row level security;
alter table public.membego_webhook_events enable row level security;
alter table public.membego_webhook_events force  row level security;
alter table public.memberships            enable row level security;
alter table public.memberships            force  row level security;
alter table public.customer_promotions    enable row level security;
alter table public.customer_promotions    force  row level security;

create policy membego_company_links_select on public.membego_company_links
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'superadmin'));

create policy memberships_select on public.memberships
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy customer_promotions_select on public.customer_promotions
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- membego_webhook_events no se lee desde el cliente: sin políticas (acceso nulo).

grant select on public.membego_company_links, public.memberships, public.customer_promotions
  to authenticated;

-- ============================================================ Resolución
create or replace function app.membego_company(p_membego_company_id text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from public.membego_company_links
  where membego_company_id = p_membego_company_id and is_active
$$;

-- ============================================================ Vinculación (dueño)
-- El propietario mapea el companyId que Membego le asignó a SU empresa aquí.
create or replace function public.membego_link_company(p_membego_company_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_company uuid := app.current_company_id();
begin
  if v_company is null or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Solo el propietario o un administrador puede vincular la empresa de Membego.'
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.membego_company_links (company_id, membego_company_id)
  values (v_company, trim(p_membego_company_id))
  on conflict (company_id) do update
    set membego_company_id = excluded.membego_company_id, is_active = true, updated_at = now();
end;
$$;

grant execute on function public.membego_link_company(text) to authenticated;

-- ============================================================ Ingestión (webhook)
-- La llama la función de Vercel (service_role) DESPUÉS de verificar la firma HMAC.
-- Idempotente por event_id; enruta por companyId al tenant; despacha por tipo.
-- Devuelve {handled, reason, ...}. Nunca lanza por un tipo desconocido: lo ignora.
create or replace function public.membego_ingest_event(
  p_event_id           text,
  p_tipo               text,
  p_membego_company_id text,
  p_payload            jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid := app.membego_company(p_membego_company_id);
  v_cliente   text := p_payload ->> 'clienteId';
  v_nombre    text := coalesce(nullif(trim(p_payload #>> '{cliente,nombre}'), ''), 'Cliente Membego');
  v_plan      text := p_payload #>> '{membresia,plan}';
  v_compratipo text := lower(coalesce(p_payload #>> '{compra,tipo}', ''));
  v_is_paid   boolean := v_compratipo in ('pago', 'paid', 'membresia', 'membresía');
  v_monto     numeric := nullif(p_payload #>> '{compra,monto}', '')::numeric;
  v_value     bigint := coalesce(round(v_monto * 100), 0);
  v_customer  uuid;
  v_new       integer;
begin
  if v_company is null then
    -- Empresa no vinculada aún en este sistema: se ignora (200), sin registrar.
    return jsonb_build_object('handled', false, 'reason', 'unknown_company');
  end if;

  -- Idempotencia: si ya procesamos este evento, no repetimos el efecto.
  insert into public.membego_webhook_events (event_id, company_id, tipo)
  values (p_event_id, v_company, p_tipo)
  on conflict (event_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return jsonb_build_object('handled', false, 'reason', 'duplicate');
  end if;

  -- Casi todos los eventos giran en torno a un cliente: se crea/enlaza en ESTA
  -- empresa. Aquí es donde el cliente "aparece" en el car wash.
  if v_cliente is not null then
    insert into public.customers (company_id, name, membego_customer_id, membego_status)
    values (v_company, v_nombre, v_cliente, 'active')
    on conflict (company_id, membego_customer_id) where membego_customer_id is not null
      do update set
        name           = coalesce(nullif(trim(excluded.name), 'Cliente Membego'), public.customers.name),
        membego_status = 'active',
        updated_at     = now()
    returning id into v_customer;
  end if;

  -- Membresía: activación o compra de una membresía.
  if v_customer is not null and (p_tipo = 'membresia.activada'
       or (p_tipo in ('cliente.compro_servicio', 'cliente.primera_compra') and v_plan is not null)) then
    insert into public.memberships
      (company_id, customer_id, membego_membership_id, plan_name, status, is_paid, raw)
    values
      (v_company, v_customer,
       coalesce(p_payload #>> '{membresia,id}', 'plan:' || coalesce(v_plan, '') || ':' || v_cliente),
       coalesce(v_plan, ''), 'active', v_is_paid, p_payload)
    on conflict (company_id, membego_membership_id) do update
      set plan_name = excluded.plan_name, status = 'active',
          is_paid = excluded.is_paid, raw = excluded.raw, updated_at = now();

  -- Compra de una oferta (no membresía) → promoción.
  elsif v_customer is not null and p_tipo in ('cliente.compro_servicio', 'cliente.primera_compra') then
    insert into public.customer_promotions
      (company_id, customer_id, membego_promotion_id, title, kind, value_cents, raw)
    values
      (v_company, v_customer,
       coalesce(p_payload #>> '{oferta,id}', p_payload #>> '{compra,id}', p_event_id),
       coalesce(nullif(p_payload #>> '{oferta,titulo}', ''), 'Compra Membego'),
       case when v_is_paid then 'paid' else 'free' end, v_value, p_payload)
    on conflict (company_id, membego_promotion_id) do update
      set title = excluded.title, value_cents = excluded.value_cents, raw = excluded.raw, updated_at = now();
  end if;

  insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
  values (v_company, p_tipo, p_event_id, 'success', p_payload);

  return jsonb_build_object('handled', true, 'company_id', v_company, 'customer_id', v_customer, 'tipo', p_tipo);
end;
$$;

comment on function public.membego_ingest_event is
  'Procesa un evento de webhook de Membego: idempotente por event_id, acotado al '
  'tenant por companyId, despacha por tipo. La firma HMAC la verifica el borde (Vercel).';

grant execute on function public.membego_ingest_event(text, text, text, jsonb) to service_role;


-- #############################################################################
-- ###  20260729001500_membego_sso.sql
-- #############################################################################

-- =============================================================================
-- 0015 · SSO de empleados desde Membego
-- =============================================================================
-- Membego redirige al empleado a /sso/membego con un token firmado (HMAC, vence
-- en 90 s). La función serverless verifica la firma (en el borde) y llama a esta
-- función con la service_role para asegurar el usuario local y su perfil en la
-- empresa del token, con el rol mapeado. Luego el borde acuña la sesión de
-- Supabase (magic link) y redirige al panel.
--
-- Roles Membego → roles del car wash:
--   ADMIN_EMPRESA → administrador   GERENTE   → supervisor
--   RECEPCION     → recepcionista   EMPLEADO  → operario
--   SUPERADMIN    → superadmin      (otro)    → operario
-- =============================================================================

create or replace function public.membego_sso_upsert_user(
  p_membego_company_id text,
  p_sub                text,   -- id estable del usuario en Membego
  p_email              text,
  p_rol                text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.membego_company(p_membego_company_id);
  v_role    app.user_role;
  v_uid     uuid;
begin
  if v_company is null then
    raise exception 'La empresa de Membego (%) no está vinculada en este sistema.', p_membego_company_id
      using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'El token de Membego no trae un correo válido.' using errcode = 'check_violation';
  end if;

  v_role := case upper(coalesce(p_rol, ''))
    when 'ADMIN_EMPRESA' then 'administrador'
    when 'GERENTE'       then 'supervisor'
    when 'RECEPCION'     then 'recepcionista'
    when 'EMPLEADO'      then 'operario'
    when 'SUPERADMIN'    then 'superadmin'
    else 'operario'
  end::app.user_role;

  -- El usuario se enlaza por correo (identidad de Membego). Si no existe, se crea
  -- con clave aleatoria: nunca la usa, entra siempre por SSO (magic link).
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      lower(trim(p_email)), crypt(encode(gen_random_bytes(18), 'hex'), gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('membego_sub', p_sub), '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email)), 'email_verified', true),
      'email', now(), now(), now());
  end if;

  -- Perfil en la empresa del token, con el rol mapeado. El trigger de alta ya
  -- creó el perfil vacío si el usuario es nuevo; aquí lo completamos/actualizamos.
  update public.profiles
     set company_id = v_company, role = v_role, email = lower(trim(p_email)), is_active = true
   where id = v_uid;

  return v_uid;
end;
$$;

comment on function public.membego_sso_upsert_user is
  'SSO Membego: asegura el usuario local y su perfil en la empresa del token, con el rol mapeado. La verifica la firma el borde.';

grant execute on function public.membego_sso_upsert_user(text, text, text, text) to service_role;

