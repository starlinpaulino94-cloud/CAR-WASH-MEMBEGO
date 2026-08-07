-- =============================================================================
-- PARCHE 0026 (editor SQL de Supabase) · Agenda de citas y reservaciones
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches de la Fase 1 (0019-0022) y de los anteriores de la Fase 2.
-- Es idempotente: puedes correrlo más de una vez sin daño.
-- =============================================================================

-- =============================================================================
-- 0026 · Agenda: citas y reservaciones
-- =============================================================================
-- El sistema solo sabía de clientes que YA llegaron. Para detallado, pulido o
-- ceramic coating —trabajos de horas— hace falta reservar antes:
--
--   · appointments: fecha y hora, servicio, vehículo, duración estimada y
--     estado (pendiente → confirmada → en curso/convertida, o cancelada/ausente).
--   · La capacidad la marcan las bahías de la sucursal: `book_appointment`
--     rechaza una reserva si en esa franja ya hay tantas citas como bahías.
--   · `convert_appointment`: la cita se vuelve orden de servicio real cuando
--     el vehículo llega, sin recapturar los datos.
--
-- La duración por defecto sale de services.estimated_minutes.
-- =============================================================================

do $do$ begin
  create type app.appointment_status as enum
('pendiente', 'confirmada', 'en_curso', 'convertida', 'cancelada', 'ausente');
exception when duplicate_object then null; end $do$;
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid not null,
  customer_id       uuid,
  customer_name     text not null check (length(trim(customer_name)) > 0),
  customer_phone    text,
  vehicle_id        uuid,
  vehicle_plate     text not null default '',
  vehicle_category  app.vehicle_category not null default 'sedan',
  service_id        uuid,
  service_name      text not null default '',
  scheduled_at      timestamptz not null,
  duration_minutes  integer not null default 60 check (duration_minutes > 0),
  status            app.appointment_status not null default 'pendiente',
  notes             text,
  cancel_reason     text,
  -- La orden que nació de esta cita.
  work_order_id     uuid,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, company_id),
  constraint appointments_branch_same_company
    foreign key (branch_id, company_id) references public.branches(id, company_id) on delete cascade,
  constraint appointments_customer_same_company
    foreign key (customer_id, company_id) references public.customers(id, company_id) on delete set null,
  constraint appointments_service_same_company
    foreign key (service_id, company_id) references public.services(id, company_id) on delete set null,
  constraint appointments_order_same_company
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete set null,
  -- Cancelar exige decir por qué.
  constraint appointments_cancel_is_justified check (
    status <> 'cancelada' or (cancel_reason is not null and length(trim(cancel_reason)) > 0)
  ),
  -- Convertida exige la orden que la reemplaza.
  constraint appointments_converted_has_order check (
    status <> 'convertida' or work_order_id is not null
  )
);

create index if not exists appointments_branch_day_idx on public.appointments (branch_id, scheduled_at);
create index if not exists appointments_company_idx on public.appointments (company_id, scheduled_at desc);
create index if not exists appointments_active_idx on public.appointments (branch_id, scheduled_at)
  where status in ('pendiente', 'confirmada', 'en_curso');
create index if not exists appointments_customer_idx on public.appointments (customer_id)
  where customer_id is not null;

drop trigger if exists appointments_touch on public.appointments;
create trigger appointments_touch
  before update on public.appointments
  for each row execute function app.touch_updated_at();

alter table public.appointments enable row level security;
alter table public.appointments force  row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Quien atiende el mostrador agenda; la escritura fina va por RPC.
drop policy if exists appointments_write on public.appointments;
create policy appointments_write on public.appointments
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor',
                          'recepcionista', 'cajero', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor',
                               'recepcionista', 'cajero', 'superadmin'));

grant select, insert, update on public.appointments to authenticated;

