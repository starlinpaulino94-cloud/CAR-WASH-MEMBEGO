-- =============================================================================
-- PARCHE 0030 (editor SQL de Supabase) · Turnos, asistencia y nómina
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches 0028 (crédito) y 0029 (flotillas).
-- Es idempotente: puedes correrlo más de una vez sin daño.
--
-- Ojo con un efecto inmediato: a partir de aquí NADIE puede cambiarse el sueldo
-- ni la comisión con un UPDATE sobre su propia ficha. Solo set_employee_pay().
-- =============================================================================

do $do$ begin
  create type app.payroll_type as enum ('mensual', 'por_hora', 'solo_comision');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.payroll_status as enum ('borrador', 'aprobada', 'pagada');
exception when duplicate_object then null; end $do$;

-- ============================================== Datos de pago en el perfil
alter table public.profiles
  add column if not exists payroll_type      app.payroll_type not null default 'solo_comision',
  add column if not exists base_salary_cents bigint not null default 0,
  add column if not exists hourly_rate_cents bigint not null default 0;

-- Los CHECK van aparte: `add column if not exists` no los recrea si la columna
-- ya existía, y `add constraint` no admite `if not exists`.
do $do$ begin
  alter table public.profiles
    add constraint profiles_base_salary_non_negative check (base_salary_cents >= 0);
exception when duplicate_object then null; end $do$;
do $do$ begin
  alter table public.profiles
    add constraint profiles_hourly_rate_non_negative check (hourly_rate_cents >= 0);
exception when duplicate_object then null; end $do$;

-- El sueldo y la comisión son dinero, no datos de contacto. `profiles_update_self`
-- permite a cada quien editar su propia ficha —teléfono, avatar—; sin este
-- guardia, ese mismo permiso alcanzaba para subirse la comisión al 100 %.
create or replace function app.profiles_pay_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.payroll_type      is distinct from old.payroll_type
   or new.base_salary_cents is distinct from old.base_salary_cents
   or new.hourly_rate_cents is distinct from old.hourly_rate_cents
   or new.commission_bps    is distinct from old.commission_bps)
     and coalesce(current_setting('app.payroll_ctx', true), '') <> 'ok' then
    raise exception
      'El sueldo y la comisión no se editan directamente. Use set_employee_pay().'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_pay_guard on public.profiles;
create trigger profiles_pay_guard
  before update on public.profiles
  for each row execute function app.profiles_pay_guard();

create or replace function public.set_employee_pay(
  p_profile_id        uuid,
  p_payroll_type      app.payroll_type,
  p_base_salary_cents bigint  default 0,
  p_hourly_rate_cents bigint  default 0,
  p_commission_bps    integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_profile public.profiles;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite fijar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_base_salary_cents, 0) < 0 or coalesce(p_hourly_rate_cents, 0) < 0 then
    raise exception 'El importe no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if p_commission_bps is not null and (p_commission_bps < 0 or p_commission_bps > 10000) then
    raise exception 'La comisión debe estar entre 0 y 10000 puntos base.'
      using errcode = 'check_violation';
  end if;
  if p_payroll_type = 'mensual' and coalesce(p_base_salary_cents, 0) = 0 then
    raise exception 'Un sueldo mensual necesita importe.' using errcode = 'check_violation';
  end if;
  if p_payroll_type = 'por_hora' and coalesce(p_hourly_rate_cents, 0) = 0 then
    raise exception 'El pago por hora necesita tarifa.' using errcode = 'check_violation';
  end if;

  perform set_config('app.payroll_ctx', 'ok', true);
  update public.profiles
     set payroll_type      = p_payroll_type,
         -- Cada modalidad guarda solo lo suyo: dejar residuos del tipo anterior
         -- haría que un cambio de modalidad pagase dos conceptos.
         base_salary_cents = case when p_payroll_type = 'mensual'  then coalesce(p_base_salary_cents, 0) else 0 end,
         hourly_rate_cents = case when p_payroll_type = 'por_hora' then coalesce(p_hourly_rate_cents, 0) else 0 end,
         commission_bps    = coalesce(p_commission_bps, commission_bps)
   where id = p_profile_id and company_id = v_company
  returning * into v_profile;
  perform set_config('app.payroll_ctx', '', true);

  if v_profile.id is null then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_profile.branch_id, 'FIJAR_SUELDO', 'Profile', p_profile_id::text,
          format('%s · %s · base %s · hora %s · comisión %s bps',
                 v_profile.full_name, v_profile.payroll_type, v_profile.base_salary_cents,
                 v_profile.hourly_rate_cents, coalesce(v_profile.commission_bps, 0)),
          jsonb_build_object('payroll_type', v_profile.payroll_type,
                             'base_salary_cents', v_profile.base_salary_cents,
                             'hourly_rate_cents', v_profile.hourly_rate_cents,
                             'commission_bps', v_profile.commission_bps));

  return v_profile;
