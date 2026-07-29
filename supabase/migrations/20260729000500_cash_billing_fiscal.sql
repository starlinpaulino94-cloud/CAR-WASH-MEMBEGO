-- =============================================================================
-- 0005 · Caja, facturación y comprobantes fiscales
-- =============================================================================
-- Resuelve C6 (numeración fiscal aleatoria y sin NCF), C9 (la anulación no
-- revertía caja ni inventario) e I13 (el histórico de sesiones de caja se
-- destruía al abrir la siguiente).
-- =============================================================================

-- ---------------------------------------------------------------- Caja

create table public.cash_sessions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  branch_id             uuid not null references public.branches(id) on delete restrict,
  cashier_id            uuid not null references public.profiles(id) on delete restrict,
  opened_at             timestamptz not null default now(),
  closed_at             timestamptz,
  initial_amount_cents  bigint not null check (initial_amount_cents >= 0),

  -- Totales derivados de cash_movements por trigger.
  total_cash_sales_cents      bigint not null default 0,
  total_card_sales_cents      bigint not null default 0,
  total_transfer_sales_cents  bigint not null default 0,
  total_membego_cents         bigint not null default 0,
  total_inflows_cents         bigint not null default 0,
  total_outflows_cents        bigint not null default 0,

  -- Puede ser negativo: un descuadre real debe verse, no taparse. La aplicación
  -- auditada hacía Math.max(0, ...) al registrar gastos, lo que falseaba el
  -- arqueo en silencio.
  expected_cash_cents   bigint not null default 0,
  counted_cash_cents    bigint,
  difference_cents      bigint,

  status                app.cash_session_status not null default 'open',
  opening_notes         text,
  closing_notes         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint cash_sessions_closed_is_complete check (
    (status = 'open'   and closed_at is null and counted_cash_cents is null) or
    (status = 'closed' and closed_at is not null and counted_cash_cents is not null)
  )
);

create index cash_sessions_branch_idx on public.cash_sessions (branch_id, opened_at desc);

-- Una sola caja abierta por sucursal. El modelo auditado guardaba UNA sesión
-- global y la sobrescribía al abrir la siguiente, destruyendo el arqueo anterior
-- (documento de control primario de un negocio de efectivo).
create unique index cash_sessions_one_open_per_branch
  on public.cash_sessions (branch_id) where status = 'open';

create trigger cash_sessions_touch before update on public.cash_sessions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------- Movimientos de efectivo

-- Única fuente de verdad del flujo de caja. En el modelo auditado el tipo
-- CashMovement existía y no se instanciaba nunca, y total_inflows jamás se
-- incrementaba.
create table public.cash_movements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  cash_session_id  uuid not null references public.cash_sessions(id) on delete restrict,
  type             app.cash_movement_type not null,
  method           app.payment_method not null default 'efectivo',
  amount_cents     bigint not null check (amount_cents > 0),
  reason           text not null,
  invoice_id       uuid,   -- FK diferida hasta crear invoices
  expense_id       uuid,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index cash_movements_session_idx on public.cash_movements (cash_session_id);

-- Recalcula los totales de la sesión a partir de sus movimientos.
create or replace function app.recalc_cash_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cash_in  bigint;
  v_card     bigint;
  v_transfer bigint;
  v_membego  bigint;
  v_inflows  bigint;
  v_outflows bigint;
  v_initial  bigint;
