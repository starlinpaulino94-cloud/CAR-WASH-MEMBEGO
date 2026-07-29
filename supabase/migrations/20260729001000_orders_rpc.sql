-- =============================================================================
-- 0010 · Órdenes de trabajo: máquina de estados, bahías y comisiones
-- =============================================================================
-- Necesario para que las vistas de Órdenes y Kanban signifiquen algo.
--
-- Lo que resuelve, de la auditoría:
--
--   M7  La lógica de bahías era ficticia: el Kanban llamaba a updateOrderStatus
--       con 'bay-1' codificado y washers[0], sin comprobar capacidad, y
--       updateBayStatus NUNCA se invocaba desde el flujo de órdenes, de modo
--       que las bahías y las órdenes discrepaban de forma permanente.
--   §14.4 Las comisiones se sembraban y mostraban, pero ningún camino de código
--       las generaba: setCommissions se declaraba y no se llamaba jamás.
--   §4.1 Cambiar de estado tocaba varias entidades sin atomicidad.
--
-- Y algo que la aplicación auditada no tenía en absoluto: **validación de las
-- transiciones**. Cualquier estado podía saltar a cualquier otro, incluso desde
-- una llamada directa al API. Aquí la máquina de estados la impone la base.
-- =============================================================================

-- Idempotencia también al crear órdenes: dos toques en "Registrar llegada" no
-- deben producir dos órdenes para el mismo vehículo.
alter table public.work_orders add column client_request_id text;

create unique index work_orders_idempotency_unique
  on public.work_orders (company_id, client_request_id)
  where client_request_id is not null;

-- ------------------------------------------------------- Máquina de estados

/**
 * Transiciones permitidas. `entregado` y `cancelado` son terminales.
 * Se admite retroceso de `control_calidad` y `listo` a `en_proceso` porque el
 * repaso de un lavado mal terminado es parte normal de la operación.
 */
create or replace function app.order_transition_allowed(
  p_from app.order_status,
  p_to   app.order_status
)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'pendiente'       then p_to in ('en_espera','asignada','en_proceso','cancelado')
    when 'en_espera'       then p_to in ('asignada','en_proceso','cancelado')
    when 'asignada'        then p_to in ('en_proceso','en_espera','cancelado')
    when 'en_proceso'      then p_to in ('control_calidad','listo','cancelado')
    when 'control_calidad' then p_to in ('listo','en_proceso','cancelado')
    when 'listo'           then p_to in ('entregado','control_calidad')
    else false                                  -- entregado y cancelado: terminales
  end
$$;

create or replace function app.enforce_order_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not app.order_transition_allowed(old.status, new.status) then
    raise exception 'Transición no permitida: % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger work_orders_enforce_transition
  before update of status on public.work_orders
  for each row execute function app.enforce_order_transition();

-- ---------------------------------------------------- Asignación de operarios

-- Los operarios asignados dejan de vivir como array de texto dentro de la orden
-- (donde el nombre se copiaba y quedaba obsoleto) y pasan a ser una relación.
create table public.work_order_assignees (
  work_order_id uuid not null,
  profile_id    uuid not null,
  company_id    uuid not null,
  assigned_at   timestamptz not null default now(),
  primary key (work_order_id, profile_id),
  constraint work_order_assignees_order_same_company
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
    on delete cascade,
  constraint work_order_assignees_profile_same_company
    foreign key (profile_id, company_id) references public.profiles(id, company_id)
    on delete cascade
);

create index work_order_assignees_profile_idx on public.work_order_assignees (profile_id);

alter table public.work_order_assignees enable row level security;
alter table public.work_order_assignees force row level security;

create policy work_order_assignees_select on public.work_order_assignees
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy work_order_assignees_write on public.work_order_assignees
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- Los `grant` de la migración 0007 se aplicaron sobre las tablas que existían
-- ENTONCES: una tabla creada después nace sin permisos y RLS ni siquiera llega
-- a evaluarse (el error es "permission denied", no "no rows"). Lo detectaron
-- las pruebas de esta misma migración.
-- Esta tabla es la única excepción a la regla de «el rol autenticado no borra».
-- No es un registro contable: es la asignación vigente de operarios a una
-- orden, y reasignar a un lavador exige retirar la anterior. Qué filas puede
-- tocar cada usuario lo sigue decidiendo RLS.
grant select, insert, update, delete on public.work_order_assignees to authenticated;

-- Y para que no vuelva a ocurrir con la siguiente tabla: las que cree este rol
-- de aquí en adelante reciben los permisos automáticamente. Las políticas RLS
-- siguen siendo obligatorias — un grant no sustituye a una política.
alter default privileges in schema public
  grant select, insert, update on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- ---------------------------------------------------------- Crear una orden