end;
$$;

grant execute on function public.set_employee_pay(uuid, app.payroll_type, bigint, bigint, integer)
  to authenticated;

-- =================================================================== Turnos
create table if not exists public.work_shifts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id),
  constraint work_shifts_ends_after_start check (ends_at > starts_at)
);

create index if not exists work_shifts_profile_idx on public.work_shifts (profile_id, starts_at desc);
create index if not exists work_shifts_company_idx  on public.work_shifts (company_id, starts_at desc);

drop trigger if exists work_shifts_touch on public.work_shifts;
create trigger work_shifts_touch before update on public.work_shifts
  for each row execute function app.touch_updated_at();

-- ============================================================== Asistencia
create table if not exists public.attendance_records (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  -- Turno contra el que se mide la tardanza. Sin turno planificado no hay
  -- tardanza que medir: no se inventa una.
  shift_id       uuid references public.work_shifts(id) on delete set null,
  checked_in_at  timestamptz not null default now(),
  checked_out_at timestamptz,
  worked_minutes integer check (worked_minutes >= 0),
  late_minutes   integer not null default 0 check (late_minutes >= 0),
  notes          text,
  created_at     timestamptz not null default now(),
  constraint attendance_out_after_in check (checked_out_at is null or checked_out_at > checked_in_at)
);

create index if not exists attendance_profile_idx on public.attendance_records (profile_id, checked_in_at desc);
create index if not exists attendance_company_idx on public.attendance_records (company_id, checked_in_at desc);

-- Un marcaje abierto por persona: sin esto, dos entradas seguidas dejarían la
-- jornada anterior sin cerrar y las horas trabajadas serían inventadas.
create unique index if not exists attendance_one_open_per_profile
  on public.attendance_records (profile_id) where checked_out_at is null;

-- ================================================================ Adelantos
create table if not exists public.payroll_advances (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete set null,
  profile_id      uuid not null references public.profiles(id) on delete restrict,
  amount_cents    bigint not null check (amount_cents > 0),
  reason          text,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  -- Partida de nómina que lo descontó. Mientras sea NULL, el adelanto está
  -- pendiente; una vez amarrado no lo puede recoger otra nómina.
  payroll_item_id uuid,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists payroll_advances_pending_idx on public.payroll_advances (company_id, profile_id)
  where payroll_item_id is null;

-- ==================================================================== Nómina
create table if not exists public.payroll_periods (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  branch_id        uuid references public.branches(id) on delete set null,
  period_from      date not null,
  period_to        date not null,
  status           app.payroll_status not null default 'borrador',
  gross_cents      bigint not null default 0,
  deductions_cents bigint not null default 0,
  net_cents        bigint not null default 0,
  notes            text,
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_at      timestamptz,
  paid_by          uuid references public.profiles(id) on delete set null,
  paid_at          timestamptz,
  payment_method   app.payment_method,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, period_from, period_to),
  constraint payroll_periods_range check (period_to >= period_from)
);

create index if not exists payroll_periods_company_idx on public.payroll_periods (company_id, period_from desc);

drop trigger if exists payroll_periods_touch on public.payroll_periods;
create trigger payroll_periods_touch before update on public.payroll_periods
  for each row execute function app.touch_updated_at();

