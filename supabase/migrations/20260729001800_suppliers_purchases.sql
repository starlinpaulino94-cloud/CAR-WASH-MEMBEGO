-- =============================================================================
-- 0020 · Proveedores y compras con cuentas por pagar
-- =============================================================================
-- Hasta ahora "el proveedor" era un texto dentro del gasto: se sabía cuánto se
-- gastó, pero no qué se compró, a quién, ni cuánto se debe. Este módulo añade:
--
--   · suppliers: directorio de proveedores del tenant.
--   · purchases + purchase_items: la compra (contado o crédito) con su detalle.
--     Registrar la compra ENTRA el inventario (kardex 'compra') y actualiza el
--     último costo del producto. Al contado puede descontar de la caja abierta.
--   · supplier_payments: abonos a compras a crédito; el saldo y el vencimiento
--     son las cuentas por pagar.
--
-- Escritura solo por RPC (register_purchase / pay_supplier): validan rol,
-- tenant y consistencia, y dejan bitácora. Los proveedores sí se editan
-- directo con política por rol (es un directorio, no dinero).
-- =============================================================================

-- ---------------------------------------------------------------- Proveedores
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  tax_id      text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name),
  -- Referencia estable para las FKs compuestas de aislamiento.
  unique (id, company_id)
);

create index suppliers_company_idx on public.suppliers (company_id);

create trigger suppliers_touch before update on public.suppliers
  for each row execute function app.touch_updated_at();

alter table public.suppliers enable row level security;
alter table public.suppliers force  row level security;

create policy suppliers_select on public.suppliers
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- El directorio lo administran los roles de compras.
create policy suppliers_write on public.suppliers
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin'));

grant select, insert, update on public.suppliers to authenticated;

-- -------------------------------------------------------------------- Compras
create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete set null,
  supplier_id     uuid not null,
  invoice_ref     text,                        -- nº de factura del proveedor
  purchase_date   date not null default current_date,
  is_credit       boolean not null default false,
  due_date        date,                        -- obligatorio si es a crédito
  payment_method  app.payment_method not null default 'efectivo',
  subtotal_cents  bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents       bigint not null default 0 check (tax_cents >= 0),
  total_cents     bigint not null default 0 check (total_cents >= 0),
  paid_cents      bigint not null default 0 check (paid_cents >= 0),
  status          text not null default 'recibida' check (status in ('recibida', 'anulada')),
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  constraint purchases_supplier_same_company
    foreign key (supplier_id, company_id) references public.suppliers(id, company_id) on delete restrict,
  constraint purchases_credit_due check (not is_credit or due_date is not null),
  constraint purchases_paid_within_total check (paid_cents <= total_cents)
);

create index purchases_company_time_idx on public.purchases (company_id, purchase_date desc);
create index purchases_pending_idx on public.purchases (company_id, due_date)
  where paid_cents < total_cents and status = 'recibida';

create trigger purchases_touch before update on public.purchases
  for each row execute function app.touch_updated_at();

