-- =============================================================================
-- PARCHE 0028 (editor SQL de Supabase) · Crédito de clientes y cuentas por cobrar
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches de la Fase 1 (0019-0022) y de la Fase 2 (0023-0027).
-- Es idempotente: puedes correrlo más de una vez sin daño.
--
-- Qué corrige, en una línea: el punto de venta aceptaba «crédito» como forma
-- de pago, marcaba la orden como PAGADA y sumaba el importe a la caja. Fiar
-- era regalar el servicio y descuadrar el arqueo.
-- =============================================================================

alter table public.customers
  add column if not exists credit_enabled     boolean not null default false,
  add column if not exists credit_limit_cents bigint  not null default 0,
  -- Días de plazo desde la emisión. 0 = vence el mismo día.
  add column if not exists credit_terms_days  integer not null default 0;

-- Los CHECK van aparte: `add column if not exists` no los vuelve a crear si la
-- columna ya estaba, y `add constraint` no admite `if not exists`.
do $do$ begin
  alter table public.customers
    add constraint customers_credit_limit_non_negative check (credit_limit_cents >= 0);
exception when duplicate_object then null; end $do$;
do $do$ begin
  alter table public.customers
    add constraint customers_credit_terms_sane check (credit_terms_days between 0 and 365);
exception when duplicate_object then null; end $do$;

create index if not exists customers_credit_idx on public.customers (company_id)
  where credit_enabled;

-- El cupo es dinero, no un dato de contacto. La política `customers_write`
-- deja a cualquiera del tenant editar el directorio (teléfono, dirección…);
-- sin este guardia, ese mismo permiso alcanzaría para subirse el cupo a
-- voluntad. Solo set_customer_credit() abre la puerta.
create or replace function app.customers_credit_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.credit_enabled     is distinct from old.credit_enabled
   or new.credit_limit_cents is distinct from old.credit_limit_cents
   or new.credit_terms_days  is distinct from old.credit_terms_days)
     and coalesce(current_setting('app.credit_ctx', true), '') <> 'ok' then
    raise exception
      'El cupo de crédito no se edita directamente. Use set_customer_credit().'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_credit_guard on public.customers;
create trigger customers_credit_guard
  before update on public.customers
  for each row execute function app.customers_credit_guard();

-- ================================================== Cuentas por cobrar

create table if not exists public.receivables (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  customer_id    uuid not null,
  -- Una factura abre como mucho UNA cuenta por cobrar.
  invoice_id     uuid not null,
  work_order_id  uuid,
  issued_on      date not null default current_date,
  due_on         date not null,
  total_cents    bigint not null check (total_cents > 0),
  paid_cents     bigint not null default 0 check (paid_cents >= 0),
  status         text not null default 'pendiente'
                 check (status in ('pendiente', 'pagada', 'anulada')),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, invoice_id),
  constraint receivables_customer_same_company
    foreign key (customer_id, company_id) references public.customers(id, company_id) on delete restrict,
  constraint receivables_invoice_same_company
    foreign key (invoice_id, company_id) references public.invoices(id, company_id) on delete restrict,
  constraint receivables_paid_within_total check (paid_cents <= total_cents),
  constraint receivables_due_after_issue   check (due_on >= issued_on)
);

create index if not exists receivables_customer_idx on public.receivables (company_id, customer_id)
  where status = 'pendiente';
-- Índice de la vejez de saldos: el listado natural es «lo más vencido primero».
create index if not exists receivables_due_idx on public.receivables (company_id, due_on)
  where status = 'pendiente';

drop trigger if exists receivables_touch on public.receivables;
create trigger receivables_touch before update on public.receivables
  for each row execute function app.touch_updated_at();

create table if not exists public.receivable_payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  receivable_id   uuid not null,
  amount_cents    bigint not null check (amount_cents > 0),
  payment_method  app.payment_method not null default 'efectivo',
  reference       text,
  notes           text,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint receivable_payments_receivable_same_company
    foreign key (receivable_id, company_id) references public.receivables(id, company_id) on delete cascade,
  -- Un crédito no se abona con otro crédito.
  constraint receivable_payments_method_is_real check (payment_method <> 'credito')
);

