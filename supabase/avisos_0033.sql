-- =============================================================================
-- PARCHE 0033 (editor SQL de Supabase) · Notificaciones y avisos
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches 0028 a 0032. Es idempotente: puedes correrlo más de una vez sin daño.
--
-- Es el último de la Fase 3. No cambia nada de lo que ya funciona: solo añade
-- una bandeja de avisos que se llena sola.
-- =============================================================================

do $do$ begin
  create type app.notification_kind as enum (
    'orden_lista', 'recordatorio_cita', 'stock_bajo', 'cuenta_vencida',
    'mantenimiento_pendiente', 'caja_sin_cerrar', 'otro');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.notification_audience as enum ('cliente', 'interno');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.notification_channel as enum ('whatsapp', 'sms', 'email', 'app');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.notification_status as enum ('pendiente', 'enviado', 'descartado', 'fallido');
exception when duplicate_object then null; end $do$;

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete set null,
  kind            app.notification_kind not null,
  audience        app.notification_audience not null,
  channel         app.notification_channel not null default 'app',
  status          app.notification_status not null default 'pendiente',
  title           text not null check (length(trim(title)) > 0),
  body            text not null default '',
  -- A qué se refiere el aviso. Todo opcional: un stock bajo no tiene cliente.
  customer_id     uuid,
  work_order_id   uuid,
  appointment_id  uuid,
  recipient_phone text,
  recipient_email text,
  -- Llave de deduplicación. Es lo que impide que la bandeja se llene de copias
  -- del mismo aviso cada vez que se refrescan las alertas.
  dedupe_key      text not null,
  -- Para recordatorios: no tiene sentido enseñarlo antes de esta hora.
  scheduled_for   timestamptz not null default now(),
  sent_at         timestamptz,
  sent_by         uuid references public.profiles(id) on delete set null,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, dedupe_key),
  constraint notifications_sent_is_complete check (
    (status <> 'enviado') or sent_at is not null
  )
);

create index if not exists notifications_pending_idx
  on public.notifications (company_id, scheduled_for)
  where status = 'pendiente';
create index if not exists notifications_kind_idx on public.notifications (company_id, kind, created_at desc);

drop trigger if exists notifications_touch on public.notifications;
create trigger notifications_touch before update on public.notifications
  for each row execute function app.touch_updated_at();

alter table public.notifications enable row level security;
alter table public.notifications force  row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.notifications to authenticated;

-- Alcance por sucursal, como el resto de lo operativo (0031).
drop policy if exists notifications_branch_scope on public.notifications;
create policy notifications_branch_scope on public.notifications
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));

