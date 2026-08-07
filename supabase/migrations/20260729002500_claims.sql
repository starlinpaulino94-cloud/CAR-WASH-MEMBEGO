-- =============================================================================
-- 0027 · Reclamos e incidentes
-- =============================================================================
-- Un reclamo por un rayón, un objeto perdido o un lavado mal hecho se resolvía
-- de palabra. Sin registro no hay causa raíz, ni costo asumido, ni patrón.
--
--   · claims: el reclamo con su tipo, la orden y el cliente implicados, quién
--     lo atiende, la resolución, el costo que asumió el car wash y su estado.
--   · claim_events: la bitácora del reclamo — cada nota o cambio de estado,
--     append-only, para reconstruir cómo se manejó.
--
-- La inspección de recepción (0023) es la defensa: si el daño estaba marcado
-- y firmado antes del servicio, el reclamo se cierra con evidencia.
-- =============================================================================

create type app.claim_kind as enum
  ('dano_vehiculo', 'objeto_perdido', 'servicio_deficiente', 'cobro', 'demora', 'otro');
create type app.claim_status as enum ('abierto', 'en_revision', 'resuelto', 'rechazado');

create table public.claims (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  work_order_id  uuid,
  customer_id    uuid,
  customer_name  text not null check (length(trim(customer_name)) > 0),
  customer_phone text,
  kind           app.claim_kind not null default 'otro',
  status         app.claim_status not null default 'abierto',
  description    text not null check (length(trim(description)) >= 10),
  -- Quién lo atiende y quién resultó responsable (si aplica).
  assignee_id    uuid references public.profiles(id) on delete set null,
  responsible_id uuid references public.profiles(id) on delete set null,
  resolution     text,
  -- Lo que costó al car wash: reembolso, repintado, servicio repetido…
  cost_cents     bigint not null default 0 check (cost_cents >= 0),
  root_cause     text,
  resolved_at    timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, company_id),
  constraint claims_order_same_company
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete set null,
  constraint claims_customer_same_company
    foreign key (customer_id, company_id) references public.customers(id, company_id) on delete set null,
  -- Cerrar un reclamo exige decir cómo se resolvió.
  constraint claims_closed_is_explained check (
    status not in ('resuelto', 'rechazado')
    or (resolution is not null and length(trim(resolution)) >= 5 and resolved_at is not null)
  )
);

create index claims_company_time_idx on public.claims (company_id, created_at desc);
create index claims_open_idx on public.claims (company_id, status)
  where status in ('abierto', 'en_revision');
create index claims_order_idx on public.claims (work_order_id) where work_order_id is not null;
create index claims_customer_idx on public.claims (customer_id) where customer_id is not null;

create trigger claims_touch before update on public.claims
  for each row execute function app.touch_updated_at();

-- Bitácora del reclamo: solo se agrega, nunca se reescribe.
create table public.claim_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  claim_id    uuid not null,
  note        text not null check (length(trim(note)) > 0),
  status_from app.claim_status,
  status_to   app.claim_status,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint claim_events_claim_same_company
    foreign key (claim_id, company_id) references public.claims(id, company_id) on delete cascade
);

create index claim_events_claim_idx on public.claim_events (claim_id, created_at);

-- Append-only: la historia de un reclamo no se corrige, se continúa.
create or replace function app.claim_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La bitácora del reclamo es de solo inserción: agregue una nota nueva.'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger claim_events_no_mutation
  before update or delete on public.claim_events
  for each row execute function app.claim_events_append_only();

-- ================================================================== RLS
alter table public.claims       enable row level security;
alter table public.claims       force  row level security;
alter table public.claim_events enable row level security;
alter table public.claim_events force  row level security;

create policy claims_select on public.claims
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Quien atiende al cliente puede levantar un reclamo; cerrarlo va por RPC.
create policy claims_write on public.claims
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor',
                          'recepcionista', 'cajero', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor',
                               'recepcionista', 'cajero', 'superadmin'));

create policy claim_events_select on public.claim_events
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Igual que la auditoría: cualquiera del tenant deja constancia, el trigger
-- de arriba impide reescribirla. Sin esta política, los RPCs (SECURITY
-- INVOKER a propósito, para conservar RLS sobre claims) no podrían anotar.
create policy claim_events_insert on public.claim_events
  for insert to authenticated with check (app.belongs_to_tenant(company_id));

grant select, insert, update on public.claims to authenticated;
grant select, insert on public.claim_events to authenticated;
revoke update, delete on public.claim_events from authenticated;

