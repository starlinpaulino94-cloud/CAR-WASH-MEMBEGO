-- =============================================================================
-- El canje de Membego no lo podía anotar quien lo hace: el cajero.
--
-- `record_membego_redemption` y `record_membego_reversal` eran `security
-- invoker` «para que la RLS siga aplicando y no haga falta service_role». La
-- intención era buena y el resultado, falso: la ÚNICA política de UPDATE sobre
-- `invoices` es `invoices_annul`, que exige propietario, administrador,
-- supervisor o superadmin. Un cajero —el que cobra— no puede actualizar una
-- factura, así que:
--
--   · El canje actualizaba CERO filas y después reventaba al escribir en la
--     bitácora con un «null value in column details», un error que no nombra
--     nada de lo que de verdad pasaba. El lavado salía gratis en la factura y a
--     la membresía del cliente no se le descontaba nunca.
--
--   · La reversión era peor: al no actualizar nada caía en la rama «o no existe
--     o ya estaba revertida», releía la factura y la devolvía TAL CUAL, como si
--     la hubiera revertido. Contestaba que sí a algo que no había hecho.
--
-- Ninguna prueba lo cubría: todas las de facturación pasaban
-- `is_membego_covered` en falso, así que el camino entero de la integración
-- —el motivo por el que existe— no se ejecutaba nunca aquí.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ `security definer` Y NO UNA POLÍTICA NUEVA
--
-- Abrir un UPDATE a los roles de mostrador les dejaría tocar CUALQUIER columna
-- de cualquier factura de su empresa: la RLS acota filas, no columnas, y el
-- `grant` de UPDATE ya es de tabla entera. Estas dos funciones son la vía
-- estrecha y auditable —tocan solo las columnas `membego_*`, son idempotentes y
-- dejan constancia— así que el privilegio vive aquí dentro y no fuera.
--
-- A cambio, lo que la RLS dejaba de hacer se hace a mano y explícito: se exige
-- empresa Y rol de mostrador. Sin eso, `security definer` sería un agujero.
-- =============================================================================

create or replace function public.record_membego_redemption(
  p_invoice_id     uuid,
  p_visit_id       text,
  p_membership_id  text,
  p_covered_cents  bigint default 0,
  p_error          text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_factura public.invoices;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;
  -- El candado que sustituye a la RLS. `operario` no cobra, así que no anota.
  if not app.has_role('cajero', 'supervisor', 'administrador', 'propietario', 'superadmin') then
    raise exception 'Su rol no puede anotar canjes de Membego'
      using errcode = 'insufficient_privilege';
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
     where id = p_invoice_id and company_id = v_company
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
     where id = p_invoice_id and company_id = v_company
    returning * into v_factura;
  end if;

  -- Si por lo que sea no se escribió, se dice AQUÍ y con su nombre. Antes esto
  -- seguía adelante y estallaba tres líneas más abajo por un `details` nulo,
  -- mandando a investigar la bitácora en vez del permiso.
  if v_factura.id is null then
    raise exception 'No se pudo anotar el canje en la factura'
      using errcode = 'no_data_found';
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_factura.branch_id,
          case when p_error is null then 'MEMBEGO_CANJEADO' else 'MEMBEGO_CANJE_FALLIDO' end,
          'Invoice', p_invoice_id::text,
          -- `coalesce` en el exterior: una sola pieza nula hacía nulo el
          -- concatenado entero y tumbaba la escritura.
          coalesce(p_error,
                   'Visita ' || coalesce(p_visit_id, '?') || ' · ' ||
                   coalesce((v_factura.membego_covered_cents / 100.0)::text, '0'),
                   'Canje de Membego'));

  return v_factura;
end;
$$;

create or replace function public.record_membego_reversal(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_factura public.invoices;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_role('cajero', 'supervisor', 'administrador', 'propietario', 'superadmin') then
    raise exception 'Su rol no puede revertir canjes de Membego'
      using errcode = 'insufficient_privilege';
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
    --
    -- Esta rama era además la que tapaba el fallo de permisos: cuando la RLS
    -- bloqueaba el UPDATE se llegaba aquí, se releía la factura y se devolvía
    -- como si estuviera revertida. Decir que sí a algo que no se hizo es la
    -- peor forma de fallar, y por eso ahora solo se acepta si el estado que hay
    -- escrito es de verdad «revertido».
    select * into v_factura from public.invoices
     where id = p_invoice_id and company_id = v_company;
    if v_factura.id is null then
      raise exception 'Factura no encontrada' using errcode = 'no_data_found';
    end if;
    if v_factura.membego_canje_estado <> 'revertido' then
      raise exception 'No se pudo revertir el canje en la factura'
        using errcode = 'no_data_found';
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