create index if not exists receivable_payments_receivable_idx
  on public.receivable_payments (receivable_id, created_at);

-- RLS: lectura por tenant; escritura SOLO por RPC.
alter table public.receivables         enable row level security;
alter table public.receivables         force  row level security;
alter table public.receivable_payments enable row level security;
alter table public.receivable_payments force  row level security;

drop policy if exists receivables_select on public.receivables;
create policy receivables_select on public.receivables
  for select to authenticated using (app.belongs_to_tenant(company_id));
drop policy if exists receivable_payments_select on public.receivable_payments;
create policy receivable_payments_select on public.receivable_payments
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.receivables, public.receivable_payments to authenticated;

-- ============================================ Fotografía del crédito
-- Un único sitio calcula saldo, mora y disponible. El punto de venta, la
-- pantalla de cobros y el bloqueo por mora leen todos de aquí: si la regla
-- cambia, cambia en un solo lugar.
create or replace function app.credit_snapshot(
  p_customer_id uuid,
  p_as_of       date default current_date
)
returns table (
  credit_enabled  boolean,
  limit_cents     bigint,
  terms_days      integer,
  balance_cents   bigint,
  overdue_cents   bigint,
  oldest_due      date,
  available_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.credit_enabled,
    c.credit_limit_cents,
    c.credit_terms_days,
    coalesce(r.balance, 0),
    coalesce(r.overdue, 0),
    r.oldest,
    greatest(0, c.credit_limit_cents - coalesce(r.balance, 0))
  from public.customers c
  left join lateral (
    select
      sum(total_cents - paid_cents)                                   as balance,
      sum(total_cents - paid_cents) filter (where due_on < p_as_of)   as overdue,
      min(due_on) filter (where due_on < p_as_of)                     as oldest
    from public.receivables
    where customer_id = c.id and status = 'pendiente'
  ) r on true
  where c.id = p_customer_id;
$$;

comment on function app.credit_snapshot is
  'Saldo, mora y cupo disponible de un cliente. Fuente única de la regla de crédito.';

create or replace function public.customer_credit_status(p_customer_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'customer_id',     p_customer_id,
    'credit_enabled',  s.credit_enabled,
    'limit_cents',     s.limit_cents,
    'terms_days',      s.terms_days,
    'balance_cents',   s.balance_cents,
    'overdue_cents',   s.overdue_cents,
    'oldest_due',      s.oldest_due,
    'available_cents', s.available_cents,
    'blocked',         (s.overdue_cents > 0)
  )
  from app.credit_snapshot(p_customer_id) s;
$$;

grant execute on function public.customer_credit_status(uuid) to authenticated;

comment on function public.customer_credit_status is
  'Estado de crédito de un cliente para el punto de venta: cupo, saldo, mora y disponible.';

-- ==================================================== Autorizar el crédito
create or replace function public.set_customer_credit(
  p_customer_id uuid,
  p_enabled     boolean,
  p_limit_cents bigint  default 0,
  p_terms_days  integer default 0
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_customer public.customers;
  v_snapshot record;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite autorizar crédito a clientes.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_limit_cents, 0) < 0 then
    raise exception 'El cupo no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if coalesce(p_terms_days, 0) < 0 or coalesce(p_terms_days, 0) > 365 then
    raise exception 'El plazo debe estar entre 0 y 365 días.' using errcode = 'check_violation';
  end if;

  select * into v_customer from public.customers
  where id = p_customer_id and company_id = v_company
  for update;
  if v_customer.id is null then
    raise exception 'Cliente inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  -- Bajar el cupo por debajo de lo ya fiado dejaría al cliente en un estado
  -- imposible de explicar. Primero se cobra, después se recorta.
  select * into v_snapshot from app.credit_snapshot(p_customer_id);
  if p_enabled and coalesce(p_limit_cents, 0) < v_snapshot.balance_cents then
    raise exception
      'El cupo (%) no puede quedar por debajo del saldo pendiente (%).',
      p_limit_cents, v_snapshot.balance_cents using errcode = 'check_violation';
  end if;
  if not p_enabled and v_snapshot.balance_cents > 0 then
    raise exception
      'No se puede retirar el crédito con un saldo pendiente de %.', v_snapshot.balance_cents
      using errcode = 'check_violation';
  end if;

  perform set_config('app.credit_ctx', 'ok', true);
  update public.customers
     set credit_enabled     = p_enabled,
         credit_limit_cents = case when p_enabled then coalesce(p_limit_cents, 0) else 0 end,
         credit_terms_days  = case when p_enabled then coalesce(p_terms_days, 0) else 0 end
   where id = p_customer_id
  returning * into v_customer;
  perform set_config('app.credit_ctx', '', true);

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, v_customer.branch_id, 'AUTORIZAR_CREDITO', 'customer', p_customer_id::text,
    case when p_enabled
         then format('%s · cupo %s centavos a %s días', v_customer.name,
                     v_customer.credit_limit_cents, v_customer.credit_terms_days)
         else format('%s · crédito retirado', v_customer.name) end,
    jsonb_build_object('enabled', p_enabled,
                       'limit_cents', v_customer.credit_limit_cents,
                       'terms_days', v_customer.credit_terms_days)
  );

  return v_customer;