create table if not exists public.payroll_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  period_id         uuid not null,
  profile_id        uuid not null references public.profiles(id) on delete restrict,
  -- Foto del régimen en el momento de calcular: si mañana cambia de modalidad,
  -- la nómina de este mes sigue explicándose sola.
  payroll_type      app.payroll_type not null,
  base_cents        bigint not null default 0 check (base_cents >= 0),
  worked_minutes    integer not null default 0 check (worked_minutes >= 0),
  commissions_cents bigint not null default 0 check (commissions_cents >= 0),
  bonus_cents       bigint not null default 0 check (bonus_cents >= 0),
  advances_cents    bigint not null default 0 check (advances_cents >= 0),
  deductions_cents  bigint not null default 0 check (deductions_cents >= 0),
  net_cents         bigint not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, company_id),
  unique (period_id, profile_id),
  constraint payroll_items_period_same_company
    foreign key (period_id, company_id) references public.payroll_periods(id, company_id) on delete cascade
);

create index if not exists payroll_items_period_idx on public.payroll_items (period_id);

drop trigger if exists payroll_items_touch on public.payroll_items;
create trigger payroll_items_touch before update on public.payroll_items
  for each row execute function app.touch_updated_at();

-- La comisión recuerda qué nómina la pagó: es lo que impide cobrarla dos veces.
-- FK compuesta como el resto del esquema: la partida y la comisión tienen que
-- ser del mismo tenant. `set null (columna)` acota el efecto del borrado a
-- payroll_item_id; sin acotarlo intentaría anular también company_id.
alter table public.commissions add column if not exists payroll_item_id uuid;

do $do$ begin
  alter table public.commissions
    add constraint commissions_payroll_item_same_company
    foreign key (payroll_item_id, company_id) references public.payroll_items(id, company_id)
    on delete set null (payroll_item_id);
exception when duplicate_object then null; end $do$;

create index if not exists commissions_unlinked_idx on public.commissions (company_id, profile_id, earned_on)
  where payroll_item_id is null;

do $do$ begin
  alter table public.payroll_advances
    add constraint payroll_advances_item_same_company
    foreign key (payroll_item_id, company_id) references public.payroll_items(id, company_id)
    on delete set null (payroll_item_id);
exception when duplicate_object then null; end $do$;

-- ------------------------------------------------------------------- RLS
alter table public.work_shifts       enable row level security;
alter table public.work_shifts       force  row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_records force  row level security;
alter table public.payroll_advances  enable row level security;
alter table public.payroll_advances  force  row level security;
alter table public.payroll_periods   enable row level security;
alter table public.payroll_periods   force  row level security;
alter table public.payroll_items     enable row level security;
alter table public.payroll_items     force  row level security;