-- ------------------------------------------------------------ Disponibilidad
-- Citas activas que se solapan con una franja, en una sucursal.
create or replace function app.overlapping_appointments(
  p_branch uuid,
  p_start  timestamptz,
  p_minutes integer,
  p_exclude uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.appointments a
  where a.branch_id = p_branch
    and a.status in ('pendiente', 'confirmada', 'en_curso')
    and (p_exclude is null or a.id <> p_exclude)
    -- Solape real de intervalos: [inicio, fin) contra [inicio, fin).
    and a.scheduled_at < p_start + make_interval(mins => p_minutes)
    and p_start < a.scheduled_at + make_interval(mins => a.duration_minutes)
$$;

/** Cuántas citas más caben en esa franja (capacidad = bahías de la sucursal). */
create or replace function public.appointment_availability(
  p_branch_id uuid,
  p_start     timestamptz,
  p_minutes   integer default 60
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_capacity integer;
  v_taken    integer;
begin
  if not app.belongs_to_tenant((select company_id from public.branches where id = p_branch_id)) then
    raise exception 'Sucursal fuera de su alcance.' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into v_capacity
  from public.bays
  where branch_id = p_branch_id and company_id = v_company and status <> 'mantenimiento';

  v_taken := app.overlapping_appointments(p_branch_id, p_start, p_minutes);

  return jsonb_build_object(
    'capacity', v_capacity,
    'taken', v_taken,
    'free', greatest(0, v_capacity - v_taken)
  );
end;
$$;

grant execute on function public.appointment_availability(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------- Reservar
create or replace function public.book_appointment(
  p_branch_id       uuid,
  p_customer_name   text,
  p_scheduled_at    timestamptz,
  p_service_id      uuid default null,
  p_vehicle_plate   text default '',
  p_vehicle_category app.vehicle_category default 'sedan',
  p_customer_id     uuid default null,
  p_customer_phone  text default null,
  p_duration_minutes integer default null,
  p_notes           text default null
)
returns public.appointments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_service  public.services;
  v_minutes  integer;
  v_capacity integer;
  v_taken    integer;
  v_row      public.appointments;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor',
                         'recepcionista', 'cajero', 'superadmin') then
    raise exception 'Su rol no permite agendar citas.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'La cita necesita el nombre del cliente.' using errcode = 'check_violation';
  end if;
  if p_scheduled_at is null then
    raise exception 'Indique la fecha y hora de la cita.' using errcode = 'check_violation';
  end if;
  if p_scheduled_at < now() - interval '1 hour' then
    raise exception 'No se agenda una cita en el pasado.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.branches
                 where id = p_branch_id and company_id = v_company) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  if p_service_id is not null then
    select * into v_service from public.services
    where id = p_service_id and company_id = v_company;
    if v_service.id is null then
      raise exception 'Servicio inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;
  end if;

  v_minutes := coalesce(p_duration_minutes, v_service.estimated_minutes, 60);
  if v_minutes <= 0 then
    raise exception 'La duración debe ser mayor que cero.' using errcode = 'check_violation';
  end if;

  -- Capacidad: no se reserva más allá de las bahías disponibles de la sucursal.
  select count(*)::integer into v_capacity
  from public.bays
  where branch_id = p_branch_id and company_id = v_company and status <> 'mantenimiento';

  v_taken := app.overlapping_appointments(p_branch_id, p_scheduled_at, v_minutes);

  if v_capacity > 0 and v_taken >= v_capacity then
    raise exception 'No hay capacidad en esa franja: % de % bahías ya reservadas.', v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  insert into public.appointments (
    company_id, branch_id, customer_id, customer_name, customer_phone,
    vehicle_plate, vehicle_category, service_id, service_name,
    scheduled_at, duration_minutes, notes, created_by
  ) values (
    v_company, p_branch_id, p_customer_id, trim(p_customer_name), p_customer_phone,
    -- Misma normalización que las órdenes y los vehículos (0003/0010): sin
    -- ella, la cita guardaría 'AG-0001' y la orden 'AG0001'.
    upper(regexp_replace(coalesce(p_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')),
    p_vehicle_category,
    p_service_id, coalesce(v_service.name, ''),
    p_scheduled_at, v_minutes, p_notes, auth.uid()
  ) returning * into v_row;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'AGENDAR_CITA', 'appointment', v_row.id,
          format('%s · %s · %s', trim(p_customer_name),
                 coalesce(v_service.name, 'sin servicio'), p_scheduled_at));

  return v_row;
end;
$$;

grant execute on function public.book_appointment(uuid, text, timestamptz, uuid, text, app.vehicle_category, uuid, text, integer, text) to authenticated;

-- ------------------------------------------- Convertir la cita en una orden
-- Cuando el vehículo llega: crea la orden de servicio con los datos de la cita
-- y la marca convertida. Reutiliza create_work_order (validaciones y precios).
create or replace function public.convert_appointment(
  p_appointment_id uuid,
  p_client_request_id text
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_appt    public.appointments;
  v_order   public.work_orders;
  v_items   jsonb;
begin
  select * into v_appt from public.appointments
  where id = p_appointment_id and company_id = v_company for update;
  if v_appt.id is null then
    raise exception 'Cita inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_appt.status in ('convertida', 'cancelada') then
    raise exception 'La cita está % y ya no se convierte.', v_appt.status
      using errcode = 'check_violation';
  end if;
  if v_appt.vehicle_plate is null or length(trim(v_appt.vehicle_plate)) = 0 then
    raise exception 'La cita no tiene placa: regístrela antes de convertirla.'
      using errcode = 'check_violation';
  end if;

  v_items := case
    when v_appt.service_id is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'service_id', v_appt.service_id,
      'name', coalesce(nullif(v_appt.service_name, ''), 'Servicio'),
      'quantity', 1, 'discount_cents', 0, 'is_membego_covered', false))
  end;

  v_order := public.create_work_order(
    p_branch_id         => v_appt.branch_id,
    p_client_request_id => p_client_request_id,
    p_vehicle_plate     => v_appt.vehicle_plate,
    p_vehicle_category  => v_appt.vehicle_category,
    p_items             => v_items,
    p_customer_name     => v_appt.customer_name,
    p_customer_phone    => v_appt.customer_phone,
    p_customer_id       => v_appt.customer_id,
    p_notes             => v_appt.notes
  );

  update public.appointments
     set status = 'convertida', work_order_id = v_order.id
   where id = p_appointment_id and company_id = v_company;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_appt.branch_id, 'CONVERTIR_CITA', 'appointment', p_appointment_id,
          format('Cita de %s → orden %s', v_appt.customer_name, v_order.order_number));

  return v_order;
end;
$$;

grant execute on function public.convert_appointment(uuid, text) to authenticated;

comment on table public.appointments is
  'Citas reservadas. La capacidad la marcan las bahías de la sucursal; al llegar '
  'el vehículo, convert_appointment las vuelve orden de servicio.';