end;
$$;

grant execute on function public.set_customer_credit(uuid, boolean, bigint, integer) to authenticated;

comment on function public.set_customer_credit is
  'Autoriza, ajusta o retira el crédito de un cliente. Única vía para tocar el cupo.';

-- ============================================ Abrir la cuenta (interno)
-- La llama create_invoice, que es SECURITY INVOKER y por tanto no puede
-- escribir en receivables. Mismo patrón que app.consume_recipes (0021).
create or replace function app.open_receivable(
  p_invoice     public.invoices,
  p_amount      bigint,
  p_customer_id uuid
)
returns public.receivables
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot record;
  v_result   public.receivables;
begin
  select * into v_snapshot from app.credit_snapshot(p_customer_id);
  if not found then
    raise exception 'Cliente inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  insert into public.receivables (
    company_id, branch_id, customer_id, invoice_id, work_order_id,
    issued_on, due_on, total_cents, created_by
  ) values (
    p_invoice.company_id, p_invoice.branch_id, p_customer_id, p_invoice.id,
    p_invoice.work_order_id,
    current_date, current_date + v_snapshot.terms_days, p_amount, auth.uid()
  )
  returning * into v_result;

  return v_result;
end;
$$;

-- ================================================ Cancelar la cuenta (interno)
create or replace function app.cancel_receivable(p_invoice_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.receivables
     set status = 'anulada'
   where invoice_id = p_invoice_id and status <> 'anulada';
$$;

-- ==================================================== Cobrar un abono
create or replace function public.collect_receivable(
  p_receivable_id   uuid,
  p_amount_cents    bigint,
  p_payment_method  app.payment_method default 'efectivo',
  p_reference       text default null,
  p_cash_session_id uuid default null
)
returns public.receivables
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company    uuid := app.current_company_id();
  v_receivable public.receivables;
  v_customer   text;
  v_session    public.cash_sessions;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor',
                         'cajero', 'contador', 'superadmin') then
    raise exception 'Su rol no permite registrar cobros.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'El abono debe ser mayor que cero.' using errcode = 'check_violation';
  end if;
  if p_payment_method = 'credito' then
    raise exception 'Un crédito no se abona con otro crédito.' using errcode = 'check_violation';
  end if;

  select * into v_receivable from public.receivables
  where id = p_receivable_id and company_id = v_company
  for update;
  if v_receivable.id is null then
    raise exception 'Cuenta por cobrar inexistente o fuera de su alcance.'
      using errcode = 'no_data_found';
  end if;
  if v_receivable.status <> 'pendiente' then
    raise exception 'La cuenta ya está % y no admite abonos.', v_receivable.status
      using errcode = 'check_violation';
  end if;
  if v_receivable.paid_cents + p_amount_cents > v_receivable.total_cents then
    raise exception 'El abono (%) supera el saldo pendiente (%).',
      p_amount_cents, v_receivable.total_cents - v_receivable.paid_cents
      using errcode = 'check_violation';
  end if;

  -- El efectivo cobrado tiene que caer en una caja abierta o el arqueo miente.
  if p_payment_method = 'efectivo' and p_cash_session_id is null then
    raise exception 'Un cobro en efectivo exige la sesión de caja abierta.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_cash_session_id is not null then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and company_id = v_company and status = 'open';
    if v_session.id is null then
      raise exception 'La sesión de caja no existe o no está abierta.' using errcode = 'no_data_found';
    end if;
  end if;

  select name into v_customer from public.customers where id = v_receivable.customer_id;

  insert into public.receivable_payments (
    company_id, receivable_id, amount_cents, payment_method, reference,
    cash_session_id, created_by
  ) values (
    v_company, p_receivable_id, p_amount_cents, p_payment_method, p_reference,
    p_cash_session_id, auth.uid()
  );

  update public.receivables
     set paid_cents = paid_cents + p_amount_cents,
         status = case when paid_cents + p_amount_cents >= total_cents
                       then 'pagada' else 'pendiente' end
   where id = p_receivable_id
  returning * into v_receivable;

  -- El movimiento de caja lleva la factura de origen: así la anulación de esa
  -- factura revierte también los abonos, sin lógica aparte.
  if v_session.id is not null then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason,
      invoice_id, created_by
    ) values (
      v_company, v_session.id, 'inflow', p_payment_method, p_amount_cents,
      'Cobro a crédito: ' || coalesce(v_customer, '—')
        || case when p_reference is not null then ' · ref ' || p_reference else '' end,
      v_receivable.invoice_id, auth.uid()
    );
  end if;

  -- La orden refleja lo cobrado de verdad.
  if v_receivable.work_order_id is not null then
    update public.work_orders
       set payment_status = case when v_receivable.status = 'pagada'
                                 then 'pagado'::app.payment_status
                                 else 'parcial'::app.payment_status end
     where id = v_receivable.work_order_id and company_id = v_company;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_receivable.branch_id, 'COBRAR_CREDITO', 'receivable',
          v_receivable.id::text,
          format('%s · abono %s · saldo %s', coalesce(v_customer, '—'), p_amount_cents,
                 v_receivable.total_cents - v_receivable.paid_cents));

  return v_receivable;