-- Cada quien ve su turno, su marcaje y sus adelantos; la gerencia ve todo.
drop policy if exists work_shifts_select on public.work_shifts;
create policy work_shifts_select on public.work_shifts
  for select to authenticated
  using (profile_id = auth.uid()
         or (app.belongs_to_tenant(company_id)
             and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin')));

drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
  for select to authenticated
  using (profile_id = auth.uid()
         or (app.belongs_to_tenant(company_id)
             and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin')));

drop policy if exists payroll_advances_select on public.payroll_advances;
create policy payroll_advances_select on public.payroll_advances
  for select to authenticated
  using (profile_id = auth.uid()
         or (app.belongs_to_tenant(company_id)
             and app.has_role('propietario', 'administrador', 'contador', 'superadmin')));

-- La nómina completa es información sensible: solo quien la firma.
drop policy if exists payroll_periods_select on public.payroll_periods;
create policy payroll_periods_select on public.payroll_periods
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'contador', 'superadmin'));

drop policy if exists payroll_items_select on public.payroll_items;
create policy payroll_items_select on public.payroll_items
  for select to authenticated
  using (profile_id = auth.uid()
         or (app.belongs_to_tenant(company_id)
             and app.has_role('propietario', 'administrador', 'contador', 'superadmin')));

grant select on public.work_shifts, public.attendance_records, public.payroll_advances,
                public.payroll_periods, public.payroll_items to authenticated;

-- =============================================================================
-- Turnos
-- =============================================================================
create or replace function public.schedule_shift(
  p_profile_id uuid,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_branch_id  uuid default null,
  p_notes      text default null,
  p_shift_id   uuid default null      -- reprogramar en vez de crear
)
returns public.work_shifts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_shift   public.work_shifts;
  v_branch  uuid;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite programar turnos.' using errcode = 'insufficient_privilege';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'El turno debe terminar después de empezar.' using errcode = 'check_violation';
  end if;

  select branch_id into v_branch from public.profiles
  where id = p_profile_id and company_id = v_company;
  if not found then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- Dos turnos encima del mismo empleado son un error de planificación, no un
  -- dato. Solapan si empieza antes de que acabe el otro y acaba después de que
  -- el otro empiece.
  if exists (
    select 1 from public.work_shifts s
    where s.profile_id = p_profile_id
      and s.company_id = v_company
      and (p_shift_id is null or s.id <> p_shift_id)
      and s.starts_at < p_ends_at
      and s.ends_at   > p_starts_at
  ) then
    raise exception 'Ese empleado ya tiene un turno que se solapa con ese horario.'
      using errcode = 'check_violation';
  end if;

  if p_shift_id is null then
    insert into public.work_shifts (
      company_id, branch_id, profile_id, starts_at, ends_at, notes, created_by
    ) values (
      v_company, coalesce(p_branch_id, v_branch), p_profile_id,
      p_starts_at, p_ends_at, p_notes, auth.uid()
    )
    returning * into v_shift;
  else
    update public.work_shifts
       set starts_at = p_starts_at,
           ends_at   = p_ends_at,
           branch_id = coalesce(p_branch_id, branch_id),
           notes     = p_notes
     where id = p_shift_id and company_id = v_company
    returning * into v_shift;

    if v_shift.id is null then
      raise exception 'Turno inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;
  end if;

  return v_shift;
end;
$$;

grant execute on function public.schedule_shift(uuid, timestamptz, timestamptz, uuid, text, uuid)
  to authenticated;

create or replace function public.delete_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_rows    integer;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite programar turnos.' using errcode = 'insufficient_privilege';
  end if;

  delete from public.work_shifts where id = p_shift_id and company_id = v_company;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Turno inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
end;
$$;

grant execute on function public.delete_shift(uuid) to authenticated;

-- =============================================================================
-- Asistencia
-- =============================================================================
-- Sin argumento marca el propio; marcar a otro exige supervisión.
create or replace function public.clock_in(
  p_profile_id uuid default null,
  p_notes      text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_target  uuid := coalesce(p_profile_id, auth.uid());
  v_branch  uuid;
  v_shift   public.work_shifts;
  v_late    integer := 0;
  v_record  public.attendance_records;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada.' using errcode = 'insufficient_privilege';
  end if;
  if v_target <> auth.uid()
     and not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite marcar la entrada de otra persona.'
      using errcode = 'insufficient_privilege';
  end if;

  select branch_id into v_branch from public.profiles
  where id = v_target and company_id = v_company and is_active;
  if not found then
    raise exception 'Empleado inexistente, inactivo o fuera de su alcance.'
      using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.attendance_records
             where profile_id = v_target and checked_out_at is null) then
    raise exception 'Ya hay una jornada abierta: marque la salida antes de volver a entrar.'
      using errcode = 'check_violation';
  end if;

  -- Turno del día contra el que se mide la tardanza: el que cubre este momento
  -- o el que empieza dentro de las próximas seis horas (el que llega temprano
  -- no tiene que esperar a que empiece su turno para marcar).
  select * into v_shift from public.work_shifts
  where profile_id = v_target and company_id = v_company
    and ends_at > now() and starts_at < now() + interval '6 hours'
  order by starts_at
  limit 1;

  if v_shift.id is not null and now() > v_shift.starts_at then
    v_late := greatest(0, floor(extract(epoch from (now() - v_shift.starts_at)) / 60)::integer);
  end if;

  insert into public.attendance_records (
    company_id, branch_id, profile_id, shift_id, late_minutes, notes
  ) values (
    v_company, coalesce(v_shift.branch_id, v_branch), v_target, v_shift.id, v_late, p_notes
  )
  returning * into v_record;

  return v_record;
end;
$$;

grant execute on function public.clock_in(uuid, text) to authenticated;

create or replace function public.clock_out(
  p_profile_id uuid default null,
  p_notes      text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_target  uuid := coalesce(p_profile_id, auth.uid());
  v_record  public.attendance_records;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada.' using errcode = 'insufficient_privilege';
  end if;
  if v_target <> auth.uid()
     and not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite marcar la salida de otra persona.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_record from public.attendance_records
  where profile_id = v_target and company_id = v_company and checked_out_at is null
  for update;
  if v_record.id is null then
    raise exception 'No hay ninguna jornada abierta que cerrar.' using errcode = 'no_data_found';
  end if;

  update public.attendance_records
     set checked_out_at = now(),
         worked_minutes = greatest(0, floor(extract(epoch from (now() - checked_in_at)) / 60)::integer),
         notes = coalesce(p_notes, notes)
   where id = v_record.id
  returning * into v_record;

  return v_record;
end;
$$;

grant execute on function public.clock_out(uuid, text) to authenticated;

-- =============================================================================
-- Adelantos
-- =============================================================================
create or replace function public.register_payroll_advance(
  p_profile_id      uuid,
  p_amount_cents    bigint,
  p_reason          text default null,
  p_cash_session_id uuid default null
)
returns public.payroll_advances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_name    text;
  v_branch  uuid;
  v_session public.cash_sessions;
  v_advance public.payroll_advances;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite dar adelantos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'El adelanto debe ser mayor que cero.' using errcode = 'check_violation';
  end if;

  select full_name, branch_id into v_name, v_branch from public.profiles
  where id = p_profile_id and company_id = v_company;
  if not found then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- El adelanto sale de la gaveta: si no cae en una caja abierta, el arqueo de
  -- esa noche descuadra sin explicación.
  if p_cash_session_id is not null then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and company_id = v_company and status = 'open';
    if v_session.id is null then
      raise exception 'La sesión de caja no existe o no está abierta.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.payroll_advances (
    company_id, branch_id, profile_id, amount_cents, reason, cash_session_id, created_by
  ) values (
    v_company, coalesce(v_session.branch_id, v_branch), p_profile_id,
    p_amount_cents, p_reason, p_cash_session_id, auth.uid()
  )
  returning * into v_advance;

  if v_session.id is not null then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, created_by
    ) values (
      v_company, v_session.id, 'outflow', 'efectivo', p_amount_cents,
      'Adelanto de nómina: ' || coalesce(v_name, '—'), auth.uid()
    );
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_advance.branch_id, 'ADELANTO_NOMINA', 'Profile', p_profile_id::text,
          format('%s · %s centavos%s', coalesce(v_name, '—'), p_amount_cents,
                 coalesce(' · ' || p_reason, '')));

  return v_advance;
