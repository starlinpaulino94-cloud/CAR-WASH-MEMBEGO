-- =============================================================================
-- 0014 · Integración con Membego (lado receptor)
-- =============================================================================
-- Membego es la capa de fidelización. Cada car wash es un "comercio" en Membego
-- con su propio id; aquí lo mapeamos a una empresa (company_id). Membego avisa a
-- este sistema (server-to-server) cuando un cliente SIGUE al comercio, o cuando
-- adquiere/canjea una membresía o promoción — y cada evento entra SOLO en la
-- empresa de ese comercio. Un cliente jamás aparece en un car wash por existir
-- en Membego: solo cuando tiene una relación real con ESE car wash.
--
-- Este archivo construye el lado de este sistema (verificable con SQL). El lado
-- de Membego (llamar a estos endpoints) lo implementa el equipo de Membego según
-- el contrato en docs/INTEGRACION-MEMBEGO.md.
-- =============================================================================

-- ---------------------------------------------- Mapa comercio Membego ↔ empresa
create table public.membego_merchants (
  company_id           uuid primary key references public.companies(id) on delete cascade,
  membego_merchant_id  text not null,
  -- Secreto de webhook, guardado HASHEADO (sha256). El texto plano se muestra
  -- una sola vez al vincular; Membego lo envía en cada llamada.
  webhook_secret_hash  text not null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (membego_merchant_id)   -- un comercio de Membego pertenece a UNA empresa
);

create trigger membego_merchants_touch before update on public.membego_merchants
  for each row execute function app.touch_updated_at();

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
  -- Integridad de tenant: la membresía y su cliente comparten empresa.
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
  -- Gratis o de pago, como pidió el negocio.
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

create index promotions_customer_idx on public.customer_promotions (customer_id);
create index promotions_available_idx on public.customer_promotions (company_id) where status = 'available';

create trigger customer_promotions_touch before update on public.customer_promotions
  for each row execute function app.touch_updated_at();

-- ============================================================ RLS (solo lectura)
-- Las escrituras entran únicamente por las funciones de ingestión (más abajo),
-- que son SECURITY DEFINER. Desde el cliente estas tablas son de solo lectura y
-- acotadas al tenant, igual que el resto del sistema.

alter table public.membego_merchants     enable row level security;
alter table public.membego_merchants     force  row level security;
alter table public.memberships           enable row level security;
alter table public.memberships           force  row level security;
alter table public.customer_promotions   enable row level security;
alter table public.customer_promotions   force  row level security;

create policy membego_merchants_select on public.membego_merchants
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'superadmin'));

create policy memberships_select on public.memberships
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy customer_promotions_select on public.customer_promotions
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

grant select on public.membego_merchants, public.memberships, public.customer_promotions
  to authenticated;

