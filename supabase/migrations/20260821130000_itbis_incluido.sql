-- ============================================================================
-- ITBIS INCLUIDO EN EL PRECIO (interruptor por empresa)
-- ============================================================================
-- Antes: el 18% se SUMABA sobre el precio (un lavado de 1.000 cobraba 1.180).
-- Ahora, si la empresa marca `prices_include_tax`, el precio YA trae el ITBIS:
-- el cliente paga el precio de lista y el impuesto se EXTRAE de adentro para el
-- desglose fiscal (base = precio / 1.18, ITBIS = precio - base). Es el modo de
-- ZenWash y el estándar de precio al consumidor en RD.
--
-- El flag nace en FALSE: sin activarlo, el comportamiento (y las pruebas) no
-- cambian. Se activa por empresa. Las funciones fiscales se redefinen para
-- respetarlo — misma fórmula en las tres, sin copias divergentes.
--
-- Reejecutable: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
-- ============================================================================

alter table public.companies
  add column if not exists prices_include_tax boolean not null default false;

comment on column public.companies.prices_include_tax is
  'Si es true, los precios del catálogo YA incluyen el ITBIS y el impuesto se '
  'extrae del precio en vez de sumarse. Nace en false (compatibilidad).';

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
  p_cash_session_id   uuid    default null,
  p_promotion_code    text    default null
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
  v_incluido     boolean;
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
  v_promo_disc   bigint := 0;
  v_promo_lines  jsonb  := '[]'::jsonb;
  v_max_bps      integer;
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

    -- Detalle por línea para la promoción: con esto sabe si su alcance
    -- («este servicio», «las camionetas») toca algo de esta venta.
    v_promo_lines := v_promo_lines || jsonb_build_object(
      'service_id', v_item.service_id,
      'category', p_vehicle_category,
      'amount_cents', v_price * v_item.quantity - coalesce(v_item.discount_cents, 0)
    );
  end loop;

  select tax_rate_bps, max_manual_discount_bps, prices_include_tax
    into v_rate_bps, v_max_bps, v_incluido
  from public.companies where id = v_company;

  -- ------------------------------------------------- Techo del descuento manual
  -- Antes de 0032 el descuento lo ponía el cliente y nadie lo miraba: se podía
  -- dejar una factura en cero. La propiedad y la administración siguen pudiendo
  -- decidir, pero queda en la bitácora.
  if v_discount > 0 and v_subtotal > 0
     and not app.has_role('propietario', 'administrador', 'superadmin') then
    if v_discount * 10000 > v_subtotal::numeric * v_max_bps then
      raise exception
        'El descuento supera el máximo autorizado para su rol (% %% del subtotal).',
        rtrim(trim(to_char(v_max_bps / 100.0, 'FM999999990.99')), '.') using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ---------------------------------------------------------------- Promoción
  -- El código NO trae importe: el servidor lo recalcula con sus propias reglas.
  -- Lo que enseñó la pantalla es una previsualización, nunca la cifra que vale.
  if p_promotion_code is not null and length(trim(p_promotion_code)) > 0 then
    v_promo_disc := app.promotion_discount(
      (select p from public.promotions p
        where p.company_id = v_company
          and upper(p.code) = upper(trim(p_promotion_code))),
      v_subtotal, p_customer_id, v_promo_lines);
    v_discount := v_discount + v_promo_disc;
  end if;

  -- MISMA fórmula que app.recalc_work_order_totals(). En la aplicación auditada
  -- había tres versiones divergentes y la factura de una orden con beneficio
  -- Membego calculaba un ITBIS distinto al de la propia orden.
  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  if v_incluido then
    -- El precio YA incluye el ITBIS: el cliente paga v_taxable y el impuesto va
    -- dentro. Se extrae, no se suma encima (ITBIS incluido, como ZenWash).
    v_total := v_taxable;
    v_tax   := v_taxable - round(v_taxable::numeric * 10000 / (10000 + v_rate_bps))::bigint;
  else
    v_tax   := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;
    v_total := v_taxable + v_tax;
  end if;

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

  -- ------------------------------------------------------------- Canje
  -- Se registra con la factura ya creada: el canje apunta a ella, y el tope de
  -- usos se cuenta sobre canjes reales, no sobre intentos.
  if v_promo_disc > 0 then
    perform app.redeem_promotion(p_promotion_code, v_company, v_invoice,
                                 v_subtotal, v_promo_lines, p_customer_id);
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
      || case when v_credit_paid > 0 then ' · a crédito ' || v_credit_paid else '' end
      || case when v_promo_disc > 0
              then ' · promoción ' || upper(trim(p_promotion_code)) || ' −' || v_promo_disc
              else '' end,
    jsonb_build_object('total_cents', v_total, 'ncf', v_ncf,
                       'idempotency', p_client_request_id,
                       'credit_cents', v_credit_paid,
                       'receivable_id', v_receivable.id,
                       'fleet_id', v_fleet)
  );

  return v_invoice;