end;
$$;

grant execute on function public.register_payroll_advance(uuid, bigint, text, uuid) to authenticated;

-- =============================================================================
-- public.open_payroll_period · calcula la nómina del periodo
-- =============================================================================
-- Deja el periodo en BORRADOR con una partida por empleado activo. Amarra a
-- cada partida las comisiones y los adelantos que recoge: a partir de ese
-- momento ninguna otra nómina puede volver a cogerlos.
create or replace function public.open_payroll_period(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null,
  p_notes     text default null
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_period  public.payroll_periods;
  v_emp     record;
  v_item    public.payroll_items;
  v_days    integer;
  v_base    bigint;
  v_minutes integer;
  v_comm    bigint;
  v_adv     bigint;
  v_count   integer := 0;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite abrir nóminas.' using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payroll_periods
             where company_id = v_company and period_from = p_from and period_to = p_to) then
    raise exception 'Ya existe una nómina para ese periodo.' using errcode = 'unique_violation';
  end if;

  v_days := (p_to - p_from) + 1;

  insert into public.payroll_periods (
    company_id, branch_id, period_from, period_to, notes, created_by
  ) values (v_company, p_branch_id, p_from, p_to, p_notes, auth.uid())
  returning * into v_period;

  for v_emp in
    select id, full_name, payroll_type, base_salary_cents, hourly_rate_cents
    from public.profiles
    where company_id = v_company and is_active
      and (p_branch_id is null or branch_id = p_branch_id)
    order by full_name
  loop
    -- Horas efectivamente trabajadas en el periodo (solo jornadas cerradas).
    select coalesce(sum(worked_minutes), 0) into v_minutes
    from public.attendance_records
    where profile_id = v_emp.id
      and checked_out_at is not null
      and checked_in_at >= p_from
      and checked_in_at < p_to + 1;

    v_base := case v_emp.payroll_type
      -- Mensual prorrateado sobre 30 días: es como se paga la quincena.
      when 'mensual'  then round(v_emp.base_salary_cents::numeric * v_days / 30)::bigint
      when 'por_hora' then round(v_emp.hourly_rate_cents::numeric * v_minutes / 60)::bigint
      else 0
    end;

    select coalesce(sum(amount_cents), 0) into v_comm
    from public.commissions
    where profile_id = v_emp.id and company_id = v_company
      and payroll_item_id is null and not is_paid
      and earned_on between p_from and p_to;

    select coalesce(sum(amount_cents), 0) into v_adv
    from public.payroll_advances
    where profile_id = v_emp.id and company_id = v_company
      and payroll_item_id is null;

    -- A quien no se le debe nada no se le abre partida: una nómina llena de
    -- ceros esconde a los que sí cobran.
    continue when v_base = 0 and v_comm = 0 and v_adv = 0;

    insert into public.payroll_items (
      company_id, period_id, profile_id, payroll_type, base_cents,
      worked_minutes, commissions_cents, advances_cents, net_cents
    ) values (
      v_company, v_period.id, v_emp.id, v_emp.payroll_type, v_base,
      v_minutes, v_comm, v_adv, v_base + v_comm - v_adv
    )
    returning * into v_item;

    update public.commissions set payroll_item_id = v_item.id
    where profile_id = v_emp.id and company_id = v_company
      and payroll_item_id is null and not is_paid
      and earned_on between p_from and p_to;

    update public.payroll_advances set payroll_item_id = v_item.id
    where profile_id = v_emp.id and company_id = v_company
      and payroll_item_id is null;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No hay nada que pagar en ese periodo.' using errcode = 'no_data_found';
  end if;

  v_period := app.recalc_payroll_period(v_period.id);

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ABRIR_NOMINA', 'payroll_period', v_period.id::text,
          format('%s al %s · %s empleados · neto %s centavos',
                 p_from, p_to, v_count, v_period.net_cents));

  return v_period;
