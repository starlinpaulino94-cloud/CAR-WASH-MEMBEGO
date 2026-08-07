-- =============================================================================
-- PARCHE 0019 (editor SQL de Supabase) · Inventario real
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production). Es idempotente:
-- puedes correrlo más de una vez sin daño. Después de esto, la existencia ya
-- NO se edita directa: la app usa "Ajustar existencia" con motivo, y el kardex
-- vive en Inventario → Movimientos.
-- =============================================================================

-- =============================================================================
-- 0019 · Inventario real: movimientos, kardex y ajustes auditables
-- =============================================================================
-- Hasta ahora la existencia era un número editable a mano: la venta descontaba
-- y la anulación devolvía, pero sin rastro de POR QUÉ cambió cada unidad. Esta
-- migración convierte cada cambio de stock en un MOVIMIENTO auditable:
--
--   · inventory_movements: quién, cuándo, cuánto (antes → después), por qué y
--     con qué documento (factura, orden, y en 0020 la compra).
--   · Un trigger sobre products EXIGE contexto: la existencia ya no se edita
--     directamente. Sin contexto (venta, devolución, ajuste…) el UPDATE falla.
--   · adjust_stock(producto, nueva_cantidad, motivo): la única puerta para el
--     ajuste manual; motivo obligatorio, rol supervisor o superior, auditado.
--   · create_invoice / annul_invoice se reinstalan con el contexto puesto
--     (venta / devolución) alrededor de su cambio de stock.
--
-- El kardex es la lectura de inventory_movements por producto, vía RLS.
-- =============================================================================

-- Tipos de movimiento. Se incluyen desde ya los que estrenan 0020 (compra) y
-- 0021 (consumo por receta) para no alterar el enum después.
do $do$ begin
  create type app.inventory_movement_kind as enum
    ('entrada', 'compra', 'venta', 'devolucion', 'consumo', 'ajuste', 'merma', 'transferencia');
exception when duplicate_object then null; end $do$;

create table if not exists public.inventory_movements (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  product_id   uuid not null,
  kind         app.inventory_movement_kind not null,
  qty_change   integer not null check (qty_change <> 0),
  qty_before   integer not null,
  qty_after    integer not null,
  reason       text,
  invoice_id   uuid references public.invoices(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- El producto debe ser de la MISMA empresa (aislamiento por FK compuesta).
  constraint inventory_movements_product_same_company
    foreign key (product_id, company_id) references public.products(id, company_id) on delete cascade,
  constraint inventory_movements_consistent check (qty_after = qty_before + qty_change)
);

create index if not exists inventory_movements_product_idx
  on public.inventory_movements (product_id, created_at desc);
create index if not exists inventory_movements_company_time_idx
  on public.inventory_movements (company_id, created_at desc);

alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force  row level security;

-- Lectura: cualquier miembro del tenant (el kardex es información operativa).
drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Escritura: NADIE directamente. Solo el trigger (security definer) inserta.
grant select on public.inventory_movements to authenticated;

-- ============================================================ Guardia de stock
-- Todo cambio de products.stock DEBE llegar con contexto (quién lo clasifica).
-- Esto convierte el "editar la existencia a mano" en un error explícito.
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
      invoice_id, work_order_id, created_by
    ) values (
      new.company_id,
      coalesce((v_ctx ->> 'branch_id')::uuid, new.branch_id),
      new.id,
      (v_ctx ->> 'kind')::app.inventory_movement_kind,
      new.stock - old.stock, old.stock, new.stock,
      v_ctx ->> 'reason',
      (v_ctx ->> 'invoice_id')::uuid,
      (v_ctx ->> 'order_id')::uuid,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_stock_guard on public.products;
create trigger products_stock_guard
  before update on public.products
  for each row execute function app.products_stock_guard();

-- El alta con existencia inicial queda registrada como entrada.
create or replace function app.products_stock_initial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stock <> 0 then
    insert into public.inventory_movements (
      company_id, branch_id, product_id, kind,
      qty_change, qty_before, qty_after, reason, created_by
    ) values (
      new.company_id, new.branch_id, new.id, 'entrada',
      new.stock, 0, new.stock, 'Existencia inicial al crear el producto', auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_stock_initial on public.products;
create trigger products_stock_initial
  after insert on public.products
  for each row execute function app.products_stock_initial();

-- ============================================================ Ajuste manual
-- La ÚNICA puerta para corregir una existencia a mano: motivo obligatorio,
-- rol supervisor o superior, y queda en el kardex y en la bitácora.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_new_qty    integer,
  p_reason     text
)
returns public.products
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_product public.products;
  v_before  integer;
begin
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite ajustar inventario.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'El ajuste requiere un motivo (mínimo 5 caracteres).' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products
  where id = p_product_id and company_id = v_company
  for update;
  if v_product.id is null then
    raise exception 'Producto inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_product.stock = p_new_qty then
    return v_product;  -- nada que hacer, sin movimiento vacío
  end if;
  v_before := v_product.stock;

  perform set_config('app.inventory_ctx', jsonb_build_object(
    'kind', 'ajuste', 'reason', trim(p_reason)
  )::text, true);

  update public.products set stock = p_new_qty
  where id = p_product_id and company_id = v_company
  returning * into v_product;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_product.branch_id, 'AJUSTAR_INVENTARIO', 'product', v_product.id,
          format('%s: %s → %s (%s)', v_product.name, v_before, p_new_qty, trim(p_reason)));

  return v_product;
end;
$$;

grant execute on function public.adjust_stock(uuid, integer, text) to authenticated;

-- ============================================================ RPCs de venta
-- create_invoice y annul_invoice se reinstalan (cuerpo canónico de 0008) con el
-- contexto de inventario puesto alrededor de su cambio de stock.

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
  v_change       bigint;
  v_ncf          text := null;
  v_session      public.cash_sessions;
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
    end if;
  end loop;

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

  -- --------------------------------------------------------- Orden de trabajo
  if p_work_order_id is not null then
    update public.work_orders
       set payment_status = 'pagado',
           payment_method = (p_payments -> 0 ->> 'method')::app.payment_method
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
      || coalesce(' · NCF ' || v_ncf, ' · sin NCF'),
    jsonb_build_object('total_cents', v_total, 'ncf', v_ncf, 'idempotency', p_client_request_id)
  );

  return v_invoice;
end;
$$;

comment on function public.create_invoice is
  'Emisión atómica: factura, líneas, caja, inventario, orden y auditoría en una transacción. Idempotente por client_request_id.';

-- =============================================================================
-- public.annul_invoice · anulación con nota de crédito B04
-- =============================================================================

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
  -- inmutable y una corrección debe verse como tal.
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
  'Anula con nota de crédito B04, revierte inventario y caja, y libera la orden. Atómico e idempotente.';

grant execute on function public.create_invoice to authenticated;
grant execute on function public.annul_invoice  to authenticated;

comment on table public.inventory_movements is
  'Kardex: cada cambio de existencia con antes/después, clase, motivo y documento. '
  'Solo lo escribe el trigger de products; la existencia nunca se edita directa.';
