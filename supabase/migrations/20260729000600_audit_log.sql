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
