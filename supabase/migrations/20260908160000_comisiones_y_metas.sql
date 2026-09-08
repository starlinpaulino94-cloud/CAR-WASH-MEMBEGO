-- ============================================================================
-- COMISIONES POR MONTO FIJO + METAS DEL LAVADOR
-- ============================================================================
-- Hasta aquí la comisión solo podía ser un PORCENTAJE. Un lavadero que paga
-- «RD$100 por lavado» —que es como se paga en la calle— no tenía cómo
-- expresarlo, y acababa calculando a mano un porcentaje aproximado que se
-- desajusta con cada cambio de tarifa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR LAVADOR, CON EL SERVICIO DE RESPALDO
--
-- La regla la manda el lavador: si él tiene tarifa, esa vale. Si no tiene, se
-- usa la del servicio. Es la precedencia que ya existía con los porcentajes,
-- ampliada a los montos fijos, para no cambiar lo que el negocio ya entendía.
--
-- ────────────────────────────────────────────────────────────────────────────
-- «POR LAVADO» ES POR CARRO, NO POR LÍNEA
--
-- El matiz que decide si el negocio paga de más. Una orden puede llevar
-- «Lavado por fuera» + «Aspirado»: si el monto fijo del LAVADOR se cobrara por
-- línea, ese carro pagaría dos veces la tarifa del lavador. Su tarifa es por el
-- carro que lavó, así que genera UNA comisión por orden.
--
-- El monto fijo del SERVICIO sí es por línea: ahí lo que se está diciendo es
-- «este servicio concreto paga tanto», y dos servicios distintos son dos
-- trabajos distintos.
--
-- En los dos casos, cuando varios lavadores comparten el carro el importe SE
-- REPARTE entre ellos, igual que ya se repartía la base del porcentaje. Si no,
-- asignar a dos personas duplicaría el costo del mismo lavado.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'app' and t.typname = 'commission_kind') then
    create type app.commission_kind as enum ('porcentaje', 'monto');
  end if;
end $$;

alter table public.profiles
  add column if not exists commission_kind app.commission_kind not null default 'porcentaje',
  add column if not exists commission_amount_cents bigint not null default 0;

alter table public.services
  add column if not exists commission_kind app.commission_kind not null default 'porcentaje',
  add column if not exists commission_amount_cents bigint not null default 0;

comment on column public.profiles.commission_amount_cents is
  'Monto fijo por LAVADO (no por línea) cuando commission_kind = monto. Se '
  'reparte entre los lavadores que compartan la orden.';
comment on column public.services.commission_amount_cents is
  'Monto fijo por ESTA línea de servicio cuando commission_kind = monto. '
  'Respaldo para los lavadores que no tienen tarifa propia.';

-- La comisión sigue sin poder editarse a mano: se amplía la guarda existente a
-- los dos campos nuevos, o se podría subir la tarifa con un UPDATE suelto.
create or replace function app.profiles_pay_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.payroll_type            is distinct from old.payroll_type
   or new.base_salary_cents       is distinct from old.base_salary_cents
   or new.hourly_rate_cents       is distinct from old.hourly_rate_cents
   or new.commission_bps          is distinct from old.commission_bps
   or new.commission_kind         is distinct from old.commission_kind
   or new.commission_amount_cents is distinct from old.commission_amount_cents)
     and coalesce(current_setting('app.payroll_ctx', true), '') <> 'ok' then
    raise exception
      'El sueldo y la comisión no se editan directamente. Use set_employee_pay().'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- La comisión guarda CÓMO se calculó, no solo cuánto. Sin esto, una fila de
-- RD$100 no distingue «su tarifa fija» de «el 10 % de un lavado de 1.000», y
-- al revisar una quincena vieja no hay forma de reconstruir el criterio.
alter table public.commissions
  add column if not exists commission_kind app.commission_kind not null default 'porcentaje',
  add column if not exists rate_amount_cents bigint not null default 0;

comment on column public.commissions.rate_amount_cents is
  'La tarifa fija que se aplicó (0 en las de porcentaje). Congelada: cambiar la '
  'tarifa del lavador no puede reescribir lo que ya se le liquidó.';