create table public.purchase_items (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null,
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null,
  quantity        integer not null check (quantity > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  created_at      timestamptz not null default now(),
  constraint purchase_items_purchase_same_company
    foreign key (purchase_id, company_id) references public.purchases(id, company_id) on delete cascade,
  constraint purchase_items_product_same_company
    foreign key (product_id, company_id) references public.products(id, company_id) on delete restrict
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_product_idx  on public.purchase_items (product_id, created_at desc);

-- ----------------------------------------------------------- Abonos (pagos)
create table public.supplier_payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  purchase_id     uuid not null,
  amount_cents    bigint not null check (amount_cents > 0),
  payment_method  app.payment_method not null default 'efectivo',
  reference       text,
  notes           text,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint supplier_payments_purchase_same_company
    foreign key (purchase_id, company_id) references public.purchases(id, company_id) on delete cascade
);

create index supplier_payments_purchase_idx on public.supplier_payments (purchase_id);

-- RLS: lectura por tenant; escritura SOLO por RPC (security definer).
alter table public.purchases         enable row level security;
alter table public.purchases         force  row level security;
alter table public.purchase_items    enable row level security;
alter table public.purchase_items    force  row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payments force  row level security;

create policy purchases_select on public.purchases
  for select to authenticated using (app.belongs_to_tenant(company_id));
create policy purchase_items_select on public.purchase_items
  for select to authenticated using (app.belongs_to_tenant(company_id));
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.purchases, public.purchase_items, public.supplier_payments to authenticated;

-- --------------------------------------------- Kardex: referencia a la compra
alter table public.inventory_movements
  add column purchase_id uuid references public.purchases(id) on delete set null;

-- El guardia aprende a anotar la compra de origen.
create or replace function app.products_stock_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx  jsonb;
begin
  if new.stock is distinct from old.stock then
    v_ctx := nullif(current_setting('app.inventory_ctx', true), '')::jsonb;
    if v_ctx is null then
      raise exception
        'La existencia no se edita directamente. Use adjust_stock(producto, cantidad, motivo) '
        'o una operación que registre el movimiento (venta, compra, consumo).'
        using errcode = 'check_violation';
    end if;
    insert into public.inventory_movements (
      company_id, branch_id, product_id, kind,
      qty_change, qty_before, qty_after, reason,
      invoice_id, work_order_id, purchase_id, created_by
    ) values (
      new.company_id,
      coalesce((v_ctx ->> 'branch_id')::uuid, new.branch_id),
      new.id,
      (v_ctx ->> 'kind')::app.inventory_movement_kind,
      new.stock - old.stock, old.stock, new.stock,
      v_ctx ->> 'reason',
      (v_ctx ->> 'invoice_id')::uuid,
      (v_ctx ->> 'order_id')::uuid,
      (v_ctx ->> 'purchase_id')::uuid,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------- Registrar una compra
-- Items: [{ productId, quantity, unitCostCents }]. Contado: paga completo (y
-- puede descontar de la caja abierta). Crédito: exige vencimiento y queda como
-- cuenta por pagar. Cada item ENTRA inventario y actualiza el último costo.
create or replace function public.register_purchase(
  p_supplier_id     uuid,
  p_items           jsonb,
  p_is_credit       boolean default false,
  p_due_date        date default null,
  p_payment_method  app.payment_method default 'efectivo',
  p_invoice_ref     text default null,
  p_tax_cents       bigint default 0,
  p_notes           text default null,
  p_cash_session_id uuid default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_branch   uuid := app.current_branch_id();
  v_supplier public.suppliers;
  v_purchase public.purchases;
  v_item     record;
  v_subtotal bigint := 0;
  v_total    bigint;
  v_session  public.cash_sessions;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite registrar compras.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_supplier from public.suppliers
  where id = p_supplier_id and company_id = v_company and is_active;
  if v_supplier.id is null then
    raise exception 'Proveedor inexistente, inactivo o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra necesita al menos un renglón.' using errcode = 'check_violation';
  end if;
  if p_is_credit and p_due_date is null then
    raise exception 'Una compra a crédito necesita fecha de vencimiento.' using errcode = 'check_violation';
  end if;

  -- Validar renglones y sumar ANTES de escribir nada.
  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x("productId" uuid, quantity integer, "unitCostCents" bigint)
  loop
    if v_item."productId" is null or coalesce(v_item.quantity, 0) <= 0
       or coalesce(v_item."unitCostCents", -1) < 0 then
      raise exception 'Renglón inválido: producto, cantidad (>0) y costo (>=0) son obligatorios.'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.products
                   where id = v_item."productId" and company_id = v_company) then
      raise exception 'Un producto del detalle no pertenece a su empresa.' using errcode = 'no_data_found';
    end if;
    v_subtotal := v_subtotal + v_item.quantity * v_item."unitCostCents";
  end loop;
  v_total := v_subtotal + coalesce(p_tax_cents, 0);

  -- Caja (solo al contado en efectivo): debe ser SU sesión abierta.
  if not p_is_credit and p_cash_session_id is not null then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and company_id = v_company and status = 'open';
    if v_session.id is null then
      raise exception 'La sesión de caja no existe o no está abierta.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.purchases (
    company_id, branch_id, supplier_id, invoice_ref, is_credit, due_date,
    payment_method, subtotal_cents, tax_cents, total_cents, paid_cents,
    notes, created_by
  ) values (
    v_company, v_branch, p_supplier_id, nullif(trim(coalesce(p_invoice_ref, '')), ''),
    p_is_credit, p_due_date,
    p_payment_method, v_subtotal, coalesce(p_tax_cents, 0), v_total,
    case when p_is_credit then 0 else v_total end,
    p_notes, auth.uid()
  ) returning * into v_purchase;

  -- Detalle + entrada de inventario + último costo.
  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x("productId" uuid, quantity integer, "unitCostCents" bigint)
  loop
    insert into public.purchase_items (purchase_id, company_id, product_id, quantity, unit_cost_cents)
    values (v_purchase.id, v_company, v_item."productId", v_item.quantity, v_item."unitCostCents");

    perform set_config('app.inventory_ctx', jsonb_build_object(
      'kind', 'compra', 'purchase_id', v_purchase.id, 'branch_id', v_branch,
      'reason', 'Compra a ' || v_supplier.name
    )::text, true);

    update public.products
       set stock = stock + v_item.quantity,
           cost_cents = v_item."unitCostCents"
     where id = v_item."productId" and company_id = v_company;
  end loop;

  -- Al contado con efectivo de la caja: salida de caja en la misma operación.
  if not p_is_credit and v_session.id is not null then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, created_by
    ) values (
      v_company, v_session.id, 'outflow', p_payment_method, v_total,
      'Compra: ' || v_supplier.name || coalesce(' · ' || v_purchase.invoice_ref, ''),
      auth.uid()
    );
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_branch, 'REGISTRAR_COMPRA', 'purchase', v_purchase.id,
          format('%s · %s renglones · total %s · %s', v_supplier.name,
                 jsonb_array_length(p_items), v_total,
                 case when p_is_credit then 'crédito (vence ' || p_due_date || ')' else 'contado' end));

  return v_purchase;