-- =============================================================================
-- app.enqueue_notification · encolar sin duplicar
-- =============================================================================
-- Devuelve true si el aviso es NUEVO. Si ya estaba —aunque se hubiera enviado o
-- descartado— no lo repite: la llave de deduplicación manda.
create or replace function app.enqueue_notification(
  p_company    uuid,
  p_kind       app.notification_kind,
  p_audience   app.notification_audience,
  p_title      text,
  p_body       text,
  p_dedupe_key text,
  p_branch_id  uuid default null,
  p_channel    app.notification_channel default 'app',
  p_customer_id uuid default null,
  p_order_id   uuid default null,
  p_appointment_id uuid default null,
  p_phone      text default null,
  p_email      text default null,
  p_scheduled_for timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (
    company_id, branch_id, kind, audience, channel, title, body,
    customer_id, work_order_id, appointment_id, recipient_phone, recipient_email,
    dedupe_key, scheduled_for
  ) values (
    p_company, p_branch_id, p_kind, p_audience, p_channel, p_title, coalesce(p_body, ''),
    p_customer_id, p_order_id, p_appointment_id, p_phone, p_email,
    p_dedupe_key, coalesce(p_scheduled_for, now())
  )
  on conflict (company_id, dedupe_key) do nothing;

  return found;
end;
$$;

comment on function app.enqueue_notification is
  'Encola un aviso si no existía ya con esa llave. Devuelve true solo cuando es nuevo.';

-- =============================================================================
-- Aviso al cliente cuando su vehículo queda listo
-- =============================================================================
-- Un trigger sobre work_orders, no un cambio en advance_work_order: el aviso es
-- consecuencia del estado, no de quién lo cambió. Así también se cubre
-- cualquier otro camino que deje una orden en «listo».
create or replace function app.notify_order_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_empresa text;
begin
  if new.status = 'listo' and old.status is distinct from 'listo' then
    select trade_name into v_empresa from public.companies where id = new.company_id;

    perform app.enqueue_notification(
      p_company    => new.company_id,
      p_kind       => 'orden_lista',
      p_audience   => 'cliente',
      p_title      => format('%s · vehículo listo', new.vehicle_plate),
      p_body       => format(
        '%s, su vehículo %s ya está listo para retirar en %s. Orden %s. ¡Gracias!',
        coalesce(nullif(trim(new.customer_name), ''), 'Estimado cliente'),
        new.vehicle_plate, coalesce(v_empresa, 'el car wash'), new.order_number),
      p_dedupe_key => 'orden_lista:' || new.id::text,
      p_branch_id  => new.branch_id,
      -- Sin teléfono no hay a quién escribirle: queda como aviso interno para
      -- que la recepción sepa que hay que llamar.
      p_channel    => (case when new.customer_phone is not null
                            then 'whatsapp' else 'app' end)::app.notification_channel,
      p_customer_id => new.customer_id,
      p_order_id   => new.id,
      p_phone      => new.customer_phone
    );
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_notify_ready on public.work_orders;
create trigger work_orders_notify_ready
  after update on public.work_orders
  for each row execute function app.notify_order_ready();

-- =============================================================================
-- public.refresh_alerts · barre la base y encola lo que haga falta
-- =============================================================================
-- Idempotente por construcción: la llave de deduplicación lleva la fecha, así
-- que cada aviso se repite como mucho una vez al día. Se puede llamar al abrir
-- la pantalla sin miedo, o desde una tarea programada.
create or replace function public.refresh_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_hoy     text := current_date::text;
  v_row     record;
  v_stock   integer := 0;
  v_venc    integer := 0;
  v_mant    integer := 0;
  v_citas   integer := 0;
  v_caja    integer := 0;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite refrescar los avisos.' using errcode = 'insufficient_privilege';
  end if;

  -- ------------------------------------------------------------ Stock bajo
  for v_row in
    select id, branch_id, name, code, stock, min_stock, unit
    from public.products
    where company_id = v_company and is_active and stock <= min_stock
  loop
    if app.enqueue_notification(
      v_company, 'stock_bajo', 'interno',
      format('%s bajo mínimo', v_row.name),
      format('Quedan %s %s de %s (mínimo %s). Toca reponer.',
             v_row.stock, coalesce(v_row.unit, 'u'), v_row.code, v_row.min_stock),
      'stock_bajo:' || v_row.id::text || ':' || v_hoy,
      v_row.branch_id
    ) then
      v_stock := v_stock + 1;
    end if;
  end loop;

  -- ------------------------------------------------------ Cuentas vencidas
  for v_row in
    select r.id, r.branch_id, r.due_on, r.total_cents - r.paid_cents as saldo,
           c.name as cliente
    from public.receivables r
    join public.customers c on c.id = r.customer_id
    where r.company_id = v_company and r.status = 'pendiente' and r.due_on < current_date
  loop
    if app.enqueue_notification(
      v_company, 'cuenta_vencida', 'interno',
      format('%s debe desde el %s', v_row.cliente, v_row.due_on),
      format('Saldo vencido de %s centavos, %s días de atraso.',
             v_row.saldo, current_date - v_row.due_on),
      'cuenta_vencida:' || v_row.id::text || ':' || v_hoy,
      v_row.branch_id
    ) then
      v_venc := v_venc + 1;
    end if;
  end loop;

  -- -------------------------------------------------- Mantenimiento vencido
  for v_row in
    select id, branch_id, name, next_service_at
    from public.equipment
    where company_id = v_company and status <> 'retirado'
      and next_service_at is not null and next_service_at <= current_date
  loop
    if app.enqueue_notification(
      v_company, 'mantenimiento_pendiente', 'interno',
      format('%s necesita mantenimiento', v_row.name),
      format('Le tocaba el %s. Un equipo parado en hora punta cuesta más que el servicio.',
             v_row.next_service_at),
      'mantenimiento:' || v_row.id::text || ':' || v_hoy,
      v_row.branch_id
    ) then
      v_mant := v_mant + 1;
    end if;
  end loop;

  -- ------------------------------------------------- Citas de las próximas 24 h
  for v_row in
    select a.id, a.branch_id, a.customer_name, a.customer_phone,
           a.vehicle_plate, a.scheduled_at, a.service_name
    from public.appointments a
    where a.company_id = v_company
      and a.status in ('pendiente', 'confirmada')
      and a.scheduled_at >= now()
      and a.scheduled_at < now() + interval '24 hours'
  loop
    if app.enqueue_notification(
      v_company, 'recordatorio_cita',
      (case when v_row.customer_phone is not null
            then 'cliente' else 'interno' end)::app.notification_audience,
      format('Cita de %s', v_row.customer_name),
      format('%s, le recordamos su cita del %s para %s (%s).',
             v_row.customer_name,
             to_char(v_row.scheduled_at, 'DD/MM a las HH24:MI'),
             coalesce(v_row.service_name, 'su servicio'), v_row.vehicle_plate),
      'cita:' || v_row.id::text,
      v_row.branch_id,
      (case when v_row.customer_phone is not null
            then 'whatsapp' else 'app' end)::app.notification_channel,
      null, null, v_row.id, v_row.customer_phone
    ) then
      v_citas := v_citas + 1;
    end if;
  end loop;

  -- ------------------------------------------- Caja abierta de un día anterior
  -- Una caja que no se cierra al terminar el turno es un arqueo que ya no se
  -- puede cuadrar contra nada.
  for v_row in
    select cs.id, cs.branch_id, cs.opened_at, b.name as sucursal
    from public.cash_sessions cs
    left join public.branches b on b.id = cs.branch_id
    where cs.company_id = v_company and cs.status = 'open'
      and cs.opened_at::date < current_date
  loop
    if app.enqueue_notification(
      v_company, 'caja_sin_cerrar', 'interno',
      format('Caja sin cerrar en %s', coalesce(v_row.sucursal, 'la sucursal')),
      format('Abierta desde el %s. Un arqueo tardío ya no cuadra contra nada.',
             to_char(v_row.opened_at, 'DD/MM')),
      'caja_sin_cerrar:' || v_row.id::text || ':' || v_hoy,
      v_row.branch_id
    ) then
      v_caja := v_caja + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'stock_bajo', v_stock,
    'cuentas_vencidas', v_venc,
    'mantenimiento', v_mant,
    'citas', v_citas,
    'caja_sin_cerrar', v_caja,
    'total', v_stock + v_venc + v_mant + v_citas + v_caja
  );
