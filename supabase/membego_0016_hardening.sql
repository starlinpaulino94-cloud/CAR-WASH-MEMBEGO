-- =============================================================================
-- 0016 · Endurecimiento de la ingestión de Membego (arreglo del 500)
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL de Supabase (Production).
-- Es idempotente: puedes correrlo varias veces sin daño.
--
-- Qué arregla:
--   1. Garantiza que exista `membego_sync_logs` (la bitácora). Si al aplicar los
--      parches por partes esta tabla quedó fuera, cada evento bien enrutado
--      lanzaba al escribir la bitácora.
--   2. Reinstala `membego_ingest_event` endurecida, siguiendo la regla de Membego:
--        · empresa desconocida / tipo desconocido / duplicado  → 2xx (se ignora)
--        · error PERMANENTE de esquema (tabla/columna/constraint) → 2xx con detalle
--        · solo lo posiblemente TRANSITORIO (deadlock, conexión) → se propaga (5xx)
--      La escritura de bitácora es best-effort: nunca revierte el efecto real.
-- =============================================================================

-- 1) Bitácora de integración: crear si falta (columnas que usa la función).
create table if not exists public.membego_sync_logs (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies(id) on delete cascade,
  branch_id        uuid references public.branches(id) on delete set null,
  action           text not null,
  idempotency_key  text,
  status           text not null check (status in ('success','failed','retry_pending')),
  request_payload  jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message    text,
  actor_id         uuid references public.profiles(id) on delete set null,
  occurred_at      timestamptz not null default now()
);

alter table public.membego_sync_logs enable row level security;
alter table public.membego_sync_logs force  row level security;

-- 2) Función de ingestión endurecida.
create or replace function public.membego_ingest_event(
  p_event_id           text,
  p_tipo               text,
  p_membego_company_id text,
  p_payload            jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company    uuid := app.membego_company(p_membego_company_id);
  v_cliente    text := p_payload ->> 'clienteId';
  v_nombre     text := coalesce(nullif(trim(p_payload #>> '{cliente,nombre}'), ''), 'Cliente Membego');
  v_phone      text := coalesce(p_payload #>> '{cliente,telefono}', p_payload #>> '{cliente,phone}');
  v_plan       text := p_payload #>> '{membresia,plan}';
  v_compratipo text := lower(coalesce(p_payload #>> '{compra,tipo}', ''));
  v_is_paid    boolean := v_compratipo in ('pago', 'paid', 'membresia', 'membresía');
  v_monto      numeric := nullif(p_payload #>> '{compra,monto}', '')::numeric;
  v_value      bigint := coalesce(round(v_monto * 100), 0);
  v_customer   uuid;
  v_new        integer;
begin
  if v_company is null then
    return jsonb_build_object('handled', false, 'reason', 'unknown_company');
  end if;

  -- Idempotencia por event_id.
  insert into public.membego_webhook_events (event_id, company_id, tipo)
  values (p_event_id, v_company, p_tipo)
  on conflict (event_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return jsonb_build_object('handled', false, 'reason', 'duplicate');
  end if;

  -- Cliente: crear/enlazar en ESTA empresa.
  if v_cliente is not null then
    insert into public.customers (company_id, name, phone, membego_customer_id, membego_status)
    values (v_company, v_nombre, v_phone, v_cliente, 'active')
    on conflict (company_id, membego_customer_id) where membego_customer_id is not null
      do update set
        name           = coalesce(nullif(trim(excluded.name), 'Cliente Membego'), public.customers.name),
        phone          = coalesce(excluded.phone, public.customers.phone),
        membego_status = 'active',
        updated_at     = now()
    returning id into v_customer;
  end if;

  -- Membresía.
  if v_customer is not null and (p_tipo = 'membresia.activada'
       or (p_tipo in ('cliente.compro_servicio', 'cliente.primera_compra') and v_plan is not null)) then
    insert into public.memberships
      (company_id, customer_id, membego_membership_id, plan_name, status, is_paid, raw)
    values
      (v_company, v_customer,
       coalesce(p_payload #>> '{membresia,id}', 'plan:' || coalesce(v_plan, '') || ':' || v_cliente),
       coalesce(v_plan, ''), 'active', v_is_paid, p_payload)
    on conflict (company_id, membego_membership_id) do update
      set plan_name = excluded.plan_name, status = 'active',
          is_paid = excluded.is_paid, raw = excluded.raw, updated_at = now();

  -- Compra de oferta → promoción.
  elsif v_customer is not null and p_tipo in ('cliente.compro_servicio', 'cliente.primera_compra') then
    insert into public.customer_promotions
      (company_id, customer_id, membego_promotion_id, title, kind, value_cents, raw)
    values
      (v_company, v_customer,
       coalesce(p_payload #>> '{oferta,id}', p_payload #>> '{compra,id}', p_event_id),
       coalesce(nullif(p_payload #>> '{oferta,titulo}', ''), 'Compra Membego'),
       case when v_is_paid then 'paid' else 'free' end, v_value, p_payload)
    on conflict (company_id, membego_promotion_id) do update
      set title = excluded.title, value_cents = excluded.value_cents, raw = excluded.raw, updated_at = now();
  end if;

  -- Bitácora best-effort: su fallo NO revierte lo anterior.
  begin
    insert into public.membego_sync_logs (company_id, action, idempotency_key, status, request_payload)
    values (v_company, p_tipo, p_event_id, 'success', p_payload);
  exception when others then
    null;
  end;

  return jsonb_build_object('handled', true, 'company_id', v_company, 'customer_id', v_customer, 'tipo', p_tipo);

exception
  when unique_violation
    or check_violation
    or not_null_violation
    or foreign_key_violation
    or invalid_text_representation
    or undefined_table
    or undefined_column
    or undefined_function
    or undefined_object then
    return jsonb_build_object(
      'handled', false, 'reason', 'error_permanente',
      'sqlstate', sqlstate, 'detail', left(sqlerrm, 200));
end;
$$;

grant execute on function public.membego_ingest_event(text, text, text, jsonb) to service_role;

-- =============================================================================
-- 3) DIAGNÓSTICO (opcional): prueba la función directo, sin pasar por el webhook.
--    Reemplaza el companyId por el de CARTOWN si quieres. Debe devolver un jsonb
--    con handled=true (o unknown_company si aún no está vinculada), NUNCA lanzar.
-- =============================================================================
-- select public.membego_ingest_event(
--   'diag-0001',
--   'cliente.registrado',
--   'cmre1hz570000jp04ad5i0roi',
--   '{"clienteId":"diag-c1","cliente":{"nombre":"Cliente Diagnóstico","telefono":"809-000-0000"}}'::jsonb
-- );
--
-- ¿Está la empresa vinculada?  ->
-- select * from public.membego_company_links;
