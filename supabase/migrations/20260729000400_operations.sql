-- =============================================================================
-- 0004 · Órdenes de trabajo
-- =============================================================================
-- Resuelve los riesgos I1/I2 (colisión de números de orden e identificadores)
-- e I12 (fórmula de impuestos divergente) de la auditoría.
-- =============================================================================

-- -------------------------------------------------- Numeración de documentos

-- Contador transaccional y correlativo. Sustituye a
-- `Math.floor(1000 + Math.random() * 9000)`, que sobre 9.000 valores posibles
-- tenía un 50% de probabilidad de colisión a las ~112 órdenes: un día y medio.
create table public.document_counters (
  company_id uuid   not null references public.companies(id) on delete cascade,
  scope      text   not null,
  period     text   not null default 'ALL',
  next_value bigint not null default 1 check (next_value > 0),
  primary key (company_id, scope, period)
);

create or replace function app.next_document_number(
  p_company uuid,
  p_scope   text,
  p_period  text default 'ALL'
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value bigint;
begin
  insert into public.document_counters (company_id, scope, period)
  values (p_company, p_scope, p_period)
  on conflict (company_id, scope, period) do nothing;

  -- El UPDATE toma un bloqueo de fila: dos cajeros simultáneos se serializan
  -- y ninguno puede obtener el mismo número.
  update public.document_counters
     set next_value = next_value + 1
   where company_id = p_company and scope = p_scope and period = p_period
  returning next_value - 1 into v_value;

  if v_value is null then
    raise exception 'No se pudo asignar número de documento (%/%/%)', p_company, p_scope, p_period;
  end if;
  return v_value;
end;
$$;

comment on function app.next_document_number is
  'Asigna números correlativos y sin huecos. Serializa por bloqueo de fila.';

-- ---------------------------------------------------------------- Órdenes

create table public.work_orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  branch_id             uuid not null references public.branches(id) on delete restrict,
  order_number          text not null,

  customer_id           uuid references public.customers(id) on delete set null,
  customer_name         text not null,
  customer_phone        text,

  vehicle_id            uuid references public.vehicles(id) on delete set null,
  vehicle_plate         text not null,
  vehicle_make_model    text not null default '',
  vehicle_category      app.vehicle_category not null default 'sedan',
  vehicle_color         text not null default '',

  status                app.order_status  not null default 'pendiente',
  priority              text not null default 'normal'
                          check (priority in ('normal', 'alta', 'vip_membego')),
  bay_id                uuid references public.bays(id) on delete set null,

  -- Importes derivados de work_order_items por trigger. No los fija el cliente:
  -- en la aplicación auditada los calculaba el navegador con tres fórmulas
  -- distintas en tres archivos distintos.
  subtotal_cents        bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents        bigint not null default 0 check (discount_cents >= 0),
  membego_benefit_cents bigint not null default 0 check (membego_benefit_cents >= 0),
  tax_cents             bigint not null default 0 check (tax_cents >= 0),
  total_cents           bigint not null default 0 check (total_cents >= 0),

  payment_status        app.payment_status not null default 'pendiente',
  payment_method        app.payment_method,

  membego_customer_id   text,
  membego_membership_id text,
  membego_benefit_id    text,
  membego_redemption_id text,
  benefit_status        app.benefit_status,

  arrival_at            timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  delivered_at          timestamptz,
  estimated_ready_at    timestamptz,

  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (company_id, order_number)
);

create index work_orders_branch_status_idx on public.work_orders (branch_id, status);
create index work_orders_arrival_idx       on public.work_orders (company_id, arrival_at desc);
create index work_orders_customer_idx      on public.work_orders (customer_id);
create index work_orders_plate_trgm        on public.work_orders using gin (vehicle_plate gin_trgm_ops);
-- La cola activa es la consulta más caliente del sistema (Kanban y badge lateral).
create index work_orders_active_queue_idx  on public.work_orders (branch_id, status, arrival_at)
  where status not in ('entregado', 'cancelado');

create trigger work_orders_touch before update on public.work_orders
  for each row execute function app.touch_updated_at();

-- Ahora que existe work_orders, se cierra la referencia pendiente de bays.
alter table public.bays
  add constraint bays_current_work_order_fk
  foreign key (current_work_order_id) references public.work_orders(id) on delete set null;