end;
$$;

grant execute on function public.open_payroll_period(date, date, uuid, text) to authenticated;

-- Totales del periodo a partir de sus partidas. Un solo sitio los suma.
create or replace function app.recalc_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.payroll_periods;
begin
  update public.payroll_periods p
     set gross_cents      = t.gross,
         deductions_cents = t.deductions,
         net_cents        = t.gross - t.deductions
    from (
      select coalesce(sum(base_cents + commissions_cents + bonus_cents), 0) as gross,
             coalesce(sum(advances_cents + deductions_cents), 0)            as deductions
      from public.payroll_items where period_id = p_period_id
    ) t
   where p.id = p_period_id
  returning p.* into v_period;

  return v_period;
end;
$$;

-- ------------------------------------------------- Ajustar una partida
create or replace function public.adjust_payroll_item(
  p_item_id          uuid,
  p_bonus_cents      bigint default 0,
  p_deductions_cents bigint default 0,
  p_notes            text default null
)
returns public.payroll_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_item    public.payroll_items;
  v_status  app.payroll_status;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite ajustar la nómina.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_bonus_cents, 0) < 0 or coalesce(p_deductions_cents, 0) < 0 then
    raise exception 'Bonos y deducciones no pueden ser negativos.' using errcode = 'check_violation';
  end if;

  -- Dos consultas en vez de una con `i.*, p.status`: mezclar un registro
  -- compuesto y un escalar en el mismo INTO asigna por posición y se presta a
  -- errores silenciosos.
  select * into v_item from public.payroll_items
  where id = p_item_id and company_id = v_company;
  if v_item.id is null then
    raise exception 'Partida inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  select status into v_status from public.payroll_periods where id = v_item.period_id;
  if v_status <> 'borrador' then
    raise exception 'La nómina ya está % y no admite ajustes.', v_status
      using errcode = 'check_violation';
  end if;

  update public.payroll_items
     set bonus_cents      = coalesce(p_bonus_cents, 0),
         deductions_cents = coalesce(p_deductions_cents, 0),
         notes            = coalesce(p_notes, notes),
         net_cents        = base_cents + commissions_cents + coalesce(p_bonus_cents, 0)
                            - advances_cents - coalesce(p_deductions_cents, 0)
   where id = p_item_id
  returning * into v_item;

  perform app.recalc_payroll_period(v_item.period_id);

  return v_item;