-- ------------------------------------------------------ Registrar un reclamo
create or replace function public.open_claim(
  p_customer_name  text,
  p_kind           app.claim_kind,
  p_description    text,
  p_work_order_id  uuid default null,
  p_customer_id    uuid default null,
  p_customer_phone text default null
)
returns public.claims
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_branch  uuid := app.current_branch_id();
  v_claim   public.claims;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor',
                         'recepcionista', 'cajero', 'superadmin') then
    raise exception 'Su rol no permite registrar reclamos.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Indique el nombre del cliente que reclama.' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_description, ''))) < 10 then
    raise exception 'Describa el reclamo (mínimo 10 caracteres).' using errcode = 'check_violation';
  end if;
  if p_work_order_id is not null
     and not exists (select 1 from public.work_orders
                     where id = p_work_order_id and company_id = v_company) then
    raise exception 'La orden indicada no pertenece a su empresa.' using errcode = 'no_data_found';
  end if;

  insert into public.claims (
    company_id, branch_id, work_order_id, customer_id, customer_name,
    customer_phone, kind, description, created_by
  ) values (
    v_company, v_branch, p_work_order_id, p_customer_id, trim(p_customer_name),
    p_customer_phone, p_kind, trim(p_description), auth.uid()
  ) returning * into v_claim;

  insert into public.claim_events (company_id, claim_id, note, status_to, created_by)
  values (v_company, v_claim.id, 'Reclamo registrado: ' || trim(p_description), 'abierto', auth.uid());

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_branch, 'ABRIR_RECLAMO', 'claim', v_claim.id,
          format('%s · %s', trim(p_customer_name), p_kind));

  return v_claim;
end;
$$;

grant execute on function public.open_claim(text, app.claim_kind, text, uuid, uuid, text) to authenticated;

-- ------------------------------------------- Anotar o cambiar el estado
create or replace function public.add_claim_note(
  p_claim_id  uuid,
  p_note      text,
  p_status    app.claim_status default null
)
returns public.claims
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_claim   public.claims;
  v_from    app.claim_status;
begin
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'La nota no puede estar vacía.' using errcode = 'check_violation';
  end if;

  select * into v_claim from public.claims
  where id = p_claim_id and company_id = v_company for update;
  if v_claim.id is null then
    raise exception 'Reclamo inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  v_from := v_claim.status;

  if p_status is not null and p_status <> v_from then
    if p_status in ('resuelto', 'rechazado') then
      raise exception 'Para cerrar un reclamo use resolve_claim: exige resolución y costo.'
        using errcode = 'check_violation';
    end if;
    update public.claims set status = p_status where id = p_claim_id
    returning * into v_claim;
  end if;

  insert into public.claim_events (company_id, claim_id, note, status_from, status_to, created_by)
  values (v_company, p_claim_id, trim(p_note), v_from, coalesce(p_status, v_from), auth.uid());

  return v_claim;
end;
$$;

grant execute on function public.add_claim_note(uuid, text, app.claim_status) to authenticated;

-- --------------------------------------------------------- Cerrar el reclamo
-- Exige resolución y, si el car wash asumió un costo, cuánto. La causa raíz es
-- lo que convierte el reclamo en aprendizaje.
create or replace function public.resolve_claim(
  p_claim_id       uuid,
  p_status         app.claim_status,
  p_resolution     text,
  p_cost_cents     bigint default 0,
  p_root_cause     text default null,
  p_responsible_id uuid default null
)
returns public.claims
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_claim   public.claims;
  v_from    app.claim_status;
begin
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite cerrar reclamos.' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('resuelto', 'rechazado') then
    raise exception 'Cerrar un reclamo exige resuelto o rechazado.' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_resolution, ''))) < 5 then
    raise exception 'Explique cómo se resolvió (mínimo 5 caracteres).' using errcode = 'check_violation';
  end if;
  if coalesce(p_cost_cents, 0) < 0 then
    raise exception 'El costo asumido no puede ser negativo.' using errcode = 'check_violation';
  end if;

  select * into v_claim from public.claims
  where id = p_claim_id and company_id = v_company for update;
  if v_claim.id is null then
    raise exception 'Reclamo inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_claim.status in ('resuelto', 'rechazado') then
    raise exception 'Este reclamo ya está cerrado.' using errcode = 'check_violation';
  end if;
  v_from := v_claim.status;

  update public.claims
     set status = p_status, resolution = trim(p_resolution),
         cost_cents = coalesce(p_cost_cents, 0), root_cause = p_root_cause,
         responsible_id = p_responsible_id, resolved_at = now()
   where id = p_claim_id and company_id = v_company
  returning * into v_claim;

  insert into public.claim_events (company_id, claim_id, note, status_from, status_to, created_by)
  values (v_company, p_claim_id,
          format('%s: %s', case when p_status = 'resuelto' then 'Resuelto' else 'Rechazado' end,
                 trim(p_resolution)),
          v_from, p_status, auth.uid());

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_claim.branch_id, 'CERRAR_RECLAMO', 'claim', p_claim_id,
          format('%s · %s · costo %s', v_claim.customer_name, p_status, coalesce(p_cost_cents, 0)));

  return v_claim;
end;
$$;

grant execute on function public.resolve_claim(uuid, app.claim_status, text, bigint, text, uuid) to authenticated;

comment on table public.claims is
  'Reclamos e incidentes: daño, objeto perdido, servicio deficiente. Cerrarlos '
  'exige resolución; el costo asumido y la causa raíz alimentan la mejora.';