end;
$$;

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
  v_incluido boolean;
  v_tax      bigint;
  v_total    bigint;
begin
  select
    coalesce(sum(unit_price_cents * quantity), 0),
    coalesce(sum(case when is_membego_covered then 0 else discount_cents end), 0),
    coalesce(sum(case when is_membego_covered then unit_price_cents * quantity else 0 end), 0)
  into v_subtotal, v_discount, v_membego
  from public.work_order_items
  where work_order_id = p_order_id;

  select c.tax_rate_bps, c.prices_include_tax into v_rate_bps, v_incluido
  from public.work_orders o
  join public.companies c on c.id = o.company_id
  where o.id = p_order_id;

  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  -- Redondeo al centavo. Con ITBIS incluido, el impuesto se extrae del precio
  -- (que ya lo trae) en vez de sumarse encima.
  if v_incluido then
    v_total := v_taxable;
    v_tax   := v_taxable - round(v_taxable::numeric * 10000 / (10000 + v_rate_bps))::bigint;
  else
    v_tax   := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;
    v_total := v_taxable + v_tax;
  end if;

  update public.work_orders
     set subtotal_cents        = v_subtotal,
         discount_cents        = v_discount,
         membego_benefit_cents = v_membego,
         tax_cents             = v_tax,
         total_cents           = v_total
   where id = p_order_id;
end;
$$;

