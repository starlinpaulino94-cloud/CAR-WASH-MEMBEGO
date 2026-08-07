-- =============================================================================
-- 0024 · Control de calidad con checklist verificable
-- =============================================================================
-- El Kanban ya tenía la etapa `control_calidad`, pero mover una tarjeta no deja
-- evidencia de QUÉ se revisó. Esto la convierte en un control real:
--
--   · qc_checklist_items: los puntos a revisar, configurables por la empresa y
--     opcionalmente atados a un servicio (los del detallado no son los del
--     lavado exprés).
--   · qc_reviews: una revisión por orden e intento. Aprobada o rechazada, con
--     responsable, motivo del rechazo y el número de intento (reproceso).
--   · qc_review_results: el resultado punto por punto de esa revisión.
--
-- `submit_qc_review` hace todo en una operación: guarda la revisión y sus
-- resultados, y MUEVE la orden — aprobada → 'listo', rechazada → 'en_proceso'
-- (reproceso) — respetando las transiciones válidas ya definidas en 0010.
-- =============================================================================

create type app.qc_result as enum ('aprobado', 'rechazado');

-- --------------------------------------------------------- Puntos a revisar
create table public.qc_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- NULL = aplica a todos los servicios.
  service_id  uuid,
  label       text not null check (length(trim(label)) > 0),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id),
  constraint qc_items_service_same_company
    foreign key (service_id, company_id) references public.services(id, company_id) on delete cascade
);

create index qc_checklist_items_company_idx on public.qc_checklist_items (company_id, sort_order);

