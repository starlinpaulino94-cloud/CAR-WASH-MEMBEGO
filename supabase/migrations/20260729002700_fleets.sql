-- =============================================================================
-- 0029 · Flotillas y contratos corporativos
-- =============================================================================
-- Una empresa que trae quince camionetas no es quince clientes sueltos. Hoy el
-- sistema la trata así: cada llegada cobra tarifa de mostrador, cada servicio
-- se factura por separado y no hay forma de decir «esto lo paga la empresa a
-- fin de mes». El resultado es que los car wash pierden las cuentas grandes,
-- que son justo las que llenan las bahías los días flojos.
--
-- Este módulo añade:
--
--   · fleets: la cuenta corporativa. Agrupa vehículos y apunta al cliente que
--     paga — el mismo que lleva el cupo de crédito de la 0028.
--   · vehicles.fleet_id: a qué flotilla pertenece cada vehículo.
--   · fleet_rates: la tarifa NEGOCIADA. Precio por servicio, opcionalmente por
--     categoría de vehículo. Gana al catálogo cuando el vehículo es de flota.
--   · Órdenes y facturas resuelven el precio con la tarifa de contrato, sin que
--     la recepción tenga que acordarse de aplicar un descuento a mano.
--   · invoice_fleet_period: UNA factura por todo lo del periodo, a crédito, que
--     abre una sola cuenta por cobrar. Es lo que pide un cliente corporativo.
--   · fleet_statement: el estado de cuenta que se le manda.
--
-- El precio sigue poniéndolo el servidor. Lo único que cambia es de qué tabla
-- lo saca: si el vehículo es de flota y hay tarifa pactada, manda el contrato.
-- =============================================================================

-- ---------------------------------------------------------------- Flotillas
create table public.fleets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- Quién paga. Es un cliente normal: hereda cupo, plazo y mora de la 0028.
  customer_id   uuid not null,
  name          text not null check (length(trim(name)) > 0),
  code          text,                       -- referencia interna del car wash
  contact_name  text,
  contact_phone text,
  contact_email text,
  -- Un corporativo suele exigir su nº de orden de compra en la factura.
  po_reference  text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id),
  constraint fleets_customer_same_company
    foreign key (customer_id, company_id) references public.customers(id, company_id) on delete restrict
);

create index fleets_company_idx on public.fleets (company_id) where is_active;
create index fleets_customer_idx on public.fleets (customer_id);

create trigger fleets_touch before update on public.fleets
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------- Vehículos de la flotilla
alter table public.vehicles
  add column fleet_id uuid,
  add constraint vehicles_fleet_same_company
    foreign key (fleet_id, company_id) references public.fleets(id, company_id)
    -- `set null (columna)` desde PostgreSQL 15: sin acotarlo, borrar una
    -- flotilla intentaría anular también company_id, que es NOT NULL.
    on delete set null (fleet_id);

create index vehicles_fleet_idx on public.vehicles (fleet_id) where fleet_id is not null;