-- ============================================================================
-- set_employee_pay · ahora también fija el TIPO y el monto
-- ============================================================================
drop function if exists public.set_employee_pay(uuid, app.payroll_type, bigint, bigint, integer);

create or replace function public.set_employee_pay(
  p_profile_id              uuid,
  p_payroll_type            app.payroll_type,
  p_base_salary_cents       bigint  default 0,
  p_hourly_rate_cents       bigint  default 0,
  p_commission_bps          integer default null,
  p_commission_kind         app.commission_kind default 'porcentaje',
  p_commission_amount_cents bigint  default 0
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_profile public.profiles;
begin
  -- Los guardas del original se conservan TAL CUAL —incluido el rol contador y
  -- las dos validaciones de tipo de pago—: esta función solo AÑADE el tipo de
  -- comisión y su monto. Reescribirla y perder un guarda por el camino sería
  -- abrir un agujero en la ruta del dinero sin que nadie lo note.
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'contador', 'superadmin') then
    raise exception 'Su rol no permite fijar sueldos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_base_salary_cents, 0) < 0 or coalesce(p_hourly_rate_cents, 0) < 0 then
    raise exception 'El importe no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if p_commission_bps is not null and (p_commission_bps < 0 or p_commission_bps > 10000) then
    raise exception 'La comisión debe estar entre 0 y 10000 puntos base.'
      using errcode = 'check_violation';
  end if;
  if p_payroll_type = 'mensual' and coalesce(p_base_salary_cents, 0) = 0 then
    raise exception 'Un sueldo mensual necesita importe.' using errcode = 'check_violation';
  end if;
  if p_payroll_type = 'por_hora' and coalesce(p_hourly_rate_cents, 0) = 0 then
    raise exception 'El pago por hora necesita tarifa.' using errcode = 'check_violation';
  end if;
  -- Lo nuevo: el monto fijo tampoco puede ser negativo, y si se elige pagar por
  -- monto hay que decir cuánto.
  if coalesce(p_commission_amount_cents, 0) < 0 then
    raise exception 'El importe no puede ser negativo.' using errcode = 'check_violation';
  end if;
  if p_commission_kind = 'monto' and coalesce(p_commission_amount_cents, 0) = 0 then
    raise exception 'Una comisión por monto necesita el importe por lavado.'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.payroll_ctx', 'ok', true);
  update public.profiles
     set payroll_type            = p_payroll_type,
         base_salary_cents       = coalesce(p_base_salary_cents, 0),
         hourly_rate_cents       = coalesce(p_hourly_rate_cents, 0),
         commission_bps          = coalesce(p_commission_bps, commission_bps),
         commission_kind         = p_commission_kind,
         commission_amount_cents = coalesce(p_commission_amount_cents, 0)
   where id = p_profile_id and company_id = v_company
  returning * into v_profile;
  perform set_config('app.payroll_ctx', '', true);

  if v_profile.id is null then
    raise exception 'Empleado inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_logs (company_id, action, entity, entity_id, details)
  values (v_company, 'FIJAR_PAGO_EMPLEADO', 'Profile', p_profile_id::text,
          v_profile.full_name || ': comisión ' ||
          case when p_commission_kind = 'monto'
               then 'RD$' || (coalesce(p_commission_amount_cents,0) / 100.0)::text || ' por lavado'
               else (coalesce(p_commission_bps, 0) / 100.0)::text || ' %' end);

  return v_profile;
end;
$$;

grant execute on function public.set_employee_pay(
  uuid, app.payroll_type, bigint, bigint, integer, app.commission_kind, bigint
) to authenticated;