create trigger qc_checklist_items_touch before update on public.qc_checklist_items
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------- Revisiones
create table public.qc_reviews (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  work_order_id  uuid not null,
  attempt        integer not null default 1 check (attempt > 0),
  result         app.qc_result not null,
  reject_reason  text,
  -- Quién lavó y quién revisó: el índice de retrabajos sale de aquí.
  washer_id      uuid references public.profiles(id) on delete set null,
  reviewer_id    uuid references public.profiles(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (id, company_id),
  unique (work_order_id, attempt),
  constraint qc_reviews_order_same_company
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade,
  -- Rechazar sin decir por qué no es control de calidad.
  constraint qc_reviews_reject_is_justified check (
    result <> 'rechazado' or (reject_reason is not null and length(trim(reject_reason)) >= 5)
  )
);

create index qc_reviews_order_idx   on public.qc_reviews (work_order_id, attempt);
create index qc_reviews_company_idx on public.qc_reviews (company_id, created_at desc);
create index qc_reviews_washer_idx  on public.qc_reviews (washer_id) where result = 'rechazado';

create table public.qc_review_results (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  review_id   uuid not null,
  item_id     uuid,
  label       text not null,      -- copia: el punto puede cambiar después
  passed      boolean not null,
  note        text,
  created_at  timestamptz not null default now(),
  constraint qc_results_review_same_company
    foreign key (review_id, company_id) references public.qc_reviews(id, company_id) on delete cascade
);

create index qc_review_results_review_idx on public.qc_review_results (review_id);

-- ================================================================== RLS
alter table public.qc_checklist_items enable row level security;
alter table public.qc_checklist_items force  row level security;
alter table public.qc_reviews         enable row level security;
alter table public.qc_reviews         force  row level security;
alter table public.qc_review_results  enable row level security;
alter table public.qc_review_results  force  row level security;

create policy qc_checklist_items_select on public.qc_checklist_items
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- El checklist lo define quien manda el catálogo.
create policy qc_checklist_items_write on public.qc_checklist_items
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'));

-- Las revisiones se leen; escribirlas es solo por RPC (security definer).
create policy qc_reviews_select on public.qc_reviews
  for select to authenticated using (app.belongs_to_tenant(company_id));
create policy qc_review_results_select on public.qc_review_results
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select, insert, update, delete on public.qc_checklist_items to authenticated;
grant select on public.qc_reviews, public.qc_review_results to authenticated;

-- =========================================== Registrar una revisión de calidad
-- results: [{ itemId?, label, passed, note? }]
-- Aprobada  → la orden pasa a 'listo'.
-- Rechazada → vuelve a 'en_proceso' (reproceso) y exige motivo.
create or replace function public.submit_qc_review(
  p_order_id      uuid,
  p_result        app.qc_result,
  p_results       jsonb default '[]'::jsonb,
  p_reject_reason text default null,
  p_washer_id     uuid default null,
  p_notes         text default null
)
returns public.qc_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_order   public.work_orders;
  v_review  public.qc_reviews;
  v_attempt integer;
  v_item    record;
  v_next    app.order_status;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor',
                         'recepcionista', 'operario', 'superadmin') then
    raise exception 'Su rol no permite registrar control de calidad.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.work_orders
  where id = p_order_id and company_id = v_company
  for update;
  if v_order.id is null then
    raise exception 'Orden inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- Solo se revisa lo que está en control de calidad o en proceso.
  if v_order.status not in ('control_calidad', 'en_proceso') then
    raise exception 'La orden está en estado %, no en control de calidad.', v_order.status
      using errcode = 'check_violation';
  end if;

  if p_result = 'rechazado' and length(trim(coalesce(p_reject_reason, ''))) < 5 then
    raise exception 'Un rechazo exige explicar el motivo (mínimo 5 caracteres).'
      using errcode = 'check_violation';
  end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt
  from public.qc_reviews where work_order_id = p_order_id;

  insert into public.qc_reviews (
    company_id, branch_id, work_order_id, attempt, result,
    reject_reason, washer_id, reviewer_id, notes
  ) values (
    v_company, v_order.branch_id, p_order_id, v_attempt, p_result,
    case when p_result = 'rechazado' then trim(p_reject_reason) end,
    p_washer_id, auth.uid(), p_notes
  ) returning * into v_review;

  for v_item in
    select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb))
      as x("itemId" uuid, label text, passed boolean, note text)
  loop
    if coalesce(trim(v_item.label), '') = '' then
      continue;
    end if;
    insert into public.qc_review_results (company_id, review_id, item_id, label, passed, note)
    values (v_company, v_review.id, v_item."itemId", trim(v_item.label),
            coalesce(v_item.passed, false), v_item.note);
  end loop;

  -- Mover la orden. La transición la valida el trigger de 0010.
  v_next := case when p_result = 'aprobado' then 'listo' else 'en_proceso' end::app.order_status;
  if v_order.status <> v_next then
    update public.work_orders set status = v_next where id = p_order_id and company_id = v_company;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_order.branch_id, 'CONTROL_CALIDAD', 'work_order', p_order_id,
          format('Intento %s: %s%s', v_attempt, p_result,
                 case when p_result = 'rechazado' then ' · ' || trim(p_reject_reason) else '' end));

  return v_review;
end;
$$;

grant execute on function public.submit_qc_review(uuid, app.qc_result, jsonb, text, uuid, text) to authenticated;

-- ============================================== Índice de retrabajos por lavador
-- Cuántas revisiones rechazadas acumula cada operario en un periodo: el dato
-- que convierte el control de calidad en mejora, no en papeleo.
create or replace function public.qc_rework_index(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', washer_id, 'name', coalesce(full_name, '—'),
    'reviews', reviews, 'rejected', rejected,
    'rework_pct', case when reviews = 0 then 0
                       else round(rejected * 100.0 / reviews)::int end
  ) order by rejected desc), '[]'::jsonb)
  from (
    select r.washer_id, p.full_name,
           count(*) as reviews,
           count(*) filter (where r.result = 'rechazado') as rejected
    from public.qc_reviews r
    left join public.profiles p on p.id = r.washer_id
    where r.company_id = app.current_company_id()
      and r.created_at >= p_from and r.created_at < p_to + 1
      and r.washer_id is not null
    group by r.washer_id, p.full_name
  ) t
$$;

grant execute on function public.qc_rework_index(date, date) to authenticated;

comment on table public.qc_reviews is
  'Revisión de calidad por orden e intento: aprobada o rechazada con motivo, '
  'quién lavó y quién revisó. Rechazar devuelve la orden a proceso (reproceso).';