-- ------------------------------------------------------- Tarifas de contrato
-- vehicle_category NULL = tarifa única para todo el parque. Una fila con
-- categoría concreta gana sobre la genérica, igual que en las recetas (0021).
create table public.fleet_rates (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  fleet_id         uuid not null,
  service_id       uuid not null references public.services(id) on delete cascade,
  vehicle_category app.vehicle_category,
  price_cents      bigint not null check (price_cents >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fleet_rates_fleet_same_company
    foreign key (fleet_id, company_id) references public.fleets(id, company_id) on delete cascade
);

-- Una sola tarifa por servicio y categoría. Dos índices porque NULL no compara
-- igual en un UNIQUE ordinario: sin el parcial, se podrían meter dos genéricas.
create unique index fleet_rates_specific_unique
  on public.fleet_rates (fleet_id, service_id, vehicle_category)
  where vehicle_category is not null;
create unique index fleet_rates_generic_unique
  on public.fleet_rates (fleet_id, service_id)
  where vehicle_category is null;

create index fleet_rates_fleet_idx on public.fleet_rates (fleet_id);

create trigger fleet_rates_touch before update on public.fleet_rates
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------ La orden recuerda su flota
-- Se sella al crear la orden. Si mañana el vehículo sale de la flotilla, las
-- órdenes de ayer siguen perteneciendo a quien las encargó.
alter table public.work_orders
  add column fleet_id uuid,
  add column consolidated_invoice_id uuid,
  add constraint work_orders_fleet_same_company
    foreign key (fleet_id, company_id) references public.fleets(id, company_id)
    on delete set null (fleet_id),
  add constraint work_orders_consolidated_same_company
    foreign key (consolidated_invoice_id, company_id) references public.invoices(id, company_id)
    on delete set null (consolidated_invoice_id);

-- El índice que necesita la facturación consolidada: lo pendiente de una flota.
create index work_orders_fleet_pending_idx
  on public.work_orders (company_id, fleet_id, delivered_at)
  where fleet_id is not null and consolidated_invoice_id is null;

-- ----------------------------------------------------------------- RLS
alter table public.fleets      enable row level security;
alter table public.fleets      force  row level security;
alter table public.fleet_rates enable row level security;
alter table public.fleet_rates force  row level security;

create policy fleets_select on public.fleets
  for select to authenticated using (app.belongs_to_tenant(company_id));
create policy fleet_rates_select on public.fleet_rates
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.fleets, public.fleet_rates to authenticated;

-- La escritura pasa por RPC: una tarifa de contrato es dinero, no un dato de
-- contacto, y quien la fija tiene que ser el mismo que autoriza el crédito.

-- =============================================================================
-- app.fleet_for_plate · a qué flotilla pertenece una placa
-- =============================================================================
-- Se resuelve por el VEHÍCULO, no por quien paga: una camioneta de la flota
-- lleva tarifa de contrato aunque ese día la pague el conductor de su bolsillo.
create or replace function app.fleet_for_plate(p_company uuid, p_plate text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.fleet_id
  from public.vehicles v
  join public.fleets f on f.id = v.fleet_id and f.is_active
  where v.company_id = p_company
    and v.plate = upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

comment on function app.fleet_for_plate is
  'Flotilla activa de una placa, con la misma normalización que usan órdenes y vehículos.';

-- =============================================================================
-- app.resolve_item_price · ahora conoce las tarifas de contrato
-- =============================================================================
-- Mismo contrato que antes con cuatro argumentos: el quinto trae valor por
-- defecto, así que ninguna llamada existente cambia de significado. La versión
-- de cuatro se retira: `create or replace` con un parámetro nuevo no sustituye,
-- SOBRECARGA, y las llamadas de cuatro argumentos quedarían ambiguas.
drop function if exists app.resolve_item_price(
  app.item_type, uuid, uuid, app.vehicle_category);

create or replace function app.resolve_item_price(
  p_item_type        app.item_type,
  p_service_id       uuid,
  p_product_id       uuid,
  p_vehicle_category app.vehicle_category,
  p_fleet_id         uuid default null
)
returns bigint
language plpgsql
stable
as $$
declare
  v_price bigint;
begin
  if p_item_type = 'product' then
    select price_cents into v_price from public.products where id = p_product_id;
    if v_price is null then
      raise exception 'Producto % inexistente o sin precio', p_product_id
        using errcode = 'foreign_key_violation';
    end if;
    return v_price;
  end if;

  -- Tarifa pactada. La fila con categoría concreta gana sobre la genérica.
  if p_fleet_id is not null then
    select price_cents into v_price
    from public.fleet_rates
    where fleet_id = p_fleet_id
      and service_id = p_service_id
      and (vehicle_category = p_vehicle_category or vehicle_category is null)
    order by vehicle_category nulls last
    limit 1;

    if v_price is not null then
      return v_price;
    end if;
  end if;

  -- Sin contrato para ese servicio, manda el catálogo.
  select price_cents into v_price
  from public.service_prices
  where service_id = p_service_id and vehicle_category = p_vehicle_category;

  if v_price is null then
    raise exception
      'El servicio % no tiene precio definido para la categoría %',
      p_service_id, p_vehicle_category
      using errcode = 'foreign_key_violation';
  end if;
  return v_price;
end;
$$;

comment on function app.resolve_item_price(
  app.item_type, uuid, uuid, app.vehicle_category, uuid) is
  'Precio del servidor. Para servicios: tarifa de flotilla si la hay (específica antes que genérica), '
  'si no el catálogo por categoría. El precio que envía el cliente se ignora siempre.';

-- =============================================================================
-- Administración de flotillas
-- =============================================================================
create or replace function public.upsert_fleet(
  p_customer_id   uuid,
  p_name          text,
  p_fleet_id      uuid default null,
  p_code          text default null,
  p_contact_name  text default null,
  p_contact_phone text default null,
  p_contact_email text default null,
  p_po_reference  text default null,
  p_notes         text default null,
  p_is_active     boolean default true
)
returns public.fleets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_fleet   public.fleets;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite administrar flotillas.' using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'La flotilla necesita un nombre.' using errcode = 'check_violation';
  end if;

  perform 1 from public.customers where id = p_customer_id and company_id = v_company;
  if not found then
    raise exception 'Cliente de facturación inexistente o fuera de su alcance.'
      using errcode = 'no_data_found';
  end if;

  if p_fleet_id is null then
    insert into public.fleets (
      company_id, customer_id, name, code, contact_name, contact_phone,
      contact_email, po_reference, notes, is_active
    ) values (
      v_company, p_customer_id, trim(p_name), p_code, p_contact_name, p_contact_phone,
      p_contact_email, p_po_reference, p_notes, coalesce(p_is_active, true)
    )
    returning * into v_fleet;
  else
    update public.fleets
       set customer_id   = p_customer_id,
           name          = trim(p_name),
           code          = p_code,
           contact_name  = p_contact_name,
           contact_phone = p_contact_phone,
           contact_email = p_contact_email,
           po_reference  = p_po_reference,
           notes         = p_notes,
           is_active     = coalesce(p_is_active, true)
     where id = p_fleet_id and company_id = v_company
    returning * into v_fleet;

    if v_fleet.id is null then
      raise exception 'Flotilla inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.audit_logs (company_id, action, entity, entity_id, details)
  values (v_company, case when p_fleet_id is null then 'CREAR_FLOTILLA' else 'EDITAR_FLOTILLA' end,
          'fleet', v_fleet.id::text, v_fleet.name);

  return v_fleet;
end;
$$;

grant execute on function public.upsert_fleet(uuid, text, uuid, text, text, text, text, text, text, boolean)
  to authenticated;

-- ------------------------------------------------- Alta y baja de vehículos
create or replace function public.assign_vehicle_to_fleet(
  p_vehicle_id uuid,
  p_fleet_id   uuid          -- NULL = sacar el vehículo de su flotilla
)
returns public.vehicles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_vehicle public.vehicles;
  v_name    text;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite mover vehículos de flotilla.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_fleet_id is not null then
    select name into v_name from public.fleets
    where id = p_fleet_id and company_id = v_company;
    if v_name is null then
      raise exception 'Flotilla inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;
  end if;

  update public.vehicles set fleet_id = p_fleet_id
   where id = p_vehicle_id and company_id = v_company
  returning * into v_vehicle;

  if v_vehicle.id is null then
    raise exception 'Vehículo inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_logs (company_id, action, entity, entity_id, details)
  values (v_company, 'ASIGNAR_VEHICULO_FLOTILLA', 'vehicle', v_vehicle.id::text,
          v_vehicle.plate || coalesce(' → ' || v_name, ' → sin flotilla'));

  return v_vehicle;
end;
$$;

grant execute on function public.assign_vehicle_to_fleet(uuid, uuid) to authenticated;

-- ------------------------------------------------------ Tarifas negociadas
create or replace function public.set_fleet_rate(
  p_fleet_id         uuid,
  p_service_id       uuid,
  p_price_cents      bigint,
  p_vehicle_category app.vehicle_category default null
)
returns public.fleet_rates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_rate    public.fleet_rates;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite pactar tarifas de flotilla.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_price_cents, -1) < 0 then
    raise exception 'La tarifa no puede ser negativa.' using errcode = 'check_violation';
  end if;

  perform 1 from public.fleets where id = p_fleet_id and company_id = v_company;
  if not found then
    raise exception 'Flotilla inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  perform 1 from public.services where id = p_service_id and company_id = v_company;
  if not found then
    raise exception 'Servicio inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- Los índices únicos son parciales, así que el upsert se hace a mano: ON
  -- CONFLICT no puede apuntar a un índice con WHERE sin repetir el predicado.
  update public.fleet_rates
     set price_cents = p_price_cents
   where fleet_id = p_fleet_id and service_id = p_service_id
     and vehicle_category is not distinct from p_vehicle_category
  returning * into v_rate;

  if v_rate.id is null then
    insert into public.fleet_rates (company_id, fleet_id, service_id, vehicle_category, price_cents)
    values (v_company, p_fleet_id, p_service_id, p_vehicle_category, p_price_cents)
    returning * into v_rate;
  end if;

  insert into public.audit_logs (company_id, action, entity, entity_id, details)
  values (v_company, 'TARIFA_FLOTILLA', 'fleet', p_fleet_id::text,
          format('servicio %s · %s · %s centavos', p_service_id,
                 coalesce(p_vehicle_category::text, 'todas las categorías'), p_price_cents));

  return v_rate;
end;
$$;

grant execute on function public.set_fleet_rate(uuid, uuid, bigint, app.vehicle_category)
  to authenticated;

create or replace function public.delete_fleet_rate(p_rate_id uuid)
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
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite pactar tarifas de flotilla.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.fleet_rates where id = p_rate_id and company_id = v_company;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Tarifa inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
end;
$$;

grant execute on function public.delete_fleet_rate(uuid) to authenticated;

-- =============================================================================
-- public.create_work_order · sella la flotilla y cobra la tarifa pactada
-- =============================================================================
-- Idéntica a la de 0010 salvo dos cosas: resuelve la flotilla por la placa y
-- se la pasa al precio. La recepción no tiene que acordarse de nada.
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
  v_fleet    uuid;
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
    'pendiente', p_priority, p_notes, v_fleet, auth.uid()
  )
  returning * into v_order;

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

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'NUEVA_LLEGADA_ORDEN', 'WorkOrder', v_order.id::text,
          'Orden ' || v_order.order_number || ' · ' || v_plate || ' · ' || v_order.customer_name);

  return v_order;