end;
$$;

grant execute on function public.adjust_payroll_item(uuid, bigint, bigint, text) to authenticated;

-- ---------------------------------------------------------------- Aprobar
create or replace function public.approve_payroll(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_period  public.payroll_periods;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Solo la propiedad o la administración aprueban la nómina.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_period from public.payroll_periods
  where id = p_period_id and company_id = v_company
  for update;
  if v_period.id is null then
    raise exception 'Nómina inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_period.status <> 'borrador' then
    raise exception 'La nómina ya está %.', v_period.status using errcode = 'check_violation';
  end if;

  update public.payroll_periods
     set status = 'aprobada', approved_by = auth.uid(), approved_at = now()
   where id = p_period_id
  returning * into v_period;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_period.branch_id, 'APROBAR_NOMINA', 'payroll_period', p_period_id::text,
          format('%s al %s · neto %s centavos',
                 v_period.period_from, v_period.period_to, v_period.net_cents));

  return v_period;
end;
$$;

grant execute on function public.approve_payroll(uuid) to authenticated;

-- ------------------------------------------------------------------ Pagar
-- Aquí es donde `commissions.is_paid` deja de ser un campo decorativo.
create or replace function public.pay_payroll(
  p_period_id       uuid,
  p_payment_method  app.payment_method default 'efectivo',
  p_cash_session_id uuid default null
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_period  public.payroll_periods;
  v_session public.cash_sessions;
  v_item    record;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Solo la propiedad o la administración pagan la nómina.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_payment_method = 'credito' then
    raise exception 'La nómina no se paga a crédito.' using errcode = 'check_violation';
  end if;

  select * into v_period from public.payroll_periods
  where id = p_period_id and company_id = v_company
  for update;
  if v_period.id is null then
    raise exception 'Nómina inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_period.status <> 'aprobada' then
    raise exception 'Solo se paga una nómina aprobada (esta está %).', v_period.status
      using errcode = 'check_violation';
  end if;

  if p_payment_method = 'efectivo' then
    if p_cash_session_id is null then
      raise exception 'Pagar en efectivo exige la sesión de caja abierta.'
        using errcode = 'invalid_parameter_value';
    end if;
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and company_id = v_company and status = 'open';
    if v_session.id is null then
      raise exception 'La sesión de caja no existe o no está abierta.' using errcode = 'no_data_found';
    end if;
  end if;

  -- Una salida de caja por empleado, no una global: así el arqueo se puede
  -- explicar sobre el recibo que firmó cada quien.
  if v_session.id is not null then
    for v_item in
      select i.net_cents, p.full_name
      from public.payroll_items i
      join public.profiles p on p.id = i.profile_id
      where i.period_id = p_period_id and i.net_cents > 0
    loop
      insert into public.cash_movements (
        company_id, cash_session_id, type, method, amount_cents, reason, created_by
      ) values (
        v_company, v_session.id, 'outflow', 'efectivo', v_item.net_cents,
        format('Nómina %s al %s: %s', v_period.period_from, v_period.period_to, v_item.full_name),
        auth.uid()
      );
    end loop;
  end if;

  -- Las comisiones recogidas por esta nómina quedan saldadas. Antes de 0030
  -- `is_paid` no lo cambiaba nadie y las comisiones se acumulaban para siempre.
  update public.commissions c
     set is_paid = true, paid_at = now()
    from public.payroll_items i
   where i.period_id = p_period_id and c.payroll_item_id = i.id;

  update public.payroll_periods
     set status = 'pagada', paid_by = auth.uid(), paid_at = now(),
         payment_method = p_payment_method
   where id = p_period_id
  returning * into v_period;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_period.branch_id, 'PAGAR_NOMINA', 'payroll_period', p_period_id::text,
          format('%s al %s · %s centavos por %s',
                 v_period.period_from, v_period.period_to, v_period.net_cents, p_payment_method),
          jsonb_build_object('net_cents', v_period.net_cents, 'method', p_payment_method));

  return v_period;
