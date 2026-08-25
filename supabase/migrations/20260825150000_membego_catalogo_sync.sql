-- ============================================================================
-- SINCRONIZACIÓN MASIVA DEL CATÁLOGO DE MEMBEGO (Fase 2)
-- ============================================================================
-- Trae en bloque, a nivel de empresa, lo que la API de plataforma de Membego
-- expone con los endpoints de la Fase 2: promociones (GET /promotions), citas
-- (GET /appointments) y membresías activas (GET /memberships).
--
-- Se guardan como SNAPSHOT en tablas propias, igual que el perfil de la Fase 1:
-- son copias informativas (proyecciones) que NO deciden nada —el canje sigue en
-- benefits.evaluate— y NO pisan las tablas operativas del car wash
-- (memberships, customer_promotions, appointments), que siguen su curso por
-- webhook y por la operación local.
--
-- La escritura entra solo por membego_sync_catalogo (SECURITY DEFINER), llamada
-- por el borde serverless con service_role tras verificar al empleado.
-- ============================================================================

-- ---------------------------------------------------------------- Promociones
create table if not exists public.membego_promociones (
  company_id            uuid not null references public.companies(id) on delete cascade,
  membego_promotion_id  text not null,
  titulo                text not null default '',
  descripcion           text not null default '',
  imagen_url            text,
  activo                boolean not null default true,
  vigencia_desde        timestamptz,
  vigencia_hasta        timestamptz,
  raw                   jsonb not null default '{}'::jsonb,
  synced_at             timestamptz not null default now(),
  primary key (company_id, membego_promotion_id)
);
create index if not exists membego_promociones_company_idx
  on public.membego_promociones (company_id);

-- --------------------------------------------------------------------- Citas
create table if not exists public.membego_citas (
  company_id             uuid not null references public.companies(id) on delete cascade,
  membego_appointment_id text not null,
  membego_customer_id    text,
  membego_branch_id      text,
  membego_vehicle_id     text,
  inicio                 timestamptz,
  duracion_min           integer not null default 0,
  servicio               text,
  estado                 text not null default '',
  raw                    jsonb not null default '{}'::jsonb,
  synced_at              timestamptz not null default now(),
  primary key (company_id, membego_appointment_id)
);
create index if not exists membego_citas_company_inicio_idx
  on public.membego_citas (company_id, inicio);

-- ---------------------------------------------------------------- Membresías
create table if not exists public.membego_membresias (
  company_id            uuid not null references public.companies(id) on delete cascade,
  membego_membership_id text not null,
  membego_customer_id   text,
  plan_nombre           text not null default '',
  estado                text not null default '',
  vigente_hasta         timestamptz,
  raw                   jsonb not null default '{}'::jsonb,
  synced_at             timestamptz not null default now(),
  primary key (company_id, membego_membership_id)
);
create index if not exists membego_membresias_company_idx
  on public.membego_membresias (company_id);

comment on table public.membego_promociones is
  'Snapshot de las promociones de la empresa en Membego (GET /promotions). '
  'Informativo: no pisa customer_promotions.';
comment on table public.membego_citas is
  'Snapshot de las citas de la empresa en Membego (GET /appointments). '
  'Informativo: no pisa la agenda operativa (appointments).';
comment on table public.membego_membresias is
  'Snapshot de las membresías activas de la empresa en Membego (GET /memberships). '
  'Informativo: no pisa memberships.';

-- --------------------------------------------------------------------- RLS
alter table public.membego_promociones enable row level security;
alter table public.membego_promociones force  row level security;
alter table public.membego_citas       enable row level security;
alter table public.membego_citas       force  row level security;
alter table public.membego_membresias  enable row level security;
alter table public.membego_membresias  force  row level security;

drop policy if exists membego_promociones_select on public.membego_promociones;
create policy membego_promociones_select on public.membego_promociones
  for select to authenticated using (app.belongs_to_tenant(company_id));

drop policy if exists membego_citas_select on public.membego_citas;
create policy membego_citas_select on public.membego_citas
  for select to authenticated using (app.belongs_to_tenant(company_id));

drop policy if exists membego_membresias_select on public.membego_membresias;
create policy membego_membresias_select on public.membego_membresias
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.membego_promociones, public.membego_citas, public.membego_membresias
  to authenticated;