end;
$$;

grant execute on function public.create_work_order to authenticated;

-- =============================================================================
-- public.create_invoice · el mostrador también cobra la tarifa pactada
-- =============================================================================
-- Único cambio respecto de 0028: resuelve la flotilla por la placa y se la
-- pasa al precio, para que facturar en caja a un vehículo de flota dé el mismo
-- importe que la orden. Sin esto, la factura no cuadraría con su propia orden.
create or replace function public.create_invoice(
  p_branch_id         uuid,
  p_client_request_id text,
  p_items             jsonb,
  p_payments          jsonb,
  p_vehicle_category  app.vehicle_category default 'sedan',
  p_work_order_id     uuid    default null,
  p_customer_id       uuid    default null,
  p_customer_name     text    default 'Consumidor Final',
  p_customer_tax_id   text    default null,
  p_vehicle_plate     text    default null,
  p_ncf_type          app.ncf_type default null,
  p_cash_session_id   uuid    default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company      uuid;
  v_existing     public.invoices;
  v_invoice      public.invoices;
  v_item         record;
  v_payment      record;
  v_price        bigint;
  v_subtotal     bigint := 0;
  v_discount     bigint := 0;
  v_membego      bigint := 0;
  v_taxable      bigint;
  v_rate_bps     integer;
  v_tax          bigint;
  v_total        bigint;
  v_paid         bigint := 0;
  v_cash_paid    bigint := 0;
  v_credit_paid  bigint := 0;
  v_methods      integer := 0;
  v_change       bigint;
  v_ncf          text := null;
  v_session      public.cash_sessions;
  v_credit       record;
  v_receivable   public.receivables;
  v_pay_status   app.payment_status;
  v_pay_method   app.payment_method;
  v_fleet        uuid;
  v_rows         integer;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia (p_client_request_id)'
      using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------- Idempotencia
  -- Un segundo clic sobre "Cobrar" devuelve la MISMA factura en lugar de emitir
  -- otra, duplicar el descuento de stock y volver a sumar el ingreso a la caja.
  select * into v_existing
  from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;

  if v_existing.id is not null then
    return v_existing;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura no tiene líneas' using errcode = 'invalid_parameter_value';
  end if;

  -- Tarifa de contrato: se resuelve por la placa, igual que en la orden.
  v_fleet := app.fleet_for_plate(v_company, p_vehicle_plate);

  -- ------------------------------------------------------------- Totales
  -- Calculados en el servidor a partir del catálogo. Lo que envía el cliente
  -- sobre precios se ignora deliberadamente.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      item_type          app.item_type,
      service_id         uuid,
      product_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida en la línea "%"', v_item.name
        using errcode = 'invalid_parameter_value';
    end if;

    v_price := app.resolve_item_price(
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category, v_fleet
    );

    if coalesce(v_item.is_membego_covered, false) then
      v_membego := v_membego + v_price * v_item.quantity;
    else
      v_discount := v_discount + coalesce(v_item.discount_cents, 0);
    end if;
    v_subtotal := v_subtotal + v_price * v_item.quantity;
  end loop;

  select tax_rate_bps into v_rate_bps from public.companies where id = v_company;

  -- MISMA fórmula que app.recalc_work_order_totals(). En la aplicación auditada
  -- había tres versiones divergentes y la factura de una orden con beneficio
  -- Membego calculaba un ITBIS distinto al de la propia orden.
  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  v_tax     := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;
  v_total   := v_taxable + v_tax;

  -- ------------------------------------------------------------- Pagos
  for v_payment in
    select * from jsonb_to_recordset(p_payments) as x(
      method       app.payment_method,
      amount_cents bigint,
      reference    text
    )
  loop
    if coalesce(v_payment.amount_cents, 0) <= 0 then
      raise exception 'Importe de pago inválido' using errcode = 'invalid_parameter_value';
    end if;
    v_paid := v_paid + v_payment.amount_cents;
    if v_payment.method = 'efectivo' then
      v_cash_paid := v_cash_paid + v_payment.amount_cents;
    elsif v_payment.method = 'credito' then
      v_credit_paid := v_credit_paid + v_payment.amount_cents;
    end if;
  end loop;

  select count(distinct method) into v_methods
  from jsonb_to_recordset(p_payments) as x(method app.payment_method);

  if v_paid < v_total then
    raise exception 'Pago insuficiente: recibido % de un total de %', v_paid, v_total
      using errcode = 'invalid_parameter_value';
  end if;

  -- El cambio se calcula UNA vez sobre el total, no una vez por pago. El código
  -- auditado hacía `cashAdd += p.amount - changeAmount` dentro de un bucle, de
  -- modo que con dos pagos en efectivo restaba el cambio dos veces.
  v_change := v_paid - v_total;

  if v_change > 0 and v_cash_paid < v_change then
    raise exception 'Solo puede devolverse cambio sobre pagos en efectivo'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------- Crédito
  -- Fiar no es cobrar. Antes de emitir se comprueba a quién se le fía, si tiene
  -- autorización, si está al día y si le queda cupo.
  if v_credit_paid > 0 then
    if v_change > 0 then
      raise exception 'Una venta a crédito no genera cambio: cobre el importe exacto.'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_customer_id is null then
      raise exception 'No se fía a consumidor final: seleccione el cliente.'
        using errcode = 'invalid_parameter_value';
    end if;

    -- Bloquea la fila del cliente: dos cajas fiando a la vez no pueden
    -- saltarse el cupo leyendo ambas el mismo saldo antiguo.
    perform 1 from public.customers
    where id = p_customer_id and company_id = v_company for update;
    if not found then
      raise exception 'Cliente inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;

    select * into v_credit from app.credit_snapshot(p_customer_id);

    if not v_credit.credit_enabled then
      raise exception 'El cliente no tiene crédito autorizado.' using errcode = 'insufficient_privilege';
    end if;
    if v_credit.overdue_cents > 0 then
      raise exception
        'El cliente tiene % centavos vencidos desde el %. Cobre antes de volver a fiar.',
        v_credit.overdue_cents, v_credit.oldest_due using errcode = 'check_violation';
    end if;
    if v_credit_paid > v_credit.available_cents then
      raise exception 'Cupo insuficiente: disponible % de un cupo de %.',
        v_credit.available_cents, v_credit.limit_cents using errcode = 'check_violation';
    end if;
  end if;

  -- --------------------------------------------------------- Caja abierta
  if v_cash_paid > 0 then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and status = 'open';

    if v_session.id is null then
      raise exception 'No hay una sesión de caja abierta para registrar el efectivo'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- ---------------------------------------------------------------- NCF
  if p_ncf_type is not null then
    if p_ncf_type = 'B04' then
      raise exception 'B04 es exclusivo de notas de crédito: use annul_invoice()'
        using errcode = 'invalid_parameter_value';
    end if;
    v_ncf := app.allocate_ncf(v_company, p_ncf_type);
  end if;

  -- ------------------------------------------------------------- Escritura
  insert into public.invoices (
    company_id, branch_id, client_request_id, ncf, ncf_type,
    work_order_id, customer_id, customer_name, customer_tax_id, vehicle_plate,
    subtotal_cents, discount_cents, tax_cents, total_cents, change_cents,
    cash_session_id, cashier_id
  ) values (
    v_company, p_branch_id, p_client_request_id, v_ncf, p_ncf_type,
    p_work_order_id, p_customer_id, p_customer_name, p_customer_tax_id, p_vehicle_plate,
    v_subtotal, v_discount + v_membego, v_tax, v_total, v_change,
    p_cash_session_id, auth.uid()
  )
  returning * into v_invoice;

  -- Líneas, de nuevo con el precio del servidor.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      item_type          app.item_type,
      service_id         uuid,
      product_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    v_price := app.resolve_item_price(
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category, v_fleet
    );

    insert into public.invoice_items (
      invoice_id, item_type, service_id, product_id, name,
      quantity, unit_price_cents, discount_cents, is_membego_covered
    ) values (
      v_invoice.id, v_item.item_type, v_item.service_id, v_item.product_id, v_item.name,
      v_item.quantity, v_price,
      case when coalesce(v_item.is_membego_covered,false) then 0 else coalesce(v_item.discount_cents,0) end,
      coalesce(v_item.is_membego_covered, false)
    );

    -- Inventario. El contexto clasifica el movimiento que registra el trigger
    -- de products (0019): sin él, el trigger rechaza el cambio de existencia.
    if v_item.item_type = 'product' then
      perform set_config('app.inventory_ctx', jsonb_build_object(
        'kind', 'venta', 'invoice_id', v_invoice.id, 'branch_id', v_invoice.branch_id
      )::text, true);
      update public.products
         set stock = stock - v_item.quantity
       where id = v_item.product_id and company_id = v_company;
    end if;
  end loop;

  -- ------------------------------------------------------- Movimientos de caja
  if p_cash_session_id is not null then
    for v_payment in
      select * from jsonb_to_recordset(p_payments) as x(
        method app.payment_method, amount_cents bigint, reference text
      )
    loop
      -- Lo fiado NO entra a la caja: no ha entrado dinero. Antes se registraba
      -- como ingreso y el arqueo cuadraba contra un cobro que no existía.
      continue when v_payment.method = 'credito';

      insert into public.cash_movements (
        company_id, cash_session_id, type, method, amount_cents, reason, invoice_id, created_by
      ) values (
        v_company, p_cash_session_id, 'inflow', v_payment.method,
        -- Solo del efectivo se descuenta el cambio entregado, y una sola vez.
        case when v_payment.method = 'efectivo'
             then v_payment.amount_cents - v_change
             else v_payment.amount_cents end,
        'Factura ' || v_invoice.invoice_number
          || case when v_payment.reference is not null then ' · ref ' || v_payment.reference else '' end,
        v_invoice.id, auth.uid()
      );
    end loop;
  end if;

  -- ------------------------------------------------- Cuenta por cobrar
  if v_credit_paid > 0 then
    v_receivable := app.open_receivable(v_invoice, v_credit_paid, p_customer_id);
  end if;

  -- --------------------------------------------------------- Orden de trabajo
  if p_work_order_id is not null then
    -- El estado dice lo que de verdad se cobró: sin crédito queda pagada;
    -- fiada entera queda pendiente; mixta, parcial.
    v_pay_status := case
      when v_credit_paid = 0        then 'pagado'
      when v_credit_paid >= v_total then 'pendiente'
      else 'parcial'
    end;
    v_pay_method := case
      when v_methods > 1 then 'mixto'::app.payment_method
      else (p_payments -> 0 ->> 'method')::app.payment_method
    end;

    update public.work_orders
       set payment_status = v_pay_status,
           payment_method = v_pay_method
     where id = p_work_order_id and company_id = v_company;

    get diagnostics v_rows = row_count;
    -- RLS filtra en silencio: sin esta comprobación, una orden no autorizada
    -- quedaría sin marcar y nadie se enteraría.
    if v_rows = 0 then
      raise exception 'No se pudo marcar como pagada la orden %', p_work_order_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, p_branch_id, 'EMITIR_FACTURA', 'Invoice', v_invoice.id::text,
    'Factura ' || v_invoice.invoice_number || ' por ' || v_total || ' centavos'
      || coalesce(' · NCF ' || v_ncf, ' · sin NCF')
      || case when v_credit_paid > 0 then ' · a crédito ' || v_credit_paid else '' end,
    jsonb_build_object('total_cents', v_total, 'ncf', v_ncf,
                       'idempotency', p_client_request_id,
                       'credit_cents', v_credit_paid,
                       'receivable_id', v_receivable.id,
                       'fleet_id', v_fleet)
  );

  return v_invoice;
