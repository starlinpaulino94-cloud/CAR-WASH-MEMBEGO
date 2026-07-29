-- =============================================================================
-- 0008 · Facturación transaccional y notas de crédito
-- =============================================================================
-- Resuelve C9 y §4.1 (cuatro mutaciones que debían ser atómicas y no lo eran),
-- H3/I8 (doble clic = dos facturas) y completa C6 (la anulación no emitía nota
-- de crédito ni revertía caja e inventario).
--
-- Todo ocurre dentro de una única función y, por tanto, de una única
-- transacción: o se aplica entero o no se aplica nada.
--
-- Las funciones son SECURITY INVOKER a propósito. La autorización sigue siendo
-- responsabilidad de RLS (migración 0007): un cajero puede facturar pero no
-- anular, y eso lo decide la política, no el código de esta función.
-- =============================================================================

-- ------------------------------------------------------- Columnas nuevas

alter table public.invoices
  -- Clave de idempotencia generada por el cliente UNA vez por operación (no por
  -- intento). En la aplicación auditada la clave incluía Date.now(), así que
  -- cada reintento generaba una distinta y la protección nunca podía funcionar.
  add column client_request_id text,
  -- Si esta fila ES una nota de crédito, a qué factura anula.
  add column credits_invoice_id uuid references public.invoices(id) on delete restrict;

create unique index invoices_idempotency_unique
  on public.invoices (company_id, client_request_id)
  where client_request_id is not null;

create index invoices_credits_idx on public.invoices (credits_invoice_id)
  where credits_invoice_id is not null;

-- Una nota de crédito siempre es de tipo B04 y siempre apunta a un original.
alter table public.invoices
  add constraint invoices_credit_note_is_coherent check (
    (credits_invoice_id is null) or (ncf_type = 'B04')
  );

-- =============================================================================
-- app.resolve_item_price · el precio SIEMPRE lo pone el servidor
-- =============================================================================
-- Nunca se acepta el precio que envía el cliente: un navegador manipulado
-- podría facturar a cero. Se resuelve contra el catálogo y, para servicios,
-- contra la matriz de precios por categoría de vehículo.
create or replace function app.resolve_item_price(
  p_item_type        app.item_type,
  p_service_id       uuid,
  p_product_id       uuid,
  p_vehicle_category app.vehicle_category
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
  else
    select price_cents into v_price
    from public.service_prices
    where service_id = p_service_id and vehicle_category = p_vehicle_category;

    if v_price is null then
      raise exception
        'El servicio % no tiene precio definido para la categoría %',
        p_service_id, p_vehicle_category
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return v_price;
end;
$$;

-- =============================================================================
-- public.create_invoice · emisión atómica
-- =============================================================================
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

    -- Inventario
    if v_item.item_type = 'product' then
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
