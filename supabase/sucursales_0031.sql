-- =============================================================================
-- PARCHE 0031 (editor SQL de Supabase) · Multisucursal
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches 0028 (crédito), 0029 (flotillas) y 0030 (nómina).
-- Es idempotente: puedes correrlo más de una vez sin daño.
--
-- NO cambia lo que ve nadie al aplicarlo: todo el mundo nace con alcance
-- «todas». El aislamiento por sucursal se activa persona a persona desde
-- Configuración › Sucursales.
--
-- Sí cambia una cosa de inmediato: la sucursal de un empleado deja de poder
-- moverse con un UPDATE directo sobre su ficha. Solo set_employee_branch().
-- =============================================================================

do $do$ begin
  create type app.branch_scope as enum ('sucursal', 'todas');
exception when duplicate_object then null; end $do$;

alter table public.profiles
  add column if not exists branch_scope app.branch_scope not null default 'todas';

-- El alcance ES el permiso: quien pudiera ampliarse el suyo de «sucursal» a
-- «todas» estaría abriéndose la puerta de los demás locales. Y mover su propio
-- branch_id sería la misma escalada por otro camino. Un guardia aparte del de
-- sueldos (0030) porque es otra cosa la que protege.
create or replace function app.profiles_scope_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.branch_scope is distinct from old.branch_scope
   or new.branch_id    is distinct from old.branch_id)
     and coalesce(current_setting('app.branch_ctx', true), '') <> 'ok' then
    raise exception
      'La sucursal y el alcance no se editan directamente. Use set_employee_branch().'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_scope_guard on public.profiles;
create trigger profiles_scope_guard
  before update on public.profiles
  for each row execute function app.profiles_scope_guard();

-- =============================================================================
-- app.can_see_branch · la frontera
-- =============================================================================
-- Devuelve true si el solicitante puede ver algo que ocurrió en esa sucursal.
-- Las filas sin sucursal (branch_id nulo) las ve todo el mundo: son de empresa,
-- no de local.
create or replace function app.can_see_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.branch_scope = 'todas'
         or p_branch is null
         or p_branch = p.branch_id
     from public.profiles p
     where p.id = auth.uid()),
    -- Sin perfil no se filtra por sucursal: quien no tiene ficha ya está
    -- bloqueado por las políticas permisivas, y el service_role no pasa por
    -- aquí. Devolver false escondería filas a los procesos del servidor.
    true
  );
$$;

comment on function app.can_see_branch is
  'Frontera de sucursal del solicitante. true si su alcance es «todas», si la fila '
  'no tiene sucursal, o si es la suya.';

-- =============================================================================
-- Políticas RESTRICTIVE de alcance
-- =============================================================================
-- Una política restrictiva se combina con AND sobre las permisivas: añade el
-- filtro sin tocar ninguna de las que ya había. Al omitir `with check`,
-- PostgreSQL reutiliza el `using` también para INSERT y UPDATE, de modo que
-- tampoco se puede CREAR nada en una sucursal que no se ve.
--
-- Quedan FUERA a propósito:
--   · customers y vehicles — el cliente es de la empresa; debe encontrarse
--     desde cualquier mostrador.
--   · products, services y ncf_sequences — catálogo y rangos fiscales son de
--     empresa, no de local.
--   · profiles — hay que poder ver a los compañeros.
--   · audit_logs — la bitácora ya está limitada a los roles de gerencia y se
--     lee completa a propósito: es el registro de la empresa.
--   · payroll_periods y payroll_items — la nómina se calcula por empresa.

drop policy if exists work_orders_branch_scope on public.work_orders;
create policy work_orders_branch_scope on public.work_orders
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists invoices_branch_scope on public.invoices;
create policy invoices_branch_scope on public.invoices
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists cash_sessions_branch_scope on public.cash_sessions;
create policy cash_sessions_branch_scope on public.cash_sessions
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists expenses_branch_scope on public.expenses;
create policy expenses_branch_scope on public.expenses
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists bays_branch_scope on public.bays;
create policy bays_branch_scope on public.bays
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists appointments_branch_scope on public.appointments;
create policy appointments_branch_scope on public.appointments
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists inspections_branch_scope on public.vehicle_inspections;
create policy inspections_branch_scope on public.vehicle_inspections
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists qc_reviews_branch_scope on public.qc_reviews;
create policy qc_reviews_branch_scope on public.qc_reviews
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists equipment_branch_scope on public.equipment;
create policy equipment_branch_scope on public.equipment
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists claims_branch_scope on public.claims;
create policy claims_branch_scope on public.claims
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists commissions_branch_scope on public.commissions;
create policy commissions_branch_scope on public.commissions
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists receivables_branch_scope on public.receivables;
create policy receivables_branch_scope on public.receivables
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists purchases_branch_scope on public.purchases;
create policy purchases_branch_scope on public.purchases
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists inventory_movements_branch_scope on public.inventory_movements;
create policy inventory_movements_branch_scope on public.inventory_movements
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists work_shifts_branch_scope on public.work_shifts;
create policy work_shifts_branch_scope on public.work_shifts
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));
drop policy if exists attendance_branch_scope on public.attendance_records;
create policy attendance_branch_scope on public.attendance_records
  as restrictive for all to authenticated using (app.can_see_branch(branch_id));