-- ============================================================================
-- METAS DEL LAVADOR (quincena o mes)
-- ============================================================================
-- El periodo son dos fechas y no un enum «quincena|mes»: una quincena que
-- empieza el 16 y un mes natural son el mismo hecho —un rango— y con fechas se
-- puede además poner una meta de una semana o de una campaña concreta sin
-- tocar el esquema.
create table if not exists public.washer_goals (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  period_from          date not null,
  period_to            date not null,
  -- Meta de lavados entregados. NULL = no se le puso esta meta.
  target_washes        integer,
  -- Meta de lo que el NEGOCIO factura por sus lavados. NULL = sin meta.
  target_revenue_cents bigint,
  notes                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint washer_goals_periodo_valido check (period_to >= period_from),
  constraint washer_goals_metas_positivas check (
    coalesce(target_washes, 0) >= 0 and coalesce(target_revenue_cents, 0) >= 0
  ),
  -- Una meta por lavador y periodo: dos metas del mismo mes se contradirían y
  -- nadie sabría cuál es la buena.
  constraint washer_goals_unica unique (company_id, profile_id, period_from, period_to)
);

create index if not exists washer_goals_company_periodo_idx
  on public.washer_goals (company_id, period_from, period_to);

alter table public.washer_goals enable row level security;
alter table public.washer_goals force  row level security;

-- Ver: cualquiera de la empresa (un lavador tiene que poder ver su meta).
drop policy if exists washer_goals_select on public.washer_goals;
create policy washer_goals_select on public.washer_goals
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Escribir: solo quien manda. La meta decide el bono de alguien.
drop policy if exists washer_goals_write on public.washer_goals;
create policy washer_goals_write on public.washer_goals
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin'));

grant select, insert, update, delete on public.washer_goals to authenticated;

create or replace function public.upsert_washer_goal(
  p_profile_id           uuid,
  p_period_from          date,
  p_period_to            date,
  p_target_washes        integer default null,
  p_target_revenue_cents bigint  default null,
  p_notes                text    default null
)
returns public.washer_goals
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_goal    public.washer_goals;
begin
  if v_company is null then
    raise exception 'No perteneces a ninguna empresa.' using errcode = 'check_violation';
  end if;
  if p_period_to < p_period_from then
    raise exception 'El periodo termina antes de empezar.' using errcode = 'check_violation';
  end if;
  -- Una meta sin número no es una meta.
  if coalesce(p_target_washes, 0) <= 0 and coalesce(p_target_revenue_cents, 0) <= 0 then
    raise exception 'Ponga al menos una meta: lavados o dinero generado.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles
                 where id = p_profile_id and company_id = v_company and is_active) then
    raise exception 'El empleado no existe, no está activo o no es de su empresa.'
      using errcode = 'check_violation';
  end if;

  insert into public.washer_goals (
    company_id, profile_id, period_from, period_to,
    target_washes, target_revenue_cents, notes, created_by
  ) values (
    v_company, p_profile_id, p_period_from, p_period_to,
    nullif(coalesce(p_target_washes, 0), 0),
    nullif(coalesce(p_target_revenue_cents, 0), 0),
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  )
  on conflict (company_id, profile_id, period_from, period_to) do update set
    target_washes        = excluded.target_washes,
    target_revenue_cents = excluded.target_revenue_cents,
    notes                = excluded.notes,
    updated_at           = now()
  returning * into v_goal;

  -- RLS filtra en silencio: sin filas, el UPDATE fue denegado.
  if v_goal.id is null then
    raise exception 'No tiene permiso para fijar metas.' using errcode = 'insufficient_privilege';
  end if;
  return v_goal;
end;
$$;

grant execute on function public.upsert_washer_goal(uuid, date, date, integer, bigint, text)
  to authenticated;

comment on function public.upsert_washer_goal is
  'Fija (o corrige) la meta de un lavador para un periodo. Una sola por lavador '
  'y periodo: dos metas del mismo mes se contradirían.';