end;
$$;

grant execute on function public.collect_receivable(uuid, bigint, app.payment_method, text, uuid)
  to authenticated;

comment on function public.collect_receivable is
  'Abona a una cuenta por cobrar: registra el pago, entra a caja, liquida la cuenta y actualiza la orden.';

-- ============================================== Vejez de saldos (aging)
create or replace function public.receivables_aging(p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar las cuentas por cobrar.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Los tramos se miden en días transcurridos DESDE el vencimiento; lo que aún
  -- no vence va a «corriente», no al tramo 0-30.
  with saldos as (
    select r.customer_id,
           c.name as customer_name,
           r.total_cents - r.paid_cents as saldo,
           case
             when r.due_on >= p_as_of then 'corriente'
             when p_as_of - r.due_on <= 30 then 'd1_30'
             when p_as_of - r.due_on <= 60 then 'd31_60'
             when p_as_of - r.due_on <= 90 then 'd61_90'
             else 'd90_mas'
           end as tramo
    from public.receivables r
    join public.customers c on c.id = r.customer_id
    where r.company_id = v_company
      and r.status = 'pendiente'
      and r.total_cents > r.paid_cents
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'totals', jsonb_build_object(
      'corriente', coalesce(sum(saldo) filter (where tramo = 'corriente'), 0),
      'd1_30',     coalesce(sum(saldo) filter (where tramo = 'd1_30'), 0),
      'd31_60',    coalesce(sum(saldo) filter (where tramo = 'd31_60'), 0),
      'd61_90',    coalesce(sum(saldo) filter (where tramo = 'd61_90'), 0),
      'd90_mas',   coalesce(sum(saldo) filter (where tramo = 'd90_mas'), 0),
      'total',     coalesce(sum(saldo), 0),
      'vencido',   coalesce(sum(saldo) filter (where tramo <> 'corriente'), 0)
    ),
    'by_customer', coalesce((
      select jsonb_agg(x order by x ->> 'customer_name')
      from (
        select jsonb_build_object(
          'customer_id',   customer_id,
          'customer_name', customer_name,
          'corriente', coalesce(sum(saldo) filter (where tramo = 'corriente'), 0),
          'd1_30',     coalesce(sum(saldo) filter (where tramo = 'd1_30'), 0),
          'd31_60',    coalesce(sum(saldo) filter (where tramo = 'd31_60'), 0),
          'd61_90',    coalesce(sum(saldo) filter (where tramo = 'd61_90'), 0),
          'd90_mas',   coalesce(sum(saldo) filter (where tramo = 'd90_mas'), 0),
          'total',     sum(saldo)
        ) as x
        from saldos group by customer_id, customer_name
      ) g
    ), '[]'::jsonb)
  ) into v_result
  from saldos;

  return v_result;
end;
$$;

grant execute on function public.receivables_aging(date) to authenticated;

comment on function public.receivables_aging is
  'Vejez de saldos por cobrar: corriente, 1-30, 31-60, 61-90 y +90 días, total y por cliente.';

-- =============================================================================
-- public.create_invoice · reinstalada con crédito real
-- =============================================================================
-- Cambia únicamente lo que el crédito exige. El resto es idéntico a 0019.
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
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category
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
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category
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
                       'receivable_id', v_receivable.id)
  );

  return v_invoice;