end;
$$;

grant execute on function public.register_purchase(uuid, jsonb, boolean, date, app.payment_method, text, bigint, text, uuid) to authenticated;

-- --------------------------------------------------------- Abonar a una compra
create or replace function public.pay_supplier(
  p_purchase_id     uuid,
  p_amount_cents    bigint,
  p_payment_method  app.payment_method default 'efectivo',
  p_reference       text default null,
  p_cash_session_id uuid default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_purchase public.purchases;
  v_supplier text;
  v_session  public.cash_sessions;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite registrar pagos a proveedores.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'El abono debe ser mayor que cero.' using errcode = 'check_violation';
  end if;

  select * into v_purchase from public.purchases
  where id = p_purchase_id and company_id = v_company
  for update;
  if v_purchase.id is null then
    raise exception 'Compra inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_purchase.status <> 'recibida' then
    raise exception 'La compra está anulada.' using errcode = 'check_violation';
  end if;
  if v_purchase.paid_cents + p_amount_cents > v_purchase.total_cents then
    raise exception 'El abono (%) supera el saldo pendiente (%).',
      p_amount_cents, v_purchase.total_cents - v_purchase.paid_cents
      using errcode = 'check_violation';
  end if;

  if p_cash_session_id is not null then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and company_id = v_company and status = 'open';
    if v_session.id is null then
      raise exception 'La sesión de caja no existe o no está abierta.' using errcode = 'no_data_found';
    end if;
  end if;

  select name into v_supplier from public.suppliers where id = v_purchase.supplier_id;

  insert into public.supplier_payments (
    company_id, purchase_id, amount_cents, payment_method, reference,
    cash_session_id, created_by
  ) values (
    v_company, p_purchase_id, p_amount_cents, p_payment_method, p_reference,
    p_cash_session_id, auth.uid()
  );

  update public.purchases
     set paid_cents = paid_cents + p_amount_cents
   where id = p_purchase_id
  returning * into v_purchase;

  if v_session.id is not null then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, created_by
    ) values (
      v_company, v_session.id, 'outflow', p_payment_method, p_amount_cents,
      'Abono a proveedor: ' || coalesce(v_supplier, '—'), auth.uid()
    );
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_purchase.branch_id, 'ABONAR_PROVEEDOR', 'purchase', v_purchase.id,
          format('%s · abono %s · saldo %s', coalesce(v_supplier, '—'), p_amount_cents,
                 v_purchase.total_cents - v_purchase.paid_cents));

  return v_purchase;
end;
$$;

grant execute on function public.pay_supplier(uuid, bigint, app.payment_method, text, uuid) to authenticated;

comment on table public.purchases is
  'Compras a proveedores (contado o crédito). paid_cents < total_cents = cuenta por pagar; '
  'due_date vencida y saldo > 0 = mora. Registrar entra inventario (kardex compra).';