-- =============================================================================
-- Alta y edición de sucursales
-- =============================================================================
create or replace function public.upsert_branch(
  p_name      text,
  p_branch_id uuid    default null,
  p_address   text    default null,
  p_phone     text    default null,
  p_is_main   boolean default false,
  p_is_active boolean default true
)
returns public.branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_branch  public.branches;
  v_previo  public.branches;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Su rol no permite administrar sucursales.' using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'La sucursal necesita un nombre.' using errcode = 'check_violation';
  end if;

  if p_branch_id is not null then
    select * into v_previo from public.branches
    where id = p_branch_id and company_id = v_company
    for update;
    if v_previo.id is null then
      raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;
  end if;

  -- --------------------------------------------------------------- Bajas
  if p_branch_id is not null and v_previo.is_active and not coalesce(p_is_active, true) then
    if v_previo.is_main then
      raise exception 'La sucursal principal no se desactiva. Nombre otra principal primero.'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.cash_sessions
               where branch_id = p_branch_id and status = 'open') then
      raise exception 'Esa sucursal tiene la caja abierta. Ciérrela antes de desactivarla.'
        using errcode = 'check_violation';
    end if;
    if (select count(*) from public.branches
        where company_id = v_company and is_active) <= 1 then
      raise exception 'No puede quedarse sin sucursales activas.' using errcode = 'check_violation';
    end if;
  end if;

  -- Una sola principal: el índice único parcial lo impone, pero fallaría con un
  -- error de base de datos ilegible. Se cede la principal explícitamente.
  if coalesce(p_is_main, false) then
    update public.branches set is_main = false
    where company_id = v_company and is_main
      and (p_branch_id is null or id <> p_branch_id);
  end if;

  if p_branch_id is null then
    insert into public.branches (company_id, name, address, phone, is_main, is_active)
    values (v_company, trim(p_name), p_address, p_phone,
            coalesce(p_is_main, false), coalesce(p_is_active, true))
    returning * into v_branch;
  else
    update public.branches
       set name      = trim(p_name),
           address   = p_address,
           phone     = p_phone,
           is_main   = coalesce(p_is_main, is_main),
           is_active = coalesce(p_is_active, is_active)
     where id = p_branch_id and company_id = v_company
    returning * into v_branch;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_branch.id,
          case when p_branch_id is null then 'CREAR_SUCURSAL' else 'EDITAR_SUCURSAL' end,
          'branch', v_branch.id::text,
          v_branch.name
            || case when v_branch.is_main then ' · principal' else '' end
            || case when v_branch.is_active then '' else ' · inactiva' end);

  return v_branch;
end;
$$;

grant execute on function public.upsert_branch(text, uuid, text, text, boolean, boolean)
  to authenticated;

-- =============================================================================
-- Sucursal y alcance de un empleado
-- =============================================================================
create or replace function public.set_employee_branch(
  p_profile_id uuid,
  p_branch_id  uuid,
  p_scope      app.branch_scope default 'sucursal'
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
     or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Su rol no permite asignar sucursales.' using errcode = 'insufficient_privilege';
  end if;

  -- Nadie se amplía a sí mismo el alcance. Es la misma regla que impide
  -- ascenderse de rol: cambiar esto es siempre una acción sobre OTRA persona.
  if p_profile_id = auth.uid() then
    raise exception 'No puede cambiar su propia sucursal ni su propio alcance.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_scope = 'sucursal' and p_branch_id is null then
    raise exception 'Para limitar a una sucursal hay que indicar cuál.'
      using errcode = 'check_violation';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and company_id = v_company
  ) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles
     set branch_id = p_branch_id, branch_scope = p_scope
   where id = p_profile_id and company_id = v_company
  returning * into v_profile;
  perform set_config('app.branch_ctx', '', true);

  if v_profile.id is null then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ASIGNAR_SUCURSAL', 'Profile', p_profile_id::text,
          format('%s · alcance %s', v_profile.full_name, v_profile.branch_scope));

  return v_profile;
end;
$$;