create or replace function public.credit_note_invoice(
  p_invoice_id        uuid,
  p_lines             jsonb,
  p_reason            text,
  p_client_request_id text
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company   uuid;
  v_original  public.invoices;
  v_existing  public.invoices;
  v_credit    public.invoices;
  v_line      record;
  v_item      public.invoice_items;
  v_neto      bigint;
  v_subtotal  bigint := 0;
  v_descuento bigint := 0;
  v_rate_bps  integer;
  v_incluido  boolean;
  v_tax       bigint;
  v_total     bigint;
  v_session   uuid;
  v_ncf       text := null;
  v_receivable public.receivables;
  v_a_cuenta  bigint := 0;
  v_efectivo  bigint := 0;
  v_rows      integer;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'La nota de crédito exige un motivo.' using errcode = 'invalid_parameter_value';
  end if;
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia.' using errcode = 'invalid_parameter_value';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Indique qué líneas se acreditan.' using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada.' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite emitir notas de crédito.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotencia: un segundo clic devuelve la nota ya emitida.
  select * into v_existing from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  -- FOR UPDATE serializa dos notas parciales sobre la misma factura: sin él,
  -- dos podrían acreditar la misma línea a la vez y pasarse de lo facturado.
  select * into v_original from public.invoices
  where id = p_invoice_id and company_id = v_company
  for update;

  if v_original.id is null then
    raise exception 'Factura % inexistente o fuera de su alcance.', p_invoice_id
      using errcode = 'no_data_found';
  end if;
  if v_original.is_annulled then
    raise exception 'La factura % ya está anulada.', v_original.invoice_number
      using errcode = 'invalid_parameter_value';
  end if;
  if v_original.credits_invoice_id is not null then
    raise exception 'Una nota de crédito no se acredita.' using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------- Importes
  -- Se valida y se suma TODO antes de escribir nada: media nota de crédito es
  -- peor que ninguna.
  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(invoice_item_id uuid, quantity integer)
  loop
    if coalesce(v_line.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida a acreditar.' using errcode = 'invalid_parameter_value';
    end if;

    -- Sin FOR UPDATE: invoice_items solo tiene políticas de SELECT e INSERT, y
    -- bajo RLS un SELECT ... FOR UPDATE exige además la de UPDATE, así que
    -- devolvería cero filas. La serialización ya la da el bloqueo de la factura.
    select * into v_item from public.invoice_items
    where id = v_line.invoice_item_id and invoice_id = v_original.id;

    if v_item.id is null then
      raise exception 'Esa línea no pertenece a la factura %.', v_original.invoice_number
        using errcode = 'no_data_found';
    end if;
    if v_item.is_membego_covered then
      raise exception 'La línea "%" la cubrió Membego: no se cobró, no hay qué devolver.',
        v_item.name using errcode = 'invalid_parameter_value';
    end if;
    if v_item.credited_quantity + v_line.quantity > v_item.quantity then
      raise exception 'De "%" ya se acreditaron % de %: no caben % más.',
        v_item.name, v_item.credited_quantity, v_item.quantity, v_line.quantity
        using errcode = 'check_violation';
    end if;

    -- El descuento de la línea se prorratea por unidad: acreditar la mitad de
    -- una línea con descuento devuelve la mitad del descuento, no el total.
    v_subtotal  := v_subtotal + v_item.unit_price_cents * v_line.quantity;
    v_descuento := v_descuento
      + round(v_item.discount_cents::numeric * v_line.quantity / v_item.quantity)::bigint;
  end loop;

  select tax_rate_bps, prices_include_tax into v_rate_bps, v_incluido
    from public.companies where id = v_company;
  v_neto  := greatest(0, v_subtotal - v_descuento);
  if v_incluido then
    -- La nota de crédito refleja el mismo criterio: el ITBIS iba incluido en lo
    -- vendido, así que se extrae de lo acreditado, no se suma.
    v_total := v_neto;
    v_tax   := v_neto - round(v_neto::numeric * 10000 / (10000 + v_rate_bps))::bigint;
  else
    v_tax   := round(v_neto::numeric * v_rate_bps / 10000)::bigint;
    v_total := v_neto + v_tax;
  end if;

  if v_total <= 0 then
    raise exception 'Lo seleccionado no suma importe alguno.' using errcode = 'check_violation';
  end if;
  if v_original.credited_cents + v_total > v_original.total_cents then
    raise exception 'La factura % ya tiene % acreditado de %: no caben % más.',
      v_original.invoice_number, v_original.credited_cents, v_original.total_cents, v_total
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------- Cuenta por cobrar (0028)
  -- Lo fiado y todavía sin cobrar se descuenta de la deuda ANTES de tocar la
  -- caja: devolver en efectivo algo que nunca entró sería regalarlo dos veces.
  v_receivable := app.receivable_pending_for_invoice(v_original.id);

  if v_receivable.id is not null then
    v_a_cuenta := least(v_total, v_receivable.total_cents - v_receivable.paid_cents);
  end if;
  v_efectivo := v_total - v_a_cuenta;

  -- ------------------------------------------------------------- Caja
  if v_efectivo > 0 then
    select id into v_session from public.cash_sessions
    where id = v_original.cash_session_id and status = 'open';

    if v_session is null then
      select id into v_session from public.cash_sessions
      where branch_id = v_original.branch_id and status = 'open'
      order by opened_at desc limit 1;
    end if;

    if v_session is null then
      raise exception
        'No hay caja abierta en la sucursal para registrar la devolución. Abra la caja primero.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Solo se consume NCF si la factura original llevaba uno.
  if v_original.ncf is not null then
    v_ncf := app.allocate_ncf(v_company, 'B04');
  end if;

  -- ------------------------------------------------------------- Escritura
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
    v_subtotal, v_descuento, v_tax, v_total, 0,
    v_session, auth.uid()
  )
  returning * into v_credit;

  -- Las líneas acreditadas, con su cantidad. La nota debe poder leerse sola.
  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(invoice_item_id uuid, quantity integer)
  loop
    select * into v_item from public.invoice_items where id = v_line.invoice_item_id;

    insert into public.invoice_items (
      invoice_id, item_type, service_id, product_id, name,
      quantity, unit_price_cents, discount_cents, is_membego_covered
    ) values (
      v_credit.id, v_item.item_type, v_item.service_id, v_item.product_id, v_item.name,
      v_line.quantity, v_item.unit_price_cents,
      round(v_item.discount_cents::numeric * v_line.quantity / v_item.quantity)::bigint,
      false
    );

    perform app.mark_item_credited(v_item.id, v_line.quantity);

    -- El inventario vuelve solo por lo acreditado.
    if v_item.item_type = 'product' and v_item.product_id is not null then
      perform set_config('app.inventory_ctx', jsonb_build_object(
        'kind', 'devolucion', 'invoice_id', v_credit.id, 'branch_id', v_original.branch_id
      )::text, true);
      update public.products
         set stock = stock + v_line.quantity
       where id = v_item.product_id and company_id = v_company;
    end if;
  end loop;

  -- --------------------------------------------------- Deuda y devolución
  if v_a_cuenta > 0 then
    perform app.apply_credit_to_receivable(v_receivable.id, v_a_cuenta);
  end if;

  if v_efectivo > 0 then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, invoice_id, created_by
    ) values (
      v_company, v_session, 'outflow', 'efectivo', v_efectivo,
      'Nota de crédito sobre ' || v_original.invoice_number
        || coalesce(' · NC ' || v_ncf, '') || ' · ' || p_reason,
      v_credit.id, auth.uid()
    );
  end if;

  -- ------------------------------------------------------ Marcar la original
  update public.invoices
     set credited_cents = credited_cents + v_total,
         -- Acreditada por completo es lo mismo que anulada, pero por suma.
         is_annulled     = (credited_cents + v_total >= total_cents),
         annulled_reason = case when credited_cents + v_total >= total_cents
                                then p_reason else annulled_reason end,
         annulled_at     = case when credited_cents + v_total >= total_cents
                                then now() else annulled_at end,
         annulled_by     = case when credited_cents + v_total >= total_cents
                                then auth.uid() else annulled_by end,
         credit_note_id  = v_credit.id
   where id = v_original.id;

  get diagnostics v_rows = row_count;
  -- RLS filtra en silencio: sin esto, un rol sin permiso vería la nota emitida
  -- y la factura original intacta.
  if v_rows = 0 then
    raise exception 'No tiene permiso para acreditar facturas.'
      using errcode = 'insufficient_privilege';
  end if;

  -- La orden vuelve a quedar pendiente solo si se acreditó todo.
  if v_original.work_order_id is not null
     and v_original.credited_cents + v_total >= v_original.total_cents then
    update public.work_orders
       set payment_status = 'pendiente', payment_method = null
     where id = v_original.work_order_id and company_id = v_company;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, v_original.branch_id, 'NOTA_CREDITO', 'Invoice', v_original.id::text,
    format('%s acreditada en %s centavos con %s%s · Motivo: %s',
           v_original.invoice_number, v_total, v_credit.invoice_number,
           coalesce(' (NCF ' || v_ncf || ')', ''), p_reason),
    jsonb_build_object('credit_note_id', v_credit.id, 'credited_cents', v_total,
                       'a_cuenta_cents', v_a_cuenta, 'efectivo_cents', v_efectivo,
                       'total_credited_cents', v_original.credited_cents + v_total)
  );

  return v_credit;
end;
$$;