-- ============================================================ Resolución segura
-- Traduce (comercio Membego + secreto) a la empresa. Devuelve NULL si el comercio
-- no existe, está inactivo o el secreto no coincide. SECURITY DEFINER para poder
-- comprobar el hash sin exponer la tabla.
create or replace function app.membego_merchant_company(p_merchant_id text, p_secret text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id
  from public.membego_merchants
  where membego_merchant_id = p_merchant_id
    and is_active
    and webhook_secret_hash = encode(digest(p_secret, 'sha256'), 'hex')
$$;

-- ============================================================ Vinculación (dueño)
-- El propietario/administrador vincula su comercio de Membego y obtiene el
-- secreto UNA vez (para configurarlo en Membego). Reejecutar rota el secreto.
create or replace function public.membego_link_merchant(p_membego_merchant_id text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_secret  text := encode(gen_random_bytes(24), 'hex');
begin
  if v_company is null or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Solo el propietario o un administrador puede vincular el comercio de Membego.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.membego_merchants (company_id, membego_merchant_id, webhook_secret_hash)
  values (v_company, trim(p_membego_merchant_id), encode(digest(v_secret, 'sha256'), 'hex'))
  on conflict (company_id) do update
    set membego_merchant_id = excluded.membego_merchant_id,
        webhook_secret_hash = excluded.webhook_secret_hash,
        is_active           = true,
        updated_at          = now();

  return v_secret;   -- se muestra una sola vez
end;
$$;

comment on function public.membego_link_merchant is
  'Vincula el comercio de Membego a la empresa del llamante y devuelve el secreto de webhook (una sola vez).';

-- ============================================================ Ingestión (Membego)
-- Estas funciones las llama el backend de Membego (server-to-server) con la
-- service_role y el secreto del comercio. Cada una resuelve la empresa a partir
-- del comercio y escribe SOLO en esa empresa.

-- 1) El cliente se registró en Membego y SIGUE a este comercio → alta/enlace.
create or replace function public.membego_sync_customer(
  p_merchant_id         text,
  p_secret              text,
  p_membego_customer_id text,
  p_name                text,
  p_phone               text default null,
  p_email               text default null,
  p_tier                text default null,
  p_status              app.membego_status default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.membego_merchant_company(p_merchant_id, p_secret);
  v_customer uuid;
begin
  if v_company is null then
    raise exception 'Comercio o secreto de Membego inválido.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.customers
    (company_id, name, phone, email, membego_customer_id, membego_status, membego_tier)
  values
    (v_company, coalesce(nullif(trim(p_name), ''), 'Cliente Membego'),
     p_phone, p_email, p_membego_customer_id, p_status, p_tier)
  on conflict (company_id, membego_customer_id) where membego_customer_id is not null
    do update set
      name           = excluded.name,
      phone          = coalesce(excluded.phone, public.customers.phone),
      email          = coalesce(excluded.email, public.customers.email),
      membego_status = excluded.membego_status,
      membego_tier   = excluded.membego_tier,
      updated_at     = now()
  returning id into v_customer;

  insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
  values (v_company, 'sync_customer', p_merchant_id || ':' || p_membego_customer_id, 'success',
          jsonb_build_object('membego_customer_id', p_membego_customer_id));

  return v_customer;
end;
$$;

-- 2) El cliente adquirió/renovó una membresía en este comercio.
create or replace function public.membego_grant_membership(
  p_merchant_id         text,
  p_secret              text,
  p_membego_customer_id text,
  p_membership_id       text,
  p_plan_name           text,
  p_tier                text    default null,
  p_status              text    default 'active',
  p_is_paid             boolean default false,
  p_valid_from          date    default null,
  p_valid_until         date    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company    uuid := app.membego_merchant_company(p_merchant_id, p_secret);
  v_customer   uuid;
  v_membership uuid;
begin
  if v_company is null then
    raise exception 'Comercio o secreto de Membego inválido.' using errcode = 'insufficient_privilege';
  end if;

  -- El cliente debe existir en ESTA empresa (haber seguido antes). Si no, se crea
  -- el enlace mínimo: adquirir una membresía es, de hecho, una relación.
  v_customer := public.membego_sync_customer(p_merchant_id, p_secret, p_membego_customer_id, 'Cliente Membego');

  insert into public.memberships
    (company_id, customer_id, membego_membership_id, plan_name, tier, status, is_paid, valid_from, valid_until)
  values
    (v_company, v_customer, p_membership_id, coalesce(p_plan_name, ''), p_tier,
     coalesce(p_status, 'active'), coalesce(p_is_paid, false), p_valid_from, p_valid_until)
  on conflict (company_id, membego_membership_id) do update
    set plan_name = excluded.plan_name, tier = excluded.tier, status = excluded.status,
        is_paid = excluded.is_paid, valid_from = excluded.valid_from,
        valid_until = excluded.valid_until, updated_at = now()
  returning id into v_membership;

  insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
  values (v_company, 'grant_membership', p_merchant_id || ':' || p_membership_id, 'success',
          jsonb_build_object('membership_id', p_membership_id, 'plan', p_plan_name));

  return v_membership;
end;
$$;

-- 3) El cliente adquirió una promoción/oferta (gratis o de pago) en este comercio.
create or replace function public.membego_grant_promotion(
  p_merchant_id         text,
  p_secret              text,
  p_membego_customer_id text,
  p_promotion_id        text,
  p_title               text,
  p_kind                text    default 'free',
  p_code                text    default null,
  p_value_cents         bigint  default 0,
  p_expires_at          timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid := app.membego_merchant_company(p_merchant_id, p_secret);
  v_customer  uuid;
  v_promotion uuid;
begin
  if v_company is null then
    raise exception 'Comercio o secreto de Membego inválido.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('free', 'paid') then
    raise exception 'El tipo de promoción debe ser free o paid.' using errcode = 'check_violation';
  end if;

  v_customer := public.membego_sync_customer(p_merchant_id, p_secret, p_membego_customer_id, 'Cliente Membego');

  insert into public.customer_promotions
    (company_id, customer_id, membego_promotion_id, code, title, kind, value_cents, expires_at)
  values
    (v_company, v_customer, p_promotion_id, p_code, coalesce(p_title, ''), p_kind,
     coalesce(p_value_cents, 0), p_expires_at)
  on conflict (company_id, membego_promotion_id) do update
    set code = excluded.code, title = excluded.title, kind = excluded.kind,
        value_cents = excluded.value_cents, expires_at = excluded.expires_at,
        -- No revive una promoción ya canjeada.
        status = case when public.customer_promotions.status = 'redeemed'
                      then public.customer_promotions.status else 'available' end,
        updated_at = now()
  returning id into v_promotion;

  insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
  values (v_company, 'grant_promotion', p_merchant_id || ':' || p_promotion_id, 'success',
          jsonb_build_object('promotion_id', p_promotion_id, 'kind', p_kind));

  return v_promotion;
end;
$$;

-- 4) Membego marca una promoción como canjeada (o la cancela/expira).
create or replace function public.membego_set_promotion_status(
  p_merchant_id  text,
  p_secret       text,
  p_promotion_id text,
  p_status       text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.membego_merchant_company(p_merchant_id, p_secret);
  v_rows    integer;
begin
  if v_company is null then
    raise exception 'Comercio o secreto de Membego inválido.' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('available', 'redeemed', 'expired', 'cancelled') then
    raise exception 'Estado de promoción inválido.' using errcode = 'check_violation';
  end if;

  update public.customer_promotions
    set status      = p_status,
        redeemed_at = case when p_status = 'redeemed' then now() else redeemed_at end,
        updated_at  = now()
  where company_id = v_company and membego_promotion_id = p_promotion_id;
  get diagnostics v_rows = row_count;

  insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
  values (v_company, 'set_promotion_status', p_merchant_id || ':' || p_promotion_id, 'success',
          jsonb_build_object('promotion_id', p_promotion_id, 'status', p_status));

  return v_rows > 0;
end;
$$;

-- Vinculación: la usa el dueño desde la app (rol authenticated).
grant execute on function public.membego_link_merchant(text) to authenticated;

-- Ingestión: la usa el backend de Membego con la service_role.
grant execute on function public.membego_sync_customer(text, text, text, text, text, text, text, app.membego_status) to service_role;
grant execute on function public.membego_grant_membership(text, text, text, text, text, text, text, boolean, date, date) to service_role;
grant execute on function public.membego_grant_promotion(text, text, text, text, text, text, text, bigint, timestamptz) to service_role;
grant execute on function public.membego_set_promotion_status(text, text, text, text) to service_role;