end;
$$;

grant execute on function public.pay_payroll(uuid, app.payment_method, uuid) to authenticated;

-- --------------------------------------------------- Descartar un borrador
-- Suelta comisiones y adelantos para que otra nómina pueda recogerlos.
create or replace function public.delete_payroll_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_period  public.payroll_periods;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Su rol no permite descartar nóminas.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_period from public.payroll_periods
  where id = p_period_id and company_id = v_company
  for update;
  if v_period.id is null then
    raise exception 'Nómina inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_period.status <> 'borrador' then
    raise exception 'Solo se descarta un borrador (esta está %).', v_period.status
      using errcode = 'check_violation';
  end if;

  -- El ON DELETE SET NULL de las claves foráneas los soltaría igual, pero
  -- hacerlo explícito deja claro que es la intención, no un efecto colateral.
  update public.commissions c set payroll_item_id = null
   where c.payroll_item_id in (select id from public.payroll_items where period_id = p_period_id);
  update public.payroll_advances a set payroll_item_id = null
   where a.payroll_item_id in (select id from public.payroll_items where period_id = p_period_id);

  delete from public.payroll_periods where id = p_period_id;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_period.branch_id, 'DESCARTAR_NOMINA', 'payroll_period', p_period_id::text,
          format('%s al %s', v_period.period_from, v_period.period_to));
end;
$$;

grant execute on function public.delete_payroll_period(uuid) to authenticated;

-- =============================================================================
-- public.create_employee · reinstalada para convivir con el guardia de sueldo
-- =============================================================================
-- Idéntica a 0013 salvo que declara el contexto antes de completar el perfil:
-- fija la comisión inicial, y sin el contexto el guardia la rechazaría.
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
  perform set_config('app.payroll_ctx', 'ok', true);
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
  perform set_config('app.payroll_ctx', '', true);

  -- 7. Bitácora (el actor lo sella el servidor por trigger).
  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ALTA_EMPLEADO', 'Profile', v_uid::text,
          trim(p_full_name) || ' (' || p_role || ')');

  return v_profile;
end;
$$;

grant execute on function public.create_employee(text, text, text, app.user_role, uuid, text, integer)
  to authenticated;

comment on table public.work_shifts is
  'Turno planificado por empleado. Sin solapes: dos turnos encima son un error de planificación.';
comment on table public.attendance_records is
  'Marcaje real de entrada y salida. La tardanza se mide contra el turno del día, si lo hay.';
comment on table public.payroll_advances is
  'Adelantos a cuenta de nómina. Salen de la caja abierta y se descuentan en la partida que los recoge.';
comment on table public.payroll_periods is
  'Nómina de un periodo: borrador → aprobada → pagada. Pagarla salda comisiones y adelantos.';
comment on table public.payroll_items is
  'Partida por empleado: base, horas, comisiones, bonos, adelantos y deducciones. Neto = lo que se le entrega.';
