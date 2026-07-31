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
