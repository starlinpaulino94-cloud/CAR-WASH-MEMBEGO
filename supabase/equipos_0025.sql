-- =============================================================================
-- PARCHE 0025 (editor SQL de Supabase) · Equipos y mantenimiento
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches de la Fase 1 (0019-0022) y de los anteriores de la Fase 2.
-- Es idempotente: puedes correrlo más de una vez sin daño.
-- =============================================================================

-- =============================================================================
-- 0025 · Equipos y mantenimiento
-- =============================================================================
-- Una bahía podía marcarse "en mantenimiento", pero el mantenimiento no era un
-- proceso: no había catálogo de equipos, ni historial, ni costo acumulado, ni
-- aviso de la próxima revisión. Esto lo administra:
--
--   · equipment: hidrolavadoras, aspiradoras, compresores… con serie, compra,
--     garantía, la bahía donde vive y su próxima revisión preventiva.
--   · maintenance_orders: cada intervención (preventiva o correctiva) con su
--     costo, repuestos, proveedor técnico y las horas fuera de servicio.
--
-- `complete_maintenance` cierra la intervención: fija la salida, calcula el
-- tiempo fuera de servicio, suma el costo al equipo y programa la próxima
-- revisión. Un equipo con intervención abierta queda 'fuera_servicio'.
-- =============================================================================

do $do$ begin
  create type app.equipment_status as enum
('operativo', 'mantenimiento', 'fuera_servicio', 'retirado');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.maintenance_kind as enum
('preventivo', 'correctivo');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.maintenance_status as enum
('abierta', 'completada', 'cancelada');
exception when duplicate_object then null; end $do$;
create table if not exists public.equipment (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  branch_id        uuid references public.branches(id) on delete set null,
  bay_id           uuid references public.bays(id) on delete set null,
  code             text not null,
  name             text not null check (length(trim(name)) > 0),
  category         text not null default '',
  brand            text,
  model            text,
  serial_number    text,
  purchase_date    date,
  purchase_cents   bigint not null default 0 check (purchase_cents >= 0),
  warranty_until   date,
  status           app.equipment_status not null default 'operativo',
  -- Mantenimiento preventivo: cada cuántos días y cuándo toca.
  service_every_days integer check (service_every_days is null or service_every_days > 0),
  next_service_at  date,
  last_service_at  date,
  -- Costo acumulado de mantenimiento: lo suma complete_maintenance.
  maintenance_cents bigint not null default 0 check (maintenance_cents >= 0),
  downtime_minutes  integer not null default 0 check (downtime_minutes >= 0),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);

create index if not exists equipment_company_idx on public.equipment (company_id, status);
create index if not exists equipment_due_idx on public.equipment (company_id, next_service_at)
  where status <> 'retirado' and next_service_at is not null;

drop trigger if exists equipment_touch on public.equipment;
create trigger equipment_touch
  before update on public.equipment
  for each row execute function app.touch_updated_at();

create table if not exists public.maintenance_orders (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  equipment_id   uuid not null,
  kind           app.maintenance_kind not null default 'correctivo',
  status         app.maintenance_status not null default 'abierta',
  description    text not null check (length(trim(description)) > 0),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  cost_cents     bigint not null default 0 check (cost_cents >= 0),
  parts          text,                    -- repuestos utilizados
  supplier_id    uuid,                    -- proveedor técnico (opcional)
  resolution     text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint maintenance_equipment_same_company
    foreign key (equipment_id, company_id) references public.equipment(id, company_id) on delete cascade,
  constraint maintenance_supplier_same_company
    foreign key (supplier_id, company_id) references public.suppliers(id, company_id) on delete set null,
  constraint maintenance_finished_after_start check (finished_at is null or finished_at >= started_at),
  constraint maintenance_completed_is_closed check (
    status <> 'completada' or finished_at is not null
  )
);

create index if not exists maintenance_orders_equipment_idx on public.maintenance_orders (equipment_id, started_at desc);
create index if not exists maintenance_orders_open_idx on public.maintenance_orders (company_id)
  where status = 'abierta';

drop trigger if exists maintenance_orders_touch on public.maintenance_orders;
create trigger maintenance_orders_touch
  before update on public.maintenance_orders
  for each row execute function app.touch_updated_at();

-- ================================================================== RLS
alter table public.equipment          enable row level security;
alter table public.equipment          force  row level security;
alter table public.maintenance_orders enable row level security;
alter table public.maintenance_orders force  row level security;

drop policy if exists equipment_select on public.equipment;
create policy equipment_select on public.equipment
  for select to authenticated using (app.belongs_to_tenant(company_id));

drop policy if exists equipment_write on public.equipment;
create policy equipment_write on public.equipment
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'));

