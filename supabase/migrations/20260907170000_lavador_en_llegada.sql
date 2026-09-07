-- ============================================================================
-- ASIGNAR EL LAVADOR EN LA LLEGADA
-- ============================================================================
-- Hasta aquí el operario se elegía al INICIAR el lavado, desde el tablero
-- (`advance_work_order`). Pero en el mostrador la decisión se toma antes: el
-- cliente llega, se le asigna quién le lava el carro y se le entrega la
-- comanda para que él mismo se la dé al lavador. Sin poder asignar en la
-- llegada, ese papel salía sin nombre y la asignación real ocurría en otro
-- sitio y en otro momento — o no ocurría.
--
-- No hay tabla nueva: `work_order_assignees` ya existe y es la que alimenta las
-- comisiones al entregar. Esto solo permite escribirla desde el primer paso.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ SE BORRA LA FUNCIÓN ANTES DE CREARLA
--
-- `create or replace` con un parámetro nuevo NO reemplaza: deja las dos firmas
-- vivas como sobrecargas, y entonces PostgREST no sabe cuál llamar y responde
-- PGRST203. Por eso se borra la firma vieja explícitamente.
-- ============================================================================

drop function if exists public.create_work_order(
  uuid, text, text, app.vehicle_category, jsonb, text, uuid, text, text, text, text, text, text
);

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
  p_notes             text default null,
  -- Los lavadores que atienden este carro. NULL o vacío = llegada sin asignar,
  -- que sigue siendo válida: a veces se recibe el carro y se decide después.
  p_assignees         uuid[] default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company     uuid;
  v_existing    public.work_orders;
  v_order       public.work_orders;
  v_customer    uuid := p_customer_id;
  v_vehicle     uuid;
  v_plate       text;
  v_item        record;
  v_price       bigint;
  v_fleet       uuid;
  v_asignados   uuid[];
  v_profile     uuid;
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

  -- Lavadores: se validan ANTES de crear nada. Se aceptan solo empleados
  -- activos de ESTA empresa que puedan lavar; un id de otra empresa o de
  -- alguien dado de baja no puede colarse en la orden ni, más tarde, cobrar
  -- comisión por ella. Los duplicados se colapsan.
  if p_assignees is not null then
    select coalesce(array_agg(distinct p.id), '{}'::uuid[])
      into v_asignados
      from public.profiles p
     where p.id = any(p_assignees)
       and p.company_id = v_company
       and p.is_active
       and p.role in ('operario', 'supervisor');

    if array_length(v_asignados, 1) is distinct from array_length(
         (select array_agg(distinct x) from unnest(p_assignees) as x), 1) then
      raise exception 'Alguno de los lavadores no existe, no está activo o no es de esta empresa'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Flotilla del vehículo, si la tiene. Manda su tarifa y queda sellada en la
  -- orden para poder facturar el periodo completo más tarde.
  v_fleet := app.fleet_for_plate(v_company, v_plate);

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
    status, priority, notes, fleet_id, created_by
  ) values (
    v_company, p_branch_id, p_client_request_id, v_customer,
    coalesce(nullif(trim(p_customer_name), ''), 'Cliente General'), p_customer_phone,
    v_vehicle, v_plate, trim(coalesce(p_vehicle_make,'') || ' ' || coalesce(p_vehicle_model,'')),
    p_vehicle_category, coalesce(p_vehicle_color,''),
    -- Con lavador ya elegido la orden nace 'asignada': el tablero la muestra
    -- lista para empezar en vez de pidiendo una decisión que ya se tomó.
    (case when coalesce(array_length(v_asignados, 1), 0) > 0
          then 'asignada' else 'pendiente' end)::app.order_status,
    p_priority, p_notes, v_fleet, auth.uid()
  )
  returning * into v_order;

  if coalesce(array_length(v_asignados, 1), 0) > 0 then
    foreach v_profile in array v_asignados loop
      insert into public.work_order_assignees (work_order_id, profile_id, company_id)
      values (v_order.id, v_profile, v_company)
      on conflict do nothing;
    end loop;
  end if;

  -- Líneas con el precio del servidor: tarifa de contrato si la hay.
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

    v_price := app.resolve_item_price('service', v_item.service_id, null, p_vehicle_category, v_fleet);

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

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, p_branch_id, 'NUEVA_LLEGADA_ORDEN', 'WorkOrder', v_order.id::text,
          'Orden ' || v_order.order_number || ' · ' || v_plate || ' · ' || v_order.customer_name,
          jsonb_build_object('lavadores', coalesce(array_length(v_asignados, 1), 0)));

  return v_order;
end;
$$;

comment on function public.create_work_order is
  'Registra la llegada: cliente, vehículo, líneas con precio del servidor y, si '
  'se indican, los lavadores asignados (la orden nace entonces como asignada).';

grant execute on function public.create_work_order to authenticated;