begin
  select
    coalesce(sum(case when type='inflow'  and method='efectivo'          then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'  and method='tarjeta'           then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'  and method='transferencia'     then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'  and method='membego_beneficio' then amount_cents else 0 end), 0),
    coalesce(sum(case when type='inflow'                                 then amount_cents else 0 end), 0),
    coalesce(sum(case when type='outflow'                                then amount_cents else 0 end), 0)
  into v_cash_in, v_card, v_transfer, v_membego, v_inflows, v_outflows
  from public.cash_movements
  where cash_session_id = p_session_id;

  select initial_amount_cents into v_initial
  from public.cash_sessions where id = p_session_id;

  update public.cash_sessions
     set total_cash_sales_cents     = v_cash_in,
         total_card_sales_cents     = v_card,
         total_transfer_sales_cents = v_transfer,
         total_membego_cents        = v_membego,
         total_inflows_cents        = v_inflows,
         total_outflows_cents       = v_outflows,
         -- Solo el efectivo afecta a lo que debe haber físicamente en la gaveta.
         expected_cash_cents        = v_initial + v_cash_in
                                      - coalesce((select sum(amount_cents)
                                                    from public.cash_movements
                                                   where cash_session_id = p_session_id
                                                     and type = 'outflow'
                                                     and method = 'efectivo'), 0)
   where id = p_session_id;
end;
$$;

create or replace function app.cash_movements_changed()
returns trigger
language plpgsql
as $$
begin
  perform app.recalc_cash_session(coalesce(new.cash_session_id, old.cash_session_id));
  return null;
end;
$$;

create trigger cash_movements_recalc
  after insert or update or delete on public.cash_movements
  for each row execute function app.cash_movements_changed();

-- No se registran movimientos contra una caja ya cerrada.
create or replace function app.guard_closed_cash_session()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.cash_sessions
              where id = new.cash_session_id and status = 'closed') then
    raise exception 'La sesión de caja % está cerrada: no admite movimientos', new.cash_session_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cash_movements_guard_closed
  before insert on public.cash_movements
  for each row execute function app.guard_closed_cash_session();

-- ------------------------------------------- Secuencias fiscales (NCF/DGII)

-- Un NCF debe provenir de un rango autorizado por la DGII y consumirse de forma
-- correlativa y sin huecos (Norma 06-2018). La aplicación auditada generaba
-- `FAC-${Math.random()}` y NUNCA asignaba NCF: todo comprobante salía como
-- "Consumidor Final".
create table public.ncf_sequences (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid references public.branches(id) on delete set null,
  ncf_type          app.ncf_type not null,
  series            text not null default 'B',
  range_start       bigint not null check (range_start > 0),
  range_end         bigint not null,
  next_value        bigint not null,
  authorized_until  date   not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint ncf_sequences_range_valid check (range_end >= range_start),
  constraint ncf_sequences_next_within_range
    check (next_value >= range_start and next_value <= range_end + 1)
);

create index ncf_sequences_lookup_idx
  on public.ncf_sequences (company_id, ncf_type) where is_active;

create trigger ncf_sequences_touch before update on public.ncf_sequences
  for each row execute function app.touch_updated_at();

-- Asigna el siguiente NCF del rango vigente. Serializa por bloqueo de fila,
-- valida el agotamiento del rango y la fecha de vencimiento de la autorización.
create or replace function app.allocate_ncf(p_company uuid, p_type app.ncf_type)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq   public.ncf_sequences%rowtype;
  v_value bigint;
begin
  select * into v_seq
  from public.ncf_sequences
  where company_id = p_company
    and ncf_type   = p_type
    and is_active
    and next_value <= range_end
    and authorized_until >= current_date
  order by range_start
  limit 1
  for update;   -- serializa a los cajeros concurrentes

  if v_seq.id is null then
    raise exception
      'No hay secuencia NCF % vigente y con existencias para la empresa %. '
      'Solicite una nueva autorización a la DGII antes de facturar.',
      p_type, p_company
      using errcode = 'insufficient_resources';
  end if;

  v_value := v_seq.next_value;

  update public.ncf_sequences
     set next_value = next_value + 1
   where id = v_seq.id;

  -- Formato DGII: letra de serie + tipo (2 dígitos) + secuencia de 8 dígitos.
  return v_seq.series
       || substring(p_type::text from 2)
       || lpad(v_value::text, 8, '0');
end;
$$;

comment on function app.allocate_ncf is
  'Asigna un NCF correlativo de un rango autorizado. Falla si el rango se agotó o venció.';

-- ---------------------------------------------------------------- Facturas

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete restrict,
  invoice_number    text not null,
  ncf               text,
  ncf_type          app.ncf_type,

  work_order_id     uuid references public.work_orders(id) on delete set null,
  customer_id       uuid references public.customers(id) on delete set null,
  customer_name     text not null,
  customer_tax_id   text,
  vehicle_plate     text,

  subtotal_cents    bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  tax_cents         bigint not null default 0 check (tax_cents >= 0),
  total_cents       bigint not null default 0 check (total_cents >= 0),
  change_cents      bigint not null default 0 check (change_cents >= 0),

  cash_session_id   uuid references public.cash_sessions(id) on delete set null,
  cashier_id        uuid not null references public.profiles(id) on delete restrict,

  -- La anulación deja de ser un booleano suelto: exige nota de crédito.
  is_annulled       boolean not null default false,
  annulled_reason   text,
  annulled_at       timestamptz,
  annulled_by       uuid references public.profiles(id) on delete set null,
  credit_note_id    uuid references public.invoices(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (company_id, invoice_number),
  constraint invoices_annulled_is_justified check (
    (not is_annulled) or
    (annulled_at is not null and annulled_reason is not null and length(trim(annulled_reason)) > 0)
  )
);

-- Un NCF no puede repetirse dentro de la empresa.
create unique index invoices_ncf_unique
  on public.invoices (company_id, ncf) where ncf is not null;

create index invoices_created_idx  on public.invoices (company_id, created_at desc);
create index invoices_session_idx  on public.invoices (cash_session_id);
create index invoices_customer_idx on public.invoices (customer_id);

create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

create table public.invoice_items (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices(id) on delete cascade,
  item_type          app.item_type not null,
  service_id         uuid references public.services(id) on delete restrict,
  product_id         uuid references public.products(id) on delete restrict,
  name               text not null,
  quantity           integer not null check (quantity > 0),
  unit_price_cents   bigint not null check (unit_price_cents >= 0),
  discount_cents     bigint not null default 0 check (discount_cents >= 0),
  is_membego_covered boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint invoice_items_discount_within_line
    check (discount_cents <= unit_price_cents * quantity)
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- Numeración correlativa de facturas, análoga a la de órdenes.
create or replace function app.assign_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null or new.invoice_number = '' then
    new.invoice_number := 'FAC-' ||
      lpad(app.next_document_number(new.company_id, 'invoice')::text, 8, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_number
  before insert on public.invoices
  for each row execute function app.assign_invoice_number();

-- Cierra las referencias pendientes de cash_movements.
alter table public.cash_movements
  add constraint cash_movements_invoice_fk
  foreign key (invoice_id) references public.invoices(id) on delete set null;

-- ---------------------------------------------------------------- Gastos

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete restrict,
  category        app.expense_category not null default 'varios',
  description     text not null check (length(trim(description)) > 0),
  amount_cents    bigint not null check (amount_cents > 0),
  payment_method  app.payment_method not null default 'efectivo',
  supplier_name   text,
  invoice_ref     text,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  expense_date    date not null default current_date,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index expenses_company_date_idx on public.expenses (company_id, expense_date desc);

create trigger expenses_touch before update on public.expenses
  for each row execute function app.touch_updated_at();

alter table public.cash_movements
  add constraint cash_movements_expense_fk
  foreign key (expense_id) references public.expenses(id) on delete set null;

-- ---------------------------------------------------------------- Comisiones

create table public.commissions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete restrict,
  profile_id        uuid not null references public.profiles(id) on delete restrict,
  work_order_id     uuid not null references public.work_orders(id) on delete cascade,
  work_order_item_id uuid references public.work_order_items(id) on delete set null,
  service_name      text not null,
  base_cents        bigint not null check (base_cents >= 0),
  commission_bps    integer not null check (commission_bps between 0 and 10000),
  amount_cents      bigint not null check (amount_cents >= 0),
  earned_on         date not null default current_date,
  is_paid           boolean not null default false,
  paid_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index commissions_profile_idx on public.commissions (profile_id, earned_on desc);
create index commissions_unpaid_idx  on public.commissions (company_id) where not is_paid;