end;
$$;

grant execute on function public.refresh_alerts() to authenticated;

comment on function public.refresh_alerts is
  'Barre stock, cobros, equipos, citas y cajas, y encola los avisos que falten. '
  'Idempotente: la llave de deduplicación lleva la fecha, así que no repite en el día.';

-- =============================================================================
-- Marcar y descartar
-- =============================================================================
create or replace function public.mark_notification(
  p_notification_id uuid,
  p_status          app.notification_status,
  p_error           text default null
)
returns public.notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_notif   public.notifications;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada.' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'pendiente' then
    raise exception 'Un aviso no vuelve a pendiente: se resuelve o se descarta.'
      using errcode = 'check_violation';
  end if;

  update public.notifications
     set status  = p_status,
         sent_at = case when p_status = 'enviado' then now() else sent_at end,
         sent_by = case when p_status = 'enviado' then auth.uid() else sent_by end,
         error   = p_error
   where id = p_notification_id and company_id = v_company and status = 'pendiente'
  returning * into v_notif;

  if v_notif.id is null then
    raise exception 'Aviso inexistente, fuera de su alcance o ya resuelto.'
      using errcode = 'no_data_found';
  end if;

  return v_notif;
end;
$$;

grant execute on function public.mark_notification(uuid, app.notification_status, text)
  to authenticated;

comment on table public.notifications is
  'Bandeja de salida de avisos: al cliente (vehículo listo, recordatorio de cita) y al '
  'negocio (stock, cobros vencidos, equipos, caja). dedupe_key impide repetirlos.';
