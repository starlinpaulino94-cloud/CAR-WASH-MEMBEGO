-- ============================================================================
-- PARCHE 0039 · el canje de Membego en la factura
--
-- Para correr suelto en el SQL Editor de Supabase. Mismo contenido de
-- supabase/migrations/20260815140000_membego_canje.sql y repetible sin daño.
-- ============================================================================
-- ============================================================================
-- 0039 · EL CANJE DE MEMBEGO EN LA FACTURA
--
-- Hasta aquí el sistema sabía que una línea estaba cubierta —`is_membego_covered`
-- ya sacaba su importe de la base imponible— pero no quedaba escrito NADA sobre
-- el canje: qué membresía lo cubrió, si Membego llegó a enterarse, y con qué
-- identificador se podría deshacer. Sin eso, anular la factura le quitaba el
-- lavado al cliente para siempre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- PRIMERO SE FACTURA, DESPUÉS SE CANJEA. Y NO AL REVÉS.
--
-- Son dos sistemas distintos y no hay transacción que abarque a los dos. Uno de
-- los dos pasos va a quedar primero, así que la pregunta real es: si el segundo
-- falla, ¿quién paga el error?
--
--   · Canjear primero — si después falla la factura, el cliente perdió un
--     lavado y no recibió comprobante. Perdió él, y no tiene cómo saberlo.
--   · Facturar primero — si después falla el canje, el cliente tiene su factura
--     con el lavado descontado y su lavado sigue en el saldo. Perdió el
--     negocio, sabe cuánto, y se puede reintentar.
--
-- Se elige el segundo. Un error que solo cuesta dinero al negocio y se puede
-- reparar es preferible a uno que se lo cobra al cliente en silencio.
--
-- Por eso `membego_canje_estado` nace en 'pendiente' y NO en 'canjeado': una
-- factura cubierta cuyo canje no se confirmó es un hecho que hay que poder ver
-- y reintentar, no un detalle que se pierde en un log.
-- ============================================================================

alter table public.invoices
  -- Qué membresía cubrió el lavado. Texto porque es un id de Membego, no
  -- nuestro: una FK a una tabla que no controlamos sería mentira.
  add column if not exists membego_membership_id text,
  -- La VISITA en Membego. Es lo que hace falta para deshacer el canje: el
  -- endpoint de reversa se identifica por la visita, no por la transacción.
  add column if not exists membego_visit_id      text,
  -- Cuánto cubrió la membresía, en centavos. Se congela aquí: recalcularlo
  -- después con la tarifa de hoy reescribiría lo que se cobró ayer.
  add column if not exists membego_covered_cents bigint not null default 0,
  add column if not exists membego_canje_estado  text not null default 'sin_beneficio',
  add column if not exists membego_canje_error   text,
  add column if not exists membego_canjeado_at   timestamptz,
  add column if not exists membego_revertido_at  timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_membego_canje_estado_check'
  ) then
    alter table public.invoices add constraint invoices_membego_canje_estado_check
      check (membego_canje_estado in
        ('sin_beneficio', 'pendiente', 'canjeado', 'fallido', 'revertido'));
  end if;
end $$;

comment on column public.invoices.membego_canje_estado is
  'sin_beneficio · pendiente (facturado, falta avisar a Membego) · canjeado · fallido (Membego lo rechazó) · revertido.';
comment on column public.invoices.membego_visit_id is
  'Visita en Membego. Es el identificador con el que se deshace el canje.';

-- Índice PARCIAL: las facturas con canje pendiente o fallido tienen que poder
-- encontrarse en un segundo para reintentarlas, y son una minoría diminuta
-- frente a todas las facturas emitidas.
create index if not exists invoices_membego_por_resolver_idx
  on public.invoices (company_id, created_at)
  where membego_canje_estado in ('pendiente', 'fallido');

