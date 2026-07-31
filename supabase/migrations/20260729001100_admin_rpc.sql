-- =============================================================================
-- 0011 · Gastos, métricas y bitácora de integración
-- =============================================================================
-- Últimas piezas de servidor que faltaban para migrar el resto de vistas.
--
--   §4.1  Registrar un gasto tocaba el gasto Y la caja sin atomicidad.
--   M8/M11 Los indicadores "de hoy" sumaban TODO el histórico sin filtro de
--         fecha, y se calculaban recorriendo arrays completos en el navegador.
--   §7.6  La bitácora de sincronización con Membego vivía en memoria y se
--         perdía al refrescar, igual que la de auditoría.
-- =============================================================================

-- ---------------------------------------------------------------- Gastos

alter table public.expenses add column client_request_id text;

create unique index expenses_idempotency_unique
  on public.expenses (company_id, client_request_id)
  where client_request_id is not null;

/**
 * Registra un gasto y, si se paga en efectivo, su salida de caja: o las dos
 * cosas o ninguna.
 */
create or replace function public.create_expense(
  p_branch_id         uuid,
  p_client_request_id text,
  p_description       text,
  p_amount_cents      bigint,
  p_category          app.expense_category default 'varios',
  p_payment_method    app.payment_method default 'efectivo',
  p_supplier_name     text default null,
  p_invoice_ref       text default null,
  p_expense_date      date default null,
  p_cash_session_id   uuid default null
)
returns public.expenses
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_existing public.expenses;
  v_expense  public.expenses;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia' using errcode = 'invalid_parameter_value';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'El importe del gasto debe ser mayor que cero'
      using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();

  select * into v_existing from public.expenses
  where company_id = v_company and client_request_id = p_client_request_id;
  if v_existing.id is not null then
    return v_existing;
  end if;

  -- Un gasto en efectivo sin caja abierta no puede registrarse: saldría dinero
  -- de una gaveta que nadie está cuadrando.
  if p_payment_method = 'efectivo' then
    if p_cash_session_id is null
       or not exists (select 1 from public.cash_sessions
                      where id = p_cash_session_id and status = 'open') then
      raise exception 'Un gasto en efectivo exige una caja abierta'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  insert into public.expenses (
    company_id, branch_id, client_request_id, category, description, amount_cents,
    payment_method, supplier_name, invoice_ref, cash_session_id, expense_date, created_by
  ) values (
    v_company, p_branch_id, p_client_request_id, p_category, p_description, p_amount_cents,
    p_payment_method, p_supplier_name, p_invoice_ref, p_cash_session_id,
    coalesce(p_expense_date, current_date), auth.uid()
  )
  returning * into v_expense;

  if p_payment_method = 'efectivo' then
    insert into public.cash_movements (
      company_id, cash_session_id, type, method, amount_cents, reason, expense_id, created_by
    ) values (
      v_company, p_cash_session_id, 'outflow', 'efectivo', p_amount_cents,
      'Gasto: ' || p_description, v_expense.id, auth.uid()
    );
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'REGISTRAR_GASTO', 'Expense', v_expense.id::text,
          p_description || ' · ' || p_amount_cents || ' centavos (' || p_payment_method || ')');

  return v_expense;
end;
$$;

-- --------------------------------------------------------------- Métricas

/**
 * Indicadores operativos de un periodo, calculados por el servidor.
 *
 * El panel auditado sumaba TODAS las facturas del histórico bajo el rótulo
 * "Ventas de hoy" y recorría los arrays completos en cada render. Aquí el
 * navegador recibe seis números y el rango de fechas es explícito.
 */
create or replace function public.dashboard_metrics(
  p_branch_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with orders as (
    select * from public.work_orders
    where branch_id = p_branch_id and arrival_at >= p_from and arrival_at < p_to
  ),
  billed as (
    select * from public.invoices
    where branch_id = p_branch_id and created_at >= p_from and created_at < p_to
      and not is_annulled and credits_invoice_id is null
  ),
  queue as (
    select * from public.work_orders
    where branch_id = p_branch_id
      and status not in ('entregado', 'cancelado')
  )
  select jsonb_build_object(
    -- La cola es un estado del ahora, no del periodo: no lleva filtro de fecha.
    'in_queue',        (select count(*) from queue where status in ('pendiente','en_espera','asignada')),
    'in_process',      (select count(*) from queue where status in ('en_proceso','control_calidad')),
    'ready',           (select count(*) from queue where status = 'listo'),
    'arrived',         (select count(*) from orders),
    'delivered',       (select count(*) from orders where status = 'entregado'),
    'membego_orders',  (select count(*) from orders where membego_benefit_id is not null),
    'sales_cents',     (select coalesce(sum(total_cents), 0) from billed),
    'invoice_count',   (select count(*) from billed),
    'avg_ticket_cents',(select case when count(*) = 0 then 0
                          else round(sum(total_cents)::numeric / count(*))::bigint end from billed),
    'annulled_cents',  (select coalesce(sum(total_cents), 0) from public.invoices
                         where branch_id = p_branch_id and created_at >= p_from and created_at < p_to
                           and is_annulled)
  );
$$;

-- ------------------------------------------------- Bitácora de integración

create table public.membego_sync_logs (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  action         text not null,
  idempotency_key text,
  status         text not null check (status in ('success','failed','retry_pending')),
  request_payload  jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message  text,
  actor_id       uuid references public.profiles(id) on delete set null,
  occurred_at    timestamptz not null default now()
);

create index membego_sync_logs_company_time_idx
  on public.membego_sync_logs (company_id, occurred_at desc);

alter table public.membego_sync_logs enable row level security;
alter table public.membego_sync_logs force row level security;

create policy membego_sync_logs_select on public.membego_sync_logs
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy membego_sync_logs_insert on public.membego_sync_logs
  for insert to authenticated with check (app.belongs_to_tenant(company_id));

-- Igual que la auditoría: solo se inserta. Un registro de integración que se
-- puede reescribir no sirve para diagnosticar nada.
revoke update, delete on public.membego_sync_logs from authenticated;

create trigger membego_sync_logs_no_mutation
  before update or delete on public.membego_sync_logs
  for each row execute function app.forbid_audit_mutation();

create or replace function app.stamp_membego_actor()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  new.actor_id   := auth.uid();
  new.occurred_at := now();
  new.company_id := coalesce(app.current_company_id(), new.company_id);
  return new;
end;
$$;

create trigger membego_sync_logs_stamp
  before insert on public.membego_sync_logs
  for each row execute function app.stamp_membego_actor();

grant execute on function public.create_expense     to authenticated;
grant execute on function public.dashboard_metrics  to authenticated;