-- ------------------------------------------------------ RPC de sincronización
-- Reemplaza cada snapshot entero: lo que Membego ya no lista, aquí desaparece.
-- Idempotente. Acota todo a la empresa que resuelve el vínculo, nunca a un
-- company_id que venga de la red.
create or replace function public.membego_sync_catalogo(
  p_membego_company_id text,
  p_promotions         jsonb,
  p_appointments       jsonb,
  p_memberships        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.membego_company(p_membego_company_id);
  v_row     jsonb;
  v_np      integer := 0;
  v_nc      integer := 0;
  v_nm      integer := 0;
begin
  if v_company is null then
    return jsonb_build_object('handled', false, 'reason', 'unknown_company');
  end if;

  -- Promociones.
  if jsonb_typeof(p_promotions) = 'array' then
    delete from public.membego_promociones where company_id = v_company;
    for v_row in select * from jsonb_array_elements(p_promotions) loop
      insert into public.membego_promociones
        (company_id, membego_promotion_id, titulo, descripcion, imagen_url, activo,
         vigencia_desde, vigencia_hasta, raw, synced_at)
      values (
        v_company,
        coalesce(nullif(v_row ->> 'id', ''), gen_random_uuid()::text),
        coalesce(v_row ->> 'titulo', ''),
        coalesce(v_row ->> 'descripcion', ''),
        nullif(v_row ->> 'imagenUrl', ''),
        coalesce((v_row ->> 'activo')::boolean, true),
        (v_row ->> 'vigenciaDesde')::timestamptz,
        (v_row ->> 'vigenciaHasta')::timestamptz,
        v_row, now()
      )
      on conflict (company_id, membego_promotion_id) do update set
        titulo = excluded.titulo, descripcion = excluded.descripcion,
        imagen_url = excluded.imagen_url, activo = excluded.activo,
        vigencia_desde = excluded.vigencia_desde, vigencia_hasta = excluded.vigencia_hasta,
        raw = excluded.raw, synced_at = now();
      v_np := v_np + 1;
    end loop;
  end if;

  -- Citas.
  if jsonb_typeof(p_appointments) = 'array' then
    delete from public.membego_citas where company_id = v_company;
    for v_row in select * from jsonb_array_elements(p_appointments) loop
      insert into public.membego_citas
        (company_id, membego_appointment_id, membego_customer_id, membego_branch_id,
         membego_vehicle_id, inicio, duracion_min, servicio, estado, raw, synced_at)
      values (
        v_company,
        coalesce(nullif(v_row ->> 'id', ''), gen_random_uuid()::text),
        nullif(v_row ->> 'customerId', ''),
        nullif(v_row ->> 'branchId', ''),
        nullif(v_row ->> 'vehicleId', ''),
        (v_row ->> 'inicio')::timestamptz,
        coalesce((v_row ->> 'duracionMin')::integer, 0),
        nullif(v_row ->> 'servicio', ''),
        coalesce(v_row ->> 'estado', ''),
        v_row, now()
      )
      on conflict (company_id, membego_appointment_id) do update set
        membego_customer_id = excluded.membego_customer_id,
        membego_branch_id = excluded.membego_branch_id,
        membego_vehicle_id = excluded.membego_vehicle_id,
        inicio = excluded.inicio, duracion_min = excluded.duracion_min,
        servicio = excluded.servicio, estado = excluded.estado,
        raw = excluded.raw, synced_at = now();
      v_nc := v_nc + 1;
    end loop;
  end if;

  -- Membresías.
  if jsonb_typeof(p_memberships) = 'array' then
    delete from public.membego_membresias where company_id = v_company;
    for v_row in select * from jsonb_array_elements(p_memberships) loop
      insert into public.membego_membresias
        (company_id, membego_membership_id, membego_customer_id, plan_nombre, estado,
         vigente_hasta, raw, synced_at)
      values (
        v_company,
        coalesce(nullif(v_row ->> 'id', ''), gen_random_uuid()::text),
        nullif(v_row ->> 'customerId', ''),
        coalesce(v_row ->> 'planNombre', ''),
        coalesce(v_row ->> 'estado', ''),
        (v_row ->> 'vigenteHasta')::timestamptz,
        v_row, now()
      )
      on conflict (company_id, membego_membership_id) do update set
        membego_customer_id = excluded.membego_customer_id,
        plan_nombre = excluded.plan_nombre, estado = excluded.estado,
        vigente_hasta = excluded.vigente_hasta, raw = excluded.raw, synced_at = now();
      v_nm := v_nm + 1;
    end loop;
  end if;

  insert into public.membego_sync_logs
    (company_id, action, status, request_payload, response_payload)
  values (
    v_company, 'catalogo.sincronizado', 'success',
    jsonb_build_object('membego_company_id', p_membego_company_id),
    jsonb_build_object('promociones', v_np, 'citas', v_nc, 'membresias', v_nm)
  );

  return jsonb_build_object(
    'handled', true, 'company_id', v_company,
    'promociones', v_np, 'citas', v_nc, 'membresias', v_nm
  );
end;
$$;

comment on function public.membego_sync_catalogo is
  'Vuelca promociones, citas y membresías de Membego a las tablas snapshot. '
  'La llama el borde serverless con service_role tras autenticar al empleado.';

grant execute on function public.membego_sync_catalogo(text, jsonb, jsonb, jsonb) to service_role;
