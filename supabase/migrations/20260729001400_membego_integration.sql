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