end;
$$;

grant execute on function public.create_invoice to authenticated;

comment on function public.create_invoice is
  'Emisión atómica: factura, líneas, caja, inventario, crédito, orden y auditoría en una transacción. '
  'Idempotente por client_request_id. Tarifa de flotilla si la placa es de flota; lo fiado abre cuenta '
  'por cobrar y no entra a caja.';

-- =============================================================================
-- public.invoice_fleet_period · una factura por todo el periodo
-- =============================================================================
-- Lo que pide un cliente corporativo: no quince comprobantes sueltos, sino uno
-- con el detalle por vehículo. Se factura SIEMPRE a crédito —para eso existe la
-- cuenta— y con los importes YA CONGELADOS de cada orden: si la tarifa cambió a
-- mitad de mes, se cobra lo que se prometió cuando se prestó el servicio, no lo
-- que diga el contrato hoy.
create or replace function public.invoice_fleet_period(
  p_fleet_id          uuid,
  p_from              date,
  p_to                date,
  p_client_request_id text,
  p_ncf_type          app.ncf_type default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company    uuid := app.current_company_id();
  v_fleet      public.fleets;
  v_existing   public.invoices;
  v_invoice    public.invoices;
  v_customer   public.customers;
  v_credit     record;
  v_order      record;
  v_branch     uuid;
  v_subtotal   bigint := 0;
  v_discount   bigint := 0;
  v_tax        bigint := 0;
  v_total      bigint := 0;
  v_count      integer := 0;
  v_ids        uuid[];
  v_ncf        text := null;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite facturar flotillas.' using errcode = 'insufficient_privilege';
  end if;
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  -- Idempotencia: un segundo clic devuelve la factura ya emitida, no una nueva.
  select * into v_existing from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  -- Sin FOR UPDATE sobre fleets: la tabla solo tiene política de lectura, y
  -- bajo RLS un SELECT ... FOR UPDATE exige además política de UPDATE, así que
  -- devolvería cero filas. Lo que hay que serializar es el cupo, y eso se
  -- consigue bloqueando al cliente que paga, igual que hace create_invoice.
  select * into v_fleet from public.fleets
  where id = p_fleet_id and company_id = v_company;
  if v_fleet.id is null then
    raise exception 'Flotilla inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  select * into v_customer from public.customers
  where id = v_fleet.customer_id and company_id = v_company
  for update;

  -- Se factura a crédito, así que el cliente que paga tiene que tenerlo.
  select * into v_credit from app.credit_snapshot(v_fleet.customer_id);
  if not v_credit.credit_enabled then
    raise exception
      'El cliente de facturación de % no tiene crédito autorizado. Autorícelo antes de consolidar.',
      v_fleet.name using errcode = 'insufficient_privilege';
  end if;

  -- Órdenes entregadas del periodo que nadie ha cobrado todavía: ni por caja
  -- (una factura propia vigente) ni en una consolidada anterior. Se guardan los
  -- identificadores en un arreglo en vez de una tabla temporal: una tabla
  -- temporal rompería si se consolidan dos flotillas en la misma transacción.
  select array_agg(o.id),
         count(*),
         coalesce(sum(o.subtotal_cents), 0),
         coalesce(sum(o.discount_cents + o.membego_benefit_cents), 0),
         coalesce(sum(o.tax_cents), 0),
         coalesce(sum(o.total_cents), 0),
         -- La factura vive en una sucursal: se toma la de la primera orden del
         -- periodo. (No hay min(uuid), y tampoco tendría sentido.)
         (array_agg(o.branch_id order by o.delivered_at))[1]
    into v_ids, v_count, v_subtotal, v_discount, v_tax, v_total, v_branch
  from public.work_orders o
  where o.company_id = v_company
    and o.fleet_id = p_fleet_id
    and o.status = 'entregado'
    and o.delivered_at >= p_from
    and o.delivered_at < p_to + 1
    and o.consolidated_invoice_id is null
    and not exists (
      select 1 from public.invoices i
      where i.work_order_id = o.id and not i.is_annulled
    );

  if v_count = 0 then
    raise exception 'No hay órdenes entregadas y sin cobrar de % entre el % y el %.',
      v_fleet.name, p_from, p_to using errcode = 'no_data_found';
  end if;

  if v_total > v_credit.available_cents then
    raise exception
      'La consolidación (%) supera el cupo disponible de % centavos. Cobre o amplíe el cupo.',
      v_total, v_credit.available_cents using errcode = 'check_violation';
  end if;

  if p_ncf_type is not null then
    if p_ncf_type = 'B04' then
      raise exception 'B04 es exclusivo de notas de crédito' using errcode = 'invalid_parameter_value';
    end if;
    v_ncf := app.allocate_ncf(v_company, p_ncf_type);
  end if;

  insert into public.invoices (
    company_id, branch_id, client_request_id, ncf, ncf_type,
    customer_id, customer_name, customer_tax_id, vehicle_plate,
    subtotal_cents, discount_cents, tax_cents, total_cents, change_cents,
    cash_session_id, cashier_id
  ) values (
    v_company, v_branch, p_client_request_id, v_ncf, p_ncf_type,
    v_fleet.customer_id, v_customer.name, v_customer.tax_id,
    -- No hay una placa: son muchas. El detalle va en las líneas.
    null,
    v_subtotal, v_discount, v_tax, v_total, 0,
    null, auth.uid()
  )
  returning * into v_invoice;

  -- Una línea por línea de orden, con la placa en el nombre: el estado de
  -- cuenta corporativo se lee por vehículo, no por concepto.
  insert into public.invoice_items (
    invoice_id, item_type, service_id, product_id, name,
    quantity, unit_price_cents, discount_cents, is_membego_covered
  )
  select v_invoice.id, i.item_type, i.service_id, i.product_id,
         i.name || ' · ' || p.vehicle_plate || ' · ' || p.order_number,
         i.quantity, i.unit_price_cents, i.discount_cents, i.is_membego_covered
  from public.work_orders p
  join public.work_order_items i on i.work_order_id = p.id
  where p.id = any(v_ids);

  -- Las órdenes quedan selladas contra esta factura: no se pueden volver a
  -- consolidar ni cobrar por caja.
  update public.work_orders
     set consolidated_invoice_id = v_invoice.id,
         payment_status = 'pendiente',
         payment_method = 'credito'
   where id = any(v_ids);

  -- Una sola cuenta por cobrar por toda la consolidación.
  perform app.open_receivable(v_invoice, v_total, v_fleet.customer_id);

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, v_branch, 'FACTURAR_FLOTILLA', 'Invoice', v_invoice.id::text,
    format('%s · %s órdenes del %s al %s · %s centavos a crédito',
           v_fleet.name, v_count, p_from, p_to, v_total),
    jsonb_build_object('fleet_id', p_fleet_id, 'orders', v_count,
                       'from', p_from, 'to', p_to, 'total_cents', v_total)
  );

  return v_invoice;