-- ---------------------------------------------------------------- Líneas

create table public.work_order_items (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references public.work_orders(id) on delete cascade,
  item_type           app.item_type not null,
  service_id          uuid references public.services(id) on delete restrict,
  product_id          uuid references public.products(id) on delete restrict,
  name                text not null,
  quantity            integer not null default 1 check (quantity > 0),
  unit_price_cents    bigint  not null check (unit_price_cents >= 0),
  discount_cents      bigint  not null default 0 check (discount_cents >= 0),
  is_membego_covered  boolean not null default false,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),

  -- Una línea apunta al catálogo que le corresponde y solo a ese.
  constraint work_order_items_ref_matches_type check (
    (item_type = 'product' and product_id is not null and service_id is null) or
    (item_type in ('service', 'package') and product_id is null)
  ),
  -- El descuento no puede superar el importe de la línea.
  constraint work_order_items_discount_within_line
    check (discount_cents <= unit_price_cents * quantity)
);

create index work_order_items_order_idx on public.work_order_items (work_order_id);

-- ------------------------------------------------- Recálculo de totales

-- ÚNICA implementación de la fórmula fiscal en todo el sistema.
-- La auditoría encontró tres versiones distintas y divergentes: una orden con
-- beneficio Membego producía un ITBIS diferente al de su propia factura.
create or replace function app.recalc_work_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_membego  bigint;
  v_taxable  bigint;
  v_rate_bps integer;
  v_tax      bigint;
begin
  select
    coalesce(sum(unit_price_cents * quantity), 0),
    coalesce(sum(case when is_membego_covered then 0 else discount_cents end), 0),
    coalesce(sum(case when is_membego_covered then unit_price_cents * quantity else 0 end), 0)
  into v_subtotal, v_discount, v_membego
  from public.work_order_items
  where work_order_id = p_order_id;

  select c.tax_rate_bps into v_rate_bps
  from public.work_orders o
  join public.companies c on c.id = o.company_id
  where o.id = p_order_id;

  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  -- Redondeo al centavo, no al peso entero como hacía Math.round() sobre pesos.
  v_tax := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;

  update public.work_orders
     set subtotal_cents        = v_subtotal,
         discount_cents        = v_discount,
         membego_benefit_cents = v_membego,
         tax_cents             = v_tax,
         total_cents           = v_taxable + v_tax
   where id = p_order_id;
end;
$$;

create or replace function app.work_order_items_changed()
returns trigger
language plpgsql
as $$
begin
  perform app.recalc_work_order_totals(coalesce(new.work_order_id, old.work_order_id));
  return null;
end;
$$;

create trigger work_order_items_recalc
  after insert or update or delete on public.work_order_items
  for each row execute function app.work_order_items_changed();

-- ------------------------------------------------- Numeración automática

create or replace function app.assign_order_number()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'CW-' || v_year || '-' ||
      lpad(app.next_document_number(new.company_id, 'work_order', v_year)::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger work_orders_number
  before insert on public.work_orders
  for each row execute function app.assign_order_number();

-- ------------------------------------------------- Coherencia de estados

create or replace function app.work_order_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'en_proceso' and new.started_at is null then
      new.started_at := now();
    elsif new.status in ('listo', 'control_calidad') and new.finished_at is null then
      new.finished_at := now();
    elsif new.status = 'entregado' then
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  end if;
  return new;
end;
$$;

create trigger work_orders_status_timestamps
  before update of status on public.work_orders
  for each row execute function app.work_order_status_timestamps();

-- Contadores del cliente al entregar. Evita recalcular agregados sobre todo el
-- histórico en cada render, que es lo que hacía el dashboard auditado.
create or replace function app.bump_customer_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado'
     and new.customer_id is not null then
    update public.customers
       set total_visits      = total_visits + 1,
           total_spent_cents = total_spent_cents + new.total_cents,
           last_visit_at     = now()
     where id = new.customer_id;

    update public.vehicles
       set last_visit_at = now()
     where id = new.vehicle_id;
  end if;
  return new;
end;
$$;

create trigger work_orders_customer_stats
  after update of status on public.work_orders
  for each row execute function app.bump_customer_stats();