-- ============================================================================
-- advance_work_order · la comisión ahora entiende montos fijos
-- ============================================================================
-- Se redefine ENTERA (no se puede parchear el cuerpo de una función) pero lo
-- único que cambia es el bloque de comisiones; el resto —bahías, transiciones,
-- recetas, auditoría— es idéntico al de la migración 0021.
-- ============================================================================
create or replace function public.advance_work_order(
  p_order_id     uuid,
  p_new_status   app.order_status,
  p_bay_id       uuid   default null,
  p_assignees    uuid[] default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_order    public.work_orders;
  v_bay      public.bays;
  v_result   public.work_orders;
  v_rows     integer;
  v_profile  uuid;
  v_service  record;
  v_n        integer;
  v_share    bigint;
  v_bps        integer;
  v_total_serv bigint;
begin
  v_company := app.current_company_id();

  -- FOR UPDATE serializa a dos operarios moviendo la misma tarjeta a la vez.
  select * into v_order from public.work_orders
  where id = p_order_id and company_id = v_company
  for update;

  if v_order.id is null then
    raise exception 'Orden % inexistente o fuera de su alcance', p_order_id
      using errcode = 'no_data_found';
  end if;

  if not app.order_transition_allowed(v_order.status, p_new_status) then
    raise exception 'No se puede pasar de "%" a "%"', v_order.status, p_new_status
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------------------- Bahía
  if p_new_status = 'en_proceso' then
    if p_bay_id is null then
      raise exception 'Iniciar el lavado exige indicar la bahía'
        using errcode = 'invalid_parameter_value';
    end if;

    select * into v_bay from public.bays
    where id = p_bay_id and company_id = v_company
    for update;

    if v_bay.id is null then
      raise exception 'Bahía inexistente' using errcode = 'no_data_found';
    end if;
    if v_bay.branch_id <> v_order.branch_id then
      raise exception 'La bahía pertenece a otra sucursal' using errcode = 'check_violation';
    end if;
    if v_bay.status = 'mantenimiento' then
      raise exception 'La bahía "%" está en mantenimiento', v_bay.name
        using errcode = 'check_violation';
    end if;
    -- Comprobación de capacidad que no existía: el Kanban auditado metía TODOS
    -- los vehículos en 'bay-1'.
    if v_bay.current_work_order_id is not null and v_bay.current_work_order_id <> p_order_id then
      raise exception 'La bahía "%" ya está ocupada', v_bay.name
        using errcode = 'unique_violation';
    end if;

    update public.bays
       set status = 'ocupada', current_work_order_id = p_order_id
     where id = p_bay_id;

  elsif v_order.status = 'en_proceso' then
    -- Sale de lavado: la bahía queda libre.
    update public.bays
       set status = 'disponible', current_work_order_id = null, assigned_profile_id = null
     where current_work_order_id = p_order_id and company_id = v_company;
  end if;

  -- --------------------------------------------------------- Operarios
  if p_assignees is not null then
    delete from public.work_order_assignees where work_order_id = p_order_id;
    foreach v_profile in array p_assignees loop
      insert into public.work_order_assignees (work_order_id, profile_id, company_id)
      values (p_order_id, v_profile, v_company)
      on conflict do nothing;
    end loop;
  end if;

  update public.work_orders
     set status = p_new_status,
         bay_id = case when p_new_status = 'en_proceso' then p_bay_id
                       when v_order.status = 'en_proceso' then null
                       else bay_id end
   where id = p_order_id
  returning * into v_result;

  get diagnostics v_rows = row_count;
  -- RLS filtra en silencio en UPDATE: sin esto, un cambio denegado se
  -- mostraría al operario como realizado.
  if v_rows = 0 then
    raise exception 'No tiene permiso para modificar esta orden'
      using errcode = 'insufficient_privilege';
  end if;

  -- -------------------------------------------------------- Comisiones
  -- Se generan al entregar, que es cuando el trabajo está cobrado y cerrado.
  -- En la aplicación auditada la tabla existía y nada la alimentaba.
  if p_new_status = 'entregado' then
    -- Consumo de insumos por receta (0021): descuenta el inventario según lo
    -- definido para cada servicio de la orden y deja el costo real registrado.
    perform app.consume_recipes(v_company, p_order_id);

    select count(*) into v_n from public.work_order_assignees where work_order_id = p_order_id;

    if v_n > 0 then
      -- Total de servicios de la orden: la base del monto fijo POR LAVADO.
      select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0)
        into v_total_serv
        from public.work_order_items i
       where i.work_order_id = p_order_id and i.item_type = 'service';

      -- ── 1. Lavadores con tarifa fija PROPIA: una comisión por el CARRO ──
      -- Su tarifa es «por lavado», no por línea: si se cobrara por cada
      -- servicio, una orden con lavado + aspirado le pagaría dos veces.
      insert into public.commissions (
        company_id, branch_id, profile_id, work_order_id, work_order_item_id,
        service_name, base_cents, commission_bps, commission_kind,
        rate_amount_cents, amount_cents
      )
      select v_company, v_order.branch_id, a.profile_id, p_order_id, null,
             'Lavado completo', v_total_serv / v_n, 0, 'monto',
             p.commission_amount_cents,
             -- Se reparte entre quienes compartieron el carro: si no, asignar a
             -- dos personas duplicaría el costo del mismo lavado.
             p.commission_amount_cents / v_n
      from public.work_order_assignees a
      join public.profiles p on p.id = a.profile_id
      where a.work_order_id = p_order_id
        and p.commission_kind = 'monto' and p.commission_amount_cents > 0;

      -- ── 2. El resto: por línea de servicio ──────────────────────────────
      -- Porcentaje propio del lavador o, si no tiene, la regla del servicio
      -- (que puede ser porcentaje o monto fijo por esa línea).
      for v_service in
        select i.id, i.name, i.service_id,
               (i.unit_price_cents * i.quantity - i.discount_cents) as line_cents,
               coalesce(s.commission_bps, 0) as service_bps,
               coalesce(s.commission_kind, 'porcentaje') as service_kind,
               coalesce(s.commission_amount_cents, 0) as service_amount
        from public.work_order_items i
        left join public.services s on s.id = i.service_id
        where i.work_order_id = p_order_id and i.item_type = 'service'
      loop
        -- Reparto exacto entre los operarios: la división entera se hace sobre
        -- la base, no sobre el importe, para no perder centavos por redondeo.
        v_share := v_service.line_cents / v_n;

        insert into public.commissions (
          company_id, branch_id, profile_id, work_order_id, work_order_item_id,
          service_name, base_cents, commission_bps, commission_kind,
          rate_amount_cents, amount_cents
        )
        select v_company, v_order.branch_id, a.profile_id, p_order_id, v_service.id,
               v_service.name, v_share,
               -- Su porcentaje manda; si no tiene, el del servicio.
               case when coalesce(p.commission_bps, 0) > 0 then p.commission_bps
                    when v_service.service_kind = 'monto' then 0
                    else v_service.service_bps end,
               case when coalesce(p.commission_bps, 0) = 0
                     and v_service.service_kind = 'monto' then 'monto'::app.commission_kind
                    else 'porcentaje'::app.commission_kind end,
               case when coalesce(p.commission_bps, 0) = 0
                     and v_service.service_kind = 'monto' then v_service.service_amount
                    else 0 end,
               case
                 when coalesce(p.commission_bps, 0) > 0
                   then round(v_share::numeric * p.commission_bps / 10000)::bigint
                 when v_service.service_kind = 'monto'
                   then v_service.service_amount / v_n
                 else round(v_share::numeric * v_service.service_bps / 10000)::bigint
               end
        from public.work_order_assignees a
        join public.profiles p on p.id = a.profile_id
        where a.work_order_id = p_order_id
          -- Los de tarifa fija propia ya cobraron arriba, por el carro entero.
          and not (p.commission_kind = 'monto' and p.commission_amount_cents > 0);
      end loop;
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_order.branch_id, 'CAMBIO_ESTADO_ORDEN', 'WorkOrder', p_order_id::text,
          'Orden ' || v_order.order_number || ': ' || v_order.status || ' → ' || p_new_status,
          jsonb_build_object('from', v_order.status, 'to', p_new_status, 'bay_id', p_bay_id));

  return v_result;