end;
$$;

comment on function public.create_invoice is
  'Emisión atómica: factura, líneas, caja, inventario, crédito, orden y auditoría en una transacción. '
  'Idempotente por client_request_id. Lo fiado abre cuenta por cobrar y no entra a caja.';

-- =============================================================================
-- public.annul_invoice · anula también la cuenta por cobrar
-- =============================================================================
-- Idéntica a 0019 salvo el cierre de la cuenta por cobrar. Los abonos ya
-- cobrados se revierten solos: sus movimientos de caja llevan invoice_id, así
-- que el bucle de reversión existente los recoge.
create or replace function public.annul_invoice(
  p_invoice_id        uuid,
  p_reason            text,
  p_client_request_id text
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company     uuid;
  v_original    public.invoices;
  v_existing    public.invoices;
  v_credit      public.invoices;
  v_item        record;
  v_movement    record;
  v_session     uuid;
  v_ncf         text;
  v_rows        integer;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'La anulación exige un motivo' using errcode = 'invalid_parameter_value';
  end if;
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();

  -- Idempotencia: un segundo clic devuelve la nota de crédito ya emitida.
  select * into v_existing
  from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  -- FOR UPDATE serializa dos anulaciones simultáneas de la misma factura.
  select * into v_original from public.invoices
  where id = p_invoice_id and company_id = v_company
  for update;

  if v_original.id is null then
    raise exception 'Factura % inexistente o fuera de su alcance', p_invoice_id
      using errcode = 'no_data_found';
  end if;
  if v_original.is_annulled then
    raise exception 'La factura % ya está anulada', v_original.invoice_number
      using errcode = 'invalid_parameter_value';
  end if;
  if v_original.credits_invoice_id is not null then
    raise exception 'Una nota de crédito no se anula' using errcode = 'invalid_parameter_value';
  end if;

  -- Caja donde se registra la devolución: la original si sigue abierta; si no,
  -- la que esté abierta ahora en esa sucursal. Devolver efectivo contra una caja
  -- cerrada descuadraría un arqueo ya firmado.
  if v_original.total_cents > 0 then
    select id into v_session from public.cash_sessions
    where id = v_original.cash_session_id and status = 'open';

    if v_session is null then
      select id into v_session from public.cash_sessions
      where branch_id = v_original.branch_id and status = 'open'
      order by opened_at desc limit 1;
    end if;

    if v_session is null then
      raise exception
        'No hay caja abierta en la sucursal para registrar la devolución. Abra la caja antes de anular.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Solo se emite NCF de nota de crédito si la factura original llevaba NCF.
  if v_original.ncf is not null then
    v_ncf := app.allocate_ncf(v_company, 'B04');
  end if;

  insert into public.invoices (
    company_id, branch_id, client_request_id, ncf, ncf_type, credits_invoice_id,
    work_order_id, customer_id, customer_name, customer_tax_id, vehicle_plate,
    subtotal_cents, discount_cents, tax_cents, total_cents, change_cents,
    cash_session_id, cashier_id
  ) values (
    v_company, v_original.branch_id, p_client_request_id, v_ncf,
    case when v_ncf is not null then 'B04'::app.ncf_type else null end,
    v_original.id,
    v_original.work_order_id, v_original.customer_id, v_original.customer_name,
    v_original.customer_tax_id, v_original.vehicle_plate,
    v_original.subtotal_cents, v_original.discount_cents, v_original.tax_cents,
    v_original.total_cents, 0,
    v_session, auth.uid()
  )
  returning * into v_credit;

  -- Las líneas se copian tal cual: la nota de crédito debe poder leerse sola.
  insert into public.invoice_items (
    invoice_id, item_type, service_id, product_id, name,
    quantity, unit_price_cents, discount_cents, is_membego_covered
  )
  select v_credit.id, item_type, service_id, product_id, name,
         quantity, unit_price_cents, discount_cents, is_membego_covered
  from public.invoice_items where invoice_id = v_original.id;

  -- ------------------------------------------------------ Reversión de stock
  for v_item in
    select product_id, quantity from public.invoice_items
    where invoice_id = v_original.id and item_type = 'product' and product_id is not null
  loop
    perform set_config('app.inventory_ctx', jsonb_build_object(
      'kind', 'devolucion', 'invoice_id', v_credit.id, 'branch_id', v_original.branch_id
    )::text, true);
    update public.products
       set stock = stock + v_item.quantity
     where id = v_item.product_id and company_id = v_company;
  end loop;

  -- ------------------------------------------------------- Reversión de caja
  -- Asiento compensatorio, nunca borrado del original: el histórico de caja es
  -- inmutable y una corrección debe verse como tal. Incluye los abonos que se
  -- hubiesen cobrado contra la cuenta por cobrar de esta misma factura.
  for v_movement in
    select method, amount_cents from public.cash_movements
    where invoice_id = v_original.id and type = 'inflow'
  loop
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, invoice_id, created_by
    ) values (
      v_company, v_session, 'outflow', v_movement.method, v_movement.amount_cents,
      'Anulación de ' || v_original.invoice_number
        || coalesce(' · NC ' || v_ncf, '') || ' · ' || p_reason,
      v_credit.id, auth.uid()
    );
  end loop;

  -- --------------------------------------------------------- Marcar original
  update public.invoices
     set is_annulled     = true,
         annulled_reason = p_reason,
         annulled_at     = now(),
         annulled_by     = auth.uid(),
         credit_note_id  = v_credit.id
   where id = v_original.id;

  get diagnostics v_rows = row_count;
  -- Sin esta comprobación, un cajero sin permiso vería la anulación como
  -- realizada: RLS habría filtrado la fila sin lanzar ningún error.
  if v_rows = 0 then
    raise exception 'No tiene permiso para anular facturas'
      using errcode = 'insufficient_privilege';
  end if;

  -- La cuenta por cobrar muere con la factura: el cliente ya no debe nada por
  -- un servicio que se anuló, y el cupo le vuelve a quedar libre.
  perform app.cancel_receivable(v_original.id);

  -- La orden vuelve a quedar pendiente de cobro.
  if v_original.work_order_id is not null then
    update public.work_orders
       set payment_status = 'pendiente', payment_method = null
     where id = v_original.work_order_id and company_id = v_company;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, v_original.branch_id, 'ANULAR_FACTURA', 'Invoice', v_original.id::text,
    'Anulada ' || v_original.invoice_number || ' mediante nota de crédito '
      || v_credit.invoice_number || coalesce(' (NCF ' || v_ncf || ')', '') || ' · Motivo: ' || p_reason,
    jsonb_build_object('credit_note_id', v_credit.id, 'reversed_cents', v_original.total_cents)
  );

  return v_credit;
end;
$$;

comment on function public.annul_invoice is
  'Anula con nota de crédito B04, revierte inventario, caja y crédito, y libera la orden. Atómico e idempotente.';

grant execute on function public.create_invoice to authenticated;
grant execute on function public.annul_invoice  to authenticated;

comment on table public.receivables is
  'Cuentas por cobrar: una por factura fiada. total_cents - paid_cents = saldo; '
  'due_on vencida con saldo = mora, y la mora bloquea nuevas ventas a crédito.';
comment on table public.receivable_payments is
  'Abonos a cuentas por cobrar. Se registran solo por collect_receivable().';