grant execute on function public.set_employee_branch(uuid, uuid, app.branch_scope)
  to authenticated;

-- =============================================================================
-- public.create_employee · reinstalada para convivir con el guardia de alcance
-- =============================================================================
-- Idéntica a 0030 salvo que también declara `app.branch_ctx`: al completar el
-- perfil recién creado fija su sucursal, y sin el contexto el guardia nuevo la
-- rechazaría.
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
  perform set_config('app.branch_ctx', 'ok', true);
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
  perform set_config('app.branch_ctx', '', true);

  -- 7. Bitácora (el actor lo sella el servidor por trigger).
  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ALTA_EMPLEADO', 'Profile', v_uid::text,
          trim(p_full_name) || ' (' || p_role || ')');

  return v_profile;
end;
$$;

grant execute on function public.create_employee(text, text, text, app.user_role, uuid, text, integer)
  to authenticated;

-- =============================================================================
-- public.management_report · ahora se puede mirar una sola sucursal
-- =============================================================================
-- Cuerpo idéntico al de 0022: lo único que se añade es el filtro por sucursal
-- en cada subtotal, y las cuentas por cobrar de 0028, que faltaban en el
-- tablero del dueño. `service_consumptions` no lleva sucursal, así que el costo
-- de insumos sigue siendo de empresa; se dice aquí para que no sorprenda al
-- comparar locales.
--
-- Se retira la versión de dos argumentos: `create or replace` con un parámetro
-- nuevo SOBRECARGA en vez de sustituir, y las llamadas antiguas quedarían
-- ambiguas.
drop function if exists public.management_report(date, date);

