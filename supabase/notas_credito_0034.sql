-- =============================================================================
-- PARCHE 0034 (editor SQL de Supabase) · Notas de crédito parciales
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches 0028 a 0033. Es idempotente: puedes correrlo más de una vez sin daño.
--
-- Con este quedan cubiertos los tres submódulos que decían «PRONTO»: notas de
-- crédito, fiscal y usuarios y roles. Los dos últimos no necesitaban SQL — sus
-- políticas ya existían desde 0007—, solo les faltaba pantalla.
-- =============================================================================

alter table public.invoices
  add column if not exists credited_cents bigint not null default 0;

-- Los CHECK van aparte: `add column if not exists` no los recrea si la columna
-- ya existía, y `add constraint` no admite `if not exists`.
do $do$ begin
  alter table public.invoices
    add constraint invoices_credited_non_negative check (credited_cents >= 0);
exception when duplicate_object then null; end $do$;

alter table public.invoice_items
  add column if not exists credited_quantity integer not null default 0;

do $do$ begin
  alter table public.invoice_items
    add constraint invoice_items_credited_non_negative check (credited_quantity >= 0);
exception when duplicate_object then null; end $do$;
do $do$ begin
  alter table public.invoice_items
    add constraint invoice_items_credited_within_line check (credited_quantity <= quantity);
exception when duplicate_object then null; end $do$;

comment on column public.invoices.credited_cents is
  'Acumulado de notas de crédito parciales. Al alcanzar total_cents la factura queda anulada.';


-- Solo sube el contador de lo acreditado. Es un ayudante DEFINER a propósito:
-- conceder UPDATE sobre invoice_items abriría la puerta a editar el precio de
-- una factura ya emitida, que es justo lo que el esquema evita.
create or replace function app.mark_item_credited(p_item_id uuid, p_quantity integer)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.invoice_items
     set credited_quantity = credited_quantity + p_quantity
   where id = p_item_id;
$$;


-- receivables tampoco tiene política de UPDATE —sus saldos se mueven solo por
-- RPC (0028)—, así que la lectura con bloqueo y el descuento del saldo pasan
-- por ayudantes DEFINER. La serialización real la da el bloqueo de la factura.
create or replace function app.receivable_pending_for_invoice(p_invoice_id uuid)
returns public.receivables
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.receivables
  where invoice_id = p_invoice_id and status = 'pendiente';
$$;

create or replace function app.apply_credit_to_receivable(
  p_receivable_id uuid,
  p_amount        bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.receivables;
begin
  select * into v_r from public.receivables where id = p_receivable_id for update;
  if v_r.id is null then
    return;
  end if;

  -- total_cents tiene CHECK > 0: si el crédito se lo come entero, la cuenta se
  -- anula en vez de dejarla en cero.
  if v_r.total_cents - p_amount <= 0 then
    update public.receivables set status = 'anulada' where id = p_receivable_id;
  else
    update public.receivables
       set total_cents = total_cents - p_amount,
           status = case when total_cents - p_amount <= paid_cents
                         then 'pagada' else 'pendiente' end
     where id = p_receivable_id;
  end if;
end;
$$;

-- =============================================================================
-- public.credit_note_invoice · acredita cantidades de líneas concretas
-- =============================================================================
-- p_lines: [{ invoice_item_id, quantity }]
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

  select tax_rate_bps into v_rate_bps from public.companies where id = v_company;
  v_neto  := greatest(0, v_subtotal - v_descuento);
  v_tax   := round(v_neto::numeric * v_rate_bps / 10000)::bigint;
  v_total := v_neto + v_tax;

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

grant execute on function public.credit_note_invoice(uuid, jsonb, text, text) to authenticated;

comment on function public.credit_note_invoice is
  'Nota de crédito PARCIAL: acredita cantidades de líneas concretas. Devuelve inventario, '
  'baja la cuenta por cobrar antes que la caja, y anula la factura al acumular su total. '
  'Idempotente por client_request_id.';

-- =============================================================================
-- public.reset_employee_password · para quien olvidó su clave
-- =============================================================================
-- Mismo techo de rol que el alta: un administrador no le cambia la clave al
-- propietario, y nadie se la cambia a sí mismo por esta vía (para eso está el
-- cambio de contraseña normal de la sesión).
create or replace function public.reset_employee_password(
  p_profile_id uuid,
  p_password   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company     uuid := app.current_company_id();
  v_caller_role app.user_role := app.current_role();
  v_profile     public.profiles;
begin
  if v_company is null
     or v_caller_role not in ('propietario', 'administrador', 'superadmin') then
    raise exception 'Su rol no permite reiniciar contraseñas.' using errcode = 'insufficient_privilege';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres.' using errcode = 'check_violation';
  end if;

  select * into v_profile from public.profiles
  where id = p_profile_id and company_id = v_company;
  if v_profile.id is null then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_profile.role in ('propietario', 'superadmin')
     and v_caller_role not in ('propietario', 'superadmin') then
    raise exception 'No puede reiniciar la contraseña de un %.', v_profile.role
      using errcode = 'insufficient_privilege';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   where id = p_profile_id;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_profile.branch_id, 'REINICIAR_CLAVE', 'Profile', p_profile_id::text,
          v_profile.full_name);
end;
$$;

grant execute on function public.reset_employee_password(uuid, text) to authenticated;

comment on function public.reset_employee_password is
  'Reinicia la contraseña de acceso de un empleado. Mismo techo de rol que el alta.';