drop policy if exists maintenance_orders_select on public.maintenance_orders;
create policy maintenance_orders_select on public.maintenance_orders
  for select to authenticated using (app.belongs_to_tenant(company_id));

drop policy if exists maintenance_orders_write on public.maintenance_orders;
create policy maintenance_orders_write on public.maintenance_orders
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'));

grant select, insert, update on public.equipment to authenticated;
grant select, insert, update on public.maintenance_orders to authenticated;

-- ------------------------------------------------- Abrir una intervención
-- Deja el equipo en mantenimiento mientras la intervención está abierta.
create or replace function public.open_maintenance(
  p_equipment_id uuid,
  p_kind         app.maintenance_kind,
  p_description  text,
  p_supplier_id  uuid default null
)
returns public.maintenance_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_equip   public.equipment;
  v_order   public.maintenance_orders;
begin
  -- Comprobación explícita del rol: sin ella, el FOR UPDATE de abajo choca con
  -- RLS y el usuario recibe un "equipo inexistente" que despista.
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite abrir intervenciones de mantenimiento.'
      using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_description, ''))) < 5 then
    raise exception 'Describa la intervención (mínimo 5 caracteres).' using errcode = 'check_violation';
  end if;

  select * into v_equip from public.equipment
  where id = p_equipment_id and company_id = v_company for update;
  if v_equip.id is null then
    raise exception 'Equipo inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.maintenance_orders
             where equipment_id = p_equipment_id and status = 'abierta') then
    raise exception 'Este equipo ya tiene una intervención abierta.' using errcode = 'check_violation';
  end if;

  insert into public.maintenance_orders (
    company_id, equipment_id, kind, description, supplier_id, created_by
  ) values (
    v_company, p_equipment_id, p_kind, trim(p_description), p_supplier_id, auth.uid()
  ) returning * into v_order;

  update public.equipment set status = 'mantenimiento'
  where id = p_equipment_id and company_id = v_company;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_equip.branch_id, 'ABRIR_MANTENIMIENTO', 'equipment', p_equipment_id,
          format('%s · %s · %s', v_equip.name, p_kind, trim(p_description)));

  return v_order;
end;
$$;

grant execute on function public.open_maintenance(uuid, app.maintenance_kind, text, uuid) to authenticated;

-- --------------------------------------------- Cerrar una intervención
-- Fija la salida, acumula costo y tiempo fuera de servicio en el equipo, lo
-- devuelve a operativo y programa la próxima revisión si hay periodicidad.
create or replace function public.complete_maintenance(
  p_maintenance_id uuid,
  p_cost_cents     bigint default 0,
  p_resolution     text default null,
  p_parts          text default null
)
returns public.maintenance_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_order   public.maintenance_orders;
  v_equip   public.equipment;
  v_minutes integer;
begin
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite cerrar intervenciones de mantenimiento.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_cost_cents, 0) < 0 then
    raise exception 'El costo no puede ser negativo.' using errcode = 'check_violation';
  end if;

  select * into v_order from public.maintenance_orders
  where id = p_maintenance_id and company_id = v_company for update;
  if v_order.id is null then
    raise exception 'Intervención inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'abierta' then
    raise exception 'Esta intervención ya está cerrada.' using errcode = 'check_violation';
  end if;

  select * into v_equip from public.equipment
  where id = v_order.equipment_id and company_id = v_company for update;

  v_minutes := greatest(0, (extract(epoch from (now() - v_order.started_at)) / 60)::integer);

  update public.maintenance_orders
     set status = 'completada', finished_at = now(),
         cost_cents = coalesce(p_cost_cents, 0),
         resolution = p_resolution, parts = p_parts
   where id = p_maintenance_id
  returning * into v_order;

  update public.equipment
     set status = 'operativo',
         maintenance_cents = maintenance_cents + coalesce(p_cost_cents, 0),
         downtime_minutes  = downtime_minutes + v_minutes,
         last_service_at   = current_date,
         next_service_at   = case when service_every_days is not null
                                  then current_date + service_every_days
                                  else next_service_at end
   where id = v_equip.id and company_id = v_company;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_equip.branch_id, 'CERRAR_MANTENIMIENTO', 'equipment', v_equip.id,
          format('%s · costo %s · %s min fuera de servicio',
                 v_equip.name, coalesce(p_cost_cents, 0), v_minutes));

  return v_order;
end;
$$;

grant execute on function public.complete_maintenance(uuid, bigint, text, text) to authenticated;

comment on table public.equipment is
  'Activos del car wash: serie, garantía, próxima revisión, costo acumulado de '
  'mantenimiento y tiempo fuera de servicio.';
