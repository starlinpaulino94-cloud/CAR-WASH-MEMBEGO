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