-- ────────────────────────────────────────────────────────────────────────────
-- Anotar lo que dijo Membego.
--
-- Lo llama NUESTRO borde de servidor después de hablar con Membego, con el
-- token del propio cajero: RLS sigue aplicando y no hace falta service_role.
--
-- Es idempotente por diseño: reintentar con el mismo `p_visit_id` no cambia
-- nada. Un reintento tras un timeout es lo normal aquí, no la excepción.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.record_membego_redemption(
  p_invoice_id     uuid,
  p_visit_id       text,
  p_membership_id  text,
  p_covered_cents  bigint default 0,
  p_error          text default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_factura public.invoices;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  select * into v_factura from public.invoices
   where id = p_invoice_id and company_id = v_company;
  if v_factura.id is null then
    raise exception 'Factura no encontrada' using errcode = 'no_data_found';
  end if;

  -- Ya revertida: no se vuelve a marcar como canjeada. Sin este guard, un
  -- reintento tardío del canje resucitaría un beneficio que ya se devolvió.
  if v_factura.membego_canje_estado = 'revertido' then
    return v_factura;
  end if;

  if p_error is not null then
    update public.invoices
       set membego_canje_estado = 'fallido',
           membego_canje_error  = left(p_error, 500),
           membego_membership_id = coalesce(p_membership_id, membego_membership_id)
     where id = p_invoice_id
    returning * into v_factura;
  else
    if p_visit_id is null or length(trim(p_visit_id)) = 0 then
      raise exception 'Un canje confirmado necesita el identificador de la visita'
        using errcode = 'invalid_parameter_value';
    end if;
    update public.invoices
       set membego_canje_estado  = 'canjeado',
           membego_visit_id      = p_visit_id,
           membego_membership_id = coalesce(p_membership_id, membego_membership_id),
           membego_covered_cents = greatest(0, coalesce(p_covered_cents, 0)),
           membego_canje_error   = null,
           membego_canjeado_at   = coalesce(membego_canjeado_at, now())
     where id = p_invoice_id
    returning * into v_factura;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_factura.branch_id,
          case when p_error is null then 'MEMBEGO_CANJEADO' else 'MEMBEGO_CANJE_FALLIDO' end,
          'Invoice', p_invoice_id::text,
          coalesce(p_error, 'Visita ' || coalesce(p_visit_id, '?') ||
                   ' · ' || (v_factura.membego_covered_cents / 100.0)::text));

  return v_factura;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Anotar que el beneficio se devolvió.
--
-- Se llama después de que Membego confirme la reversa. Igual que arriba: dos
-- llamadas dejan el mismo resultado.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.record_membego_reversal(p_invoice_id uuid)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_factura public.invoices;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  update public.invoices
     set membego_canje_estado = 'revertido',
         membego_revertido_at = coalesce(membego_revertido_at, now())
   where id = p_invoice_id and company_id = v_company
     and membego_canje_estado in ('canjeado', 'pendiente', 'fallido')
  returning * into v_factura;

  if v_factura.id is null then
    -- O no existe, o ya estaba revertida. Lo segundo no es un error: es la
    -- respuesta correcta a «asegúrate de que esto está revertido».
    select * into v_factura from public.invoices
     where id = p_invoice_id and company_id = v_company;
    if v_factura.id is null then
      raise exception 'Factura no encontrada' using errcode = 'no_data_found';
    end if;
    return v_factura;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_factura.branch_id, 'MEMBEGO_REVERTIDO', 'Invoice', p_invoice_id::text,
          'Se devolvió el beneficio de la visita ' || coalesce(v_factura.membego_visit_id, '?'));

  return v_factura;
end;
$$;

revoke all on function public.record_membego_redemption(uuid, text, text, bigint, text) from public;
revoke all on function public.record_membego_reversal(uuid) from public;
grant execute on function public.record_membego_redemption(uuid, text, text, bigint, text) to authenticated;
grant execute on function public.record_membego_reversal(uuid) to authenticated;

comment on function public.record_membego_redemption is
  'Anota el resultado del canje en Membego. Idempotente; nunca resucita un canje ya revertido.';
comment on function public.record_membego_reversal is
  'Anota que el beneficio se devolvió al cliente. Idempotente.';