create or replace function public.management_report(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_sales   jsonb;
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and company_id = v_company
  ) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- Ventas del periodo: facturas vigentes, excluyendo notas de crédito (B04).
  select jsonb_build_object(
    'total_cents',    coalesce(sum(total_cents) filter (where not is_annulled), 0),
    'invoice_count',  count(*) filter (where not is_annulled),
    'annulled_cents', coalesce(sum(total_cents) filter (where is_annulled), 0),
    'annulled_count', count(*) filter (where is_annulled),
    'avg_ticket_cents',
      case when count(*) filter (where not is_annulled) = 0 then 0
           else (sum(total_cents) filter (where not is_annulled)
                 / count(*) filter (where not is_annulled))::bigint end
  ) into v_sales
  from public.invoices
  where company_id = v_company
    and created_at >= p_from and created_at < p_to + 1
    and ncf_type is distinct from 'B04'
    and (p_branch_id is null or branch_id = p_branch_id);

  v_result := jsonb_build_object(
    'from', p_from, 'to', p_to,
    'branch_id', p_branch_id,
    'sales', v_sales,

    -- Cobros registrados en caja por método (entradas ligadas a facturas).
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'amount_cents', amount) order by amount desc)
      from (
        select m.method, sum(m.amount_cents) as amount
        from public.cash_movements m
        -- El movimiento no lleva sucursal: la hereda de su sesión de caja.
        join public.cash_sessions cs on cs.id = m.cash_session_id
        where m.company_id = v_company and m.type = 'inflow'
          and m.created_at >= p_from and m.created_at < p_to + 1
          and (p_branch_id is null or cs.branch_id = p_branch_id)
        group by m.method
      ) t
    ), '[]'::jsonb),

    -- Ventas por servicio (renglones de facturas vigentes).
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', service_id, 'name', name, 'qty', qty, 'sales_cents', amount
      ) order by amount desc)
      from (
        select ii.service_id, ii.name, sum(ii.quantity) as qty,
               sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) as amount
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.company_id = v_company and not i.is_annulled
          and i.ncf_type is distinct from 'B04'
          and i.created_at >= p_from and i.created_at < p_to + 1
          and (p_branch_id is null or i.branch_id = p_branch_id)
          and ii.item_type = 'service'
        group by ii.service_id, ii.name
      ) t
    ), '[]'::jsonb),

    -- Ventas por producto.
    'by_product', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'qty', qty, 'sales_cents', amount
      ) order by amount desc)
      from (
        select ii.product_id, ii.name, sum(ii.quantity) as qty,
               sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) as amount
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.company_id = v_company and not i.is_annulled
          and i.ncf_type is distinct from 'B04'
          and i.created_at >= p_from and i.created_at < p_to + 1
          and (p_branch_id is null or i.branch_id = p_branch_id)
          and ii.item_type = 'product'
        group by ii.product_id, ii.name
      ) t
    ), '[]'::jsonb),

    -- Ventas por cajero.
    'by_employee', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', cashier_id, 'name', full_name, 'invoice_count', n, 'sales_cents', amount
      ) order by amount desc)
      from (
        select i.cashier_id, coalesce(p.full_name, '—') as full_name,
               count(*) as n, sum(i.total_cents) as amount
        from public.invoices i
        left join public.profiles p on p.id = i.cashier_id
        where i.company_id = v_company and not i.is_annulled
          and i.ncf_type is distinct from 'B04'
          and i.created_at >= p_from and i.created_at < p_to + 1
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by i.cashier_id, p.full_name
      ) t
    ), '[]'::jsonb),

    -- Gastos del periodo por categoría.
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'amount_cents', amount) order by amount desc)
      from (
        select category, sum(amount_cents) as amount
        from public.expenses
        where company_id = v_company
          and expense_date between p_from and p_to
          and (p_branch_id is null or branch_id = p_branch_id)
        group by category
      ) t
    ), '[]'::jsonb),
    'expenses_total_cents', coalesce((
      select sum(amount_cents) from public.expenses
      where company_id = v_company and expense_date between p_from and p_to
        and (p_branch_id is null or branch_id = p_branch_id)
    ), 0),

    -- Compras del periodo y cuentas por pagar VIGENTES (independiente del rango).
    'purchases_total_cents', coalesce((
      select sum(total_cents) from public.purchases
      where company_id = v_company and status = 'recibida'
        and purchase_date between p_from and p_to
        and (p_branch_id is null or branch_id = p_branch_id)
    ), 0),
    'payables_cents', coalesce((
      select sum(total_cents - paid_cents) from public.purchases
      where company_id = v_company and status = 'recibida'
        and paid_cents < total_cents
        and (p_branch_id is null or branch_id = p_branch_id)
    ), 0),

    -- Cuentas por cobrar VIGENTES (0028): lo fiado que todavía no ha entrado.
    'receivables_cents', coalesce((
      select sum(total_cents - paid_cents) from public.receivables
      where company_id = v_company and status = 'pendiente'
        and (p_branch_id is null or branch_id = p_branch_id)
    ), 0),

    -- Costo de insumos consumidos por recetas en el periodo.
    'consumption_cents', coalesce((
      select sum(cost_cents) from public.service_consumptions
      where company_id = v_company
        and created_at >= p_from and created_at < p_to + 1
    ), 0),

    -- Margen por servicio: ventas del servicio − costo de insumos consumidos.
    'service_margin', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', sid, 'name', sname,
        'sales_cents', sales, 'consumption_cents', cons,
        'margin_cents', sales - cons
      ) order by (sales - cons) desc)
      from (
        select coalesce(v.service_id, c.service_id) as sid,
               coalesce(v.name, s.name, '—') as sname,
               coalesce(v.amount, 0) as sales,
               coalesce(c.cost, 0) as cons
        from (
          select ii.service_id, ii.name,
                 sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) as amount
          from public.invoice_items ii
          join public.invoices i on i.id = ii.invoice_id
          where i.company_id = v_company and not i.is_annulled
            and i.ncf_type is distinct from 'B04'
            and i.created_at >= p_from and i.created_at < p_to + 1
            and (p_branch_id is null or i.branch_id = p_branch_id)
          and (p_branch_id is null or i.branch_id = p_branch_id)
            and ii.item_type = 'service' and ii.service_id is not null
          group by ii.service_id, ii.name
        ) v
        full outer join (
          select service_id, sum(cost_cents) as cost
          from public.service_consumptions
          where company_id = v_company and service_id is not null
            and created_at >= p_from and created_at < p_to + 1
          group by service_id
        ) c on c.service_id = v.service_id
        left join public.services s on s.id = coalesce(v.service_id, c.service_id)
      ) t
    ), '[]'::jsonb)
  );

  -- Utilidad bruta estimada del periodo: ventas − insumos consumidos − gastos.
  v_result := v_result || jsonb_build_object(
    'gross_profit_cents',
      (v_sales ->> 'total_cents')::bigint
      - (v_result ->> 'consumption_cents')::bigint
      - (v_result ->> 'expenses_total_cents')::bigint
  );

  return v_result;
end;
$$;

grant execute on function public.management_report(date, date, uuid) to authenticated;

comment on function public.management_report(date, date, uuid) is
  'Reporte gerencial del periodo, opcionalmente de una sola sucursal: ventas, métodos, '
  'servicios, productos, cajeros, gastos, compras, por cobrar, insumos y margen. '
  'SECURITY INVOKER: la RLS del solicitante acota cada subtotal a su empresa y a su alcance.';

comment on column public.profiles.branch_scope is
  '«todas» = ve todas las sucursales de la empresa; «sucursal» = solo la suya. '
  'Solo lo cambia set_employee_branch(), y nunca sobre uno mismo.';