end;
$$;

grant execute on function public.invoice_fleet_period(uuid, date, date, text, app.ncf_type)
  to authenticated;

comment on function public.invoice_fleet_period is
  'Factura consolidada de una flotilla: una factura a crédito por las órdenes entregadas y sin cobrar '
  'del periodo, con los importes congelados de cada orden. Idempotente por client_request_id.';

-- =============================================================================
-- public.fleet_statement · el estado de cuenta que se le manda al corporativo
-- =============================================================================
create or replace function public.fleet_statement(
  p_fleet_id uuid,
  p_from     date,
  p_to       date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_fleet   public.fleets;
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar estados de cuenta.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  select * into v_fleet from public.fleets
  where id = p_fleet_id and company_id = v_company;
  if v_fleet.id is null then
    raise exception 'Flotilla inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  with ordenes as (
    select o.id, o.order_number, o.vehicle_plate, o.delivered_at,
           o.total_cents, o.consolidated_invoice_id,
           exists (select 1 from public.invoices i
                    where i.work_order_id = o.id and not i.is_annulled) as facturada_suelta
    from public.work_orders o
    where o.company_id = v_company
      and o.fleet_id = p_fleet_id
      and o.status = 'entregado'
      and o.delivered_at >= p_from
      and o.delivered_at < p_to + 1
  )
  select jsonb_build_object(
    'fleet', jsonb_build_object('id', v_fleet.id, 'name', v_fleet.name,
                                'code', v_fleet.code, 'po_reference', v_fleet.po_reference),
    'from', p_from, 'to', p_to,
    'totals', jsonb_build_object(
      'services',        count(*),
      'total_cents',     coalesce(sum(total_cents), 0),
      'billed_cents',    coalesce(sum(total_cents) filter
                           (where consolidated_invoice_id is not null or facturada_suelta), 0),
      'unbilled_cents',  coalesce(sum(total_cents) filter
                           (where consolidated_invoice_id is null and not facturada_suelta), 0)
    ),
    'by_vehicle', coalesce((
      select jsonb_agg(x order by x ->> 'plate')
      from (
        select jsonb_build_object(
          'plate',       vehicle_plate,
          'services',    count(*),
          'total_cents', sum(total_cents)
        ) as x
        from ordenes group by vehicle_plate
      ) g
    ), '[]'::jsonb),
    -- Lo que la flotilla debe HOY, venga de donde venga: es el número por el
    -- que llama el dueño.
    'balance_cents', coalesce((
      select sum(r.total_cents - r.paid_cents)
      from public.receivables r
      where r.company_id = v_company
        and r.customer_id = v_fleet.customer_id
        and r.status = 'pendiente'
    ), 0)
  ) into v_result
  from ordenes;

  return v_result;
end;
$$;

grant execute on function public.fleet_statement(uuid, date, date) to authenticated;

comment on function public.fleet_statement is
  'Estado de cuenta de una flotilla: consumo por vehículo del periodo, lo facturado, lo pendiente '
  'de consolidar y el saldo por cobrar del cliente que paga.';

comment on table public.fleets is
  'Cuenta corporativa: agrupa vehículos y apunta al cliente que paga (el del cupo de crédito).';
comment on table public.fleet_rates is
  'Tarifa negociada por servicio. vehicle_category NULL = todo el parque; la específica gana.';