end;
$$;

comment on function public.advance_work_order is
  'Cambio de estado atómico: valida la transición, ocupa o libera la bahía, asigna operarios y genera comisiones al entregar.';

grant execute on function public.advance_work_order to authenticated;

-- ============================================================================
-- public.washer_performance · lo que genera cada lavador contra lo que cobra
-- ============================================================================
-- La pregunta del dueño es una sola: «este lavador, ¿cuánto me produce y cuánto
-- me cuesta?». Aquí sale junto — lavados hechos, lo que el negocio facturó por
-- ellos, lo que él se lleva, y qué porcentaje de lo generado representa eso.
--
-- El «genera» son los SERVICIOS de sus órdenes entregadas, no el total de la
-- factura: los productos que el cliente compró en caja no los produjo él, y
-- sumárselos inflaría su rendimiento con algo que no hizo.
--
-- Cuando varios lavadores comparten un carro, lo generado se REPARTE entre
-- ellos. Si a cada uno se le acreditara el carro entero, la suma de lo
-- «generado» por el equipo sería mayor que lo facturado por el negocio, y el
-- informe dejaría de cuadrar con la caja.
-- ============================================================================
create or replace function public.washer_performance(
  p_from date,
  p_to   date
)
returns table (
  profile_id           uuid,
  full_name            text,
  lavados              bigint,
  generado_cents       bigint,
  comision_cents       bigint,
  comision_pagada_cents bigint,
  costo_bps            integer,
  meta_lavados         integer,
  meta_generado_cents  bigint
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  with ordenes as (
    -- Una fila por lavador y orden entregada en el periodo, con su parte de lo
    -- facturado en servicios.
    select a.profile_id,
           o.id as order_id,
           (select coalesce(sum(i.unit_price_cents * i.quantity - i.discount_cents), 0)
              from public.work_order_items i
             where i.work_order_id = o.id and i.item_type = 'service')
           / greatest(count(*) over (partition by o.id), 1) as parte_cents
      from public.work_orders o
      join public.work_order_assignees a on a.work_order_id = o.id
     where o.company_id = app.current_company_id()
       and o.status = 'entregado'
       and o.delivered_at::date between p_from and p_to
  ),
  produccion as (
    select profile_id,
           count(distinct order_id) as lavados,
           coalesce(sum(parte_cents), 0) as generado_cents
      from ordenes group by profile_id
  ),
  pagos as (
    select c.profile_id,
           coalesce(sum(c.amount_cents), 0) as comision_cents,
           coalesce(sum(c.amount_cents) filter (where c.is_paid), 0) as pagada_cents
      from public.commissions c
     where c.company_id = app.current_company_id()
       and c.earned_on between p_from and p_to
     group by c.profile_id
  ),
  metas as (
    -- La meta que CUBRE el periodo consultado. Si hay varias, la más ajustada.
    select distinct on (g.profile_id)
           g.profile_id, g.target_washes, g.target_revenue_cents
      from public.washer_goals g
     where g.company_id = app.current_company_id()
       and g.period_from <= p_to and g.period_to >= p_from
     order by g.profile_id, (g.period_to - g.period_from) asc
  )
  select p.id,
         p.full_name,
         coalesce(pr.lavados, 0),
         coalesce(pr.generado_cents, 0),
         coalesce(pg.comision_cents, 0),
         coalesce(pg.pagada_cents, 0),
         -- Cuánto de lo que genera se va en su comisión, en puntos base. Es la
         -- cifra que responde «¿me conviene esta tarifa?».
         case when coalesce(pr.generado_cents, 0) > 0
              then round(coalesce(pg.comision_cents, 0)::numeric * 10000
                         / pr.generado_cents)::integer
              else 0 end,
         m.target_washes,
         m.target_revenue_cents
    from public.profiles p
    left join produccion pr on pr.profile_id = p.id
    left join pagos      pg on pg.profile_id = p.id
    left join metas      m  on m.profile_id  = p.id
   where p.company_id = app.current_company_id()
     and p.role in ('operario', 'supervisor')
     -- Se incluye a quien tiene meta aunque no haya lavado nada: un lavador con
     -- meta y cero lavados es justo el que hay que ver.
     and (p.is_active or pr.lavados is not null)
   order by coalesce(pr.generado_cents, 0) desc, p.full_name;
$$;

grant execute on function public.washer_performance(date, date) to authenticated;

comment on function public.washer_performance is
  'Rendimiento por lavador en un periodo: lavados, lo que generó para el '
  'negocio, su comisión, qué parte de lo generado se lleva, y su meta.';