create or replace function public.create_work_order(
  p_branch_id         uuid,
  p_client_request_id text,
  p_vehicle_plate     text,
  p_vehicle_category  app.vehicle_category,
  p_items             jsonb,
  p_customer_name     text default null,
  p_customer_id       uuid default null,
  p_customer_phone    text default null,
  p_vehicle_make      text default '',
  p_vehicle_model     text default '',
  p_vehicle_color     text default '',
  p_priority          text default 'normal',
  p_notes             text default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_existing public.work_orders;
  v_order    public.work_orders;
  v_customer uuid := p_customer_id;
  v_vehicle  uuid;
  v_plate    text;
  v_item     record;
  v_price    bigint;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- Un segundo toque en "Registrar llegada" devuelve la orden ya creada.
  select * into v_existing from public.work_orders
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden necesita al menos un servicio'
      using errcode = 'invalid_parameter_value';
  end if;

  v_plate := upper(regexp_replace(coalesce(p_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_plate) = 0 then
    raise exception 'La placa del vehículo es obligatoria' using errcode = 'invalid_parameter_value';
  end if;

  -- Cliente. `p_customer_name` a NULL significa visitante anónimo: no se crea
  -- ficha para no llenar el directorio de "Cliente General" duplicados. Si la
  -- recepción escribió un nombre O un teléfono, sí se registra: es información
  -- que alguien se molestó en pedir.
  if v_customer is null and (p_customer_name is not null or p_customer_phone is not null) then
    insert into public.customers (company_id, branch_id, name, phone)
    values (v_company, p_branch_id, coalesce(nullif(trim(p_customer_name), ''), 'Cliente General'),
            p_customer_phone)
    returning id into v_customer;
  end if;

  -- Vehículo: la placa es única por empresa, así que se reutiliza el registro.
  select id into v_vehicle from public.vehicles
  where company_id = v_company and plate = v_plate;

  if v_vehicle is null then
    insert into public.vehicles (company_id, customer_id, plate, make, model, color, category)
    values (v_company, v_customer, v_plate, p_vehicle_make, p_vehicle_model,
            p_vehicle_color, p_vehicle_category)
    returning id into v_vehicle;
  elsif v_customer is not null then
    update public.vehicles set customer_id = v_customer
    where id = v_vehicle and customer_id is null;
  end if;

  insert into public.work_orders (
    company_id, branch_id, client_request_id, customer_id, customer_name, customer_phone,
    vehicle_id, vehicle_plate, vehicle_make_model, vehicle_category, vehicle_color,
    status, priority, notes, created_by
  ) values (
    v_company, p_branch_id, p_client_request_id, v_customer,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente General'), p_customer_phone,
    v_vehicle, v_plate, trim(coalesce(p_vehicle_make,'') || ' ' || coalesce(p_vehicle_model,'')),
    p_vehicle_category, coalesce(p_vehicle_color,''),
    'pendiente', p_priority, p_notes, auth.uid()
  )
  returning * into v_order;

  -- Líneas con el precio del catálogo. El cliente no fija importes.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      service_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida en "%"', v_item.name using errcode = 'invalid_parameter_value';
    end if;

    v_price := app.resolve_item_price('service', v_item.service_id, null, p_vehicle_category);

    insert into public.work_order_items (
      work_order_id, item_type, service_id, name, quantity,
      unit_price_cents, discount_cents, is_membego_covered
    ) values (
      v_order.id, 'service', v_item.service_id, v_item.name, v_item.quantity,
      v_price,
      case when coalesce(v_item.is_membego_covered,false) then 0 else coalesce(v_item.discount_cents,0) end,
      coalesce(v_item.is_membego_covered, false)
    );
  end loop;

  -- Los totales los recalculó el trigger de las líneas.
  select * into v_order from public.work_orders where id = v_order.id;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'NUEVA_LLEGADA_ORDEN', 'WorkOrder', v_order.id::text,
          'Orden ' || v_order.order_number || ' · ' || v_plate || ' · ' || v_order.customer_name);

  return v_order;
end;
$$;

-- ------------------------------------------------------ Avanzar de estado

/**
 * Cambia el estado de una orden y todo lo que ello arrastra, atómicamente:
 * ocupación de la bahía, operarios asignados y, al entregar, las comisiones.
 *
 * La bahía se libera al SALIR de `en_proceso`: es cuando el vehículo abandona
 * físicamente la estación de lavado.
 */
create or replace function public.advance_work_order(
  p_order_id     uuid,
  p_new_status   app.order_status,
  p_bay_id       uuid   default null,
  p_assignees    uuid[] default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_order    public.work_orders;
  v_bay      public.bays;
  v_result   public.work_orders;
  v_rows     integer;
  v_profile  uuid;
  v_service  record;
  v_n        integer;
  v_share    bigint;
  v_bps      integer;
begin
  v_company := app.current_company_id();

  -- FOR UPDATE serializa a dos operarios moviendo la misma tarjeta a la vez.
  select * into v_order from public.work_orders
  where id = p_order_id and company_id = v_company
  for update;

  if v_order.id is null then
    raise exception 'Orden % inexistente o fuera de su alcance', p_order_id
      using errcode = 'no_data_found';
  end if;

  if not app.order_transition_allowed(v_order.status, p_new_status) then
    raise exception 'No se puede pasar de "%" a "%"', v_order.status, p_new_status
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------------------- Bahía
  if p_new_status = 'en_proceso' then
    if p_bay_id is null then
      raise exception 'Iniciar el lavado exige indicar la bahía'
        using errcode = 'invalid_parameter_value';
    end if;

    select * into v_bay from public.bays
    where id = p_bay_id and company_id = v_company
    for update;

    if v_bay.id is null then
      raise exception 'Bahía inexistente' using errcode = 'no_data_found';
    end if;
    if v_bay.branch_id <> v_order.branch_id then
      raise exception 'La bahía pertenece a otra sucursal' using errcode = 'check_violation';
    end if;
    if v_bay.status = 'mantenimiento' then
      raise exception 'La bahía "%" está en mantenimiento', v_bay.name
        using errcode = 'check_violation';
    end if;
    -- Comprobación de capacidad que no existía: el Kanban auditado metía TODOS
    -- los vehículos en 'bay-1'.
    if v_bay.current_work_order_id is not null and v_bay.current_work_order_id <> p_order_id then
      raise exception 'La bahía "%" ya está ocupada', v_bay.name
        using errcode = 'unique_violation';
    end if;

    update public.bays
       set status = 'ocupada', current_work_order_id = p_order_id
     where id = p_bay_id;

  elsif v_order.status = 'en_proceso' then
    -- Sale de lavado: la bahía queda libre.
    update public.bays
       set status = 'disponible', current_work_order_id = null, assigned_profile_id = null
     where current_work_order_id = p_order_id and company_id = v_company;
  end if;

  -- --------------------------------------------------------- Operarios
  if p_assignees is not null then
    delete from public.work_order_assignees where work_order_id = p_order_id;
    foreach v_profile in array p_assignees loop
      insert into public.work_order_assignees (work_order_id, profile_id, company_id)
      values (p_order_id, v_profile, v_company)
      on conflict do nothing;
    end loop;
  end if;

  update public.work_orders
     set status = p_new_status,
         bay_id = case when p_new_status = 'en_proceso' then p_bay_id
                       when v_order.status = 'en_proceso' then null
                       else bay_id end
   where id = p_order_id
  returning * into v_result;

  get diagnostics v_rows = row_count;
  -- RLS filtra en silencio en UPDATE: sin esto, un cambio denegado se
  -- mostraría al operario como realizado.
  if v_rows = 0 then
    raise exception 'No tiene permiso para modificar esta orden'
      using errcode = 'insufficient_privilege';
  end if;

  -- -------------------------------------------------------- Comisiones
  -- Se generan al entregar, que es cuando el trabajo está cobrado y cerrado.
  -- En la aplicación auditada la tabla existía y nada la alimentaba.
  if p_new_status = 'entregado' then
    select count(*) into v_n from public.work_order_assignees where work_order_id = p_order_id;

    if v_n > 0 then
      for v_service in
        select i.id, i.name, i.service_id,
               (i.unit_price_cents * i.quantity - i.discount_cents) as line_cents,
               coalesce(s.commission_bps, 0) as service_bps
        from public.work_order_items i
        left join public.services s on s.id = i.service_id
        where i.work_order_id = p_order_id and i.item_type = 'service'
      loop
        -- Reparto exacto entre los operarios: la división entera se hace sobre
        -- la base, no sobre el importe, para no perder centavos por redondeo.
        v_share := v_service.line_cents / v_n;

        insert into public.commissions (
          company_id, branch_id, profile_id, work_order_id, work_order_item_id,
          service_name, base_cents, commission_bps, amount_cents
        )
        select v_company, v_order.branch_id, a.profile_id, p_order_id, v_service.id,
               v_service.name, v_share,
               coalesce(nullif(p.commission_bps, 0), v_service.service_bps),
               round(v_share::numeric
                     * coalesce(nullif(p.commission_bps, 0), v_service.service_bps) / 10000)::bigint
        from public.work_order_assignees a
        join public.profiles p on p.id = a.profile_id
        where a.work_order_id = p_order_id;
      end loop;
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_order.branch_id, 'CAMBIO_ESTADO_ORDEN', 'WorkOrder', p_order_id::text,
          'Orden ' || v_order.order_number || ': ' || v_order.status || ' → ' || p_new_status,
          jsonb_build_object('from', v_order.status, 'to', p_new_status, 'bay_id', p_bay_id));

  return v_result;
end;
$$;

comment on function public.advance_work_order is
  'Cambio de estado atómico: valida la transición, ocupa o libera la bahía, asigna operarios y genera comisiones al entregar.';

grant execute on function public.create_work_order  to authenticated;
grant execute on function public.advance_work_order to authenticated;
