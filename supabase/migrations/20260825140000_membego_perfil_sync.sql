-- ============================================================================
-- SINCRONIZACIÓN DEL PERFIL DE LA EMPRESA DESDE MEMBEGO (Fase 1)
-- ============================================================================
-- Trae desde la API de plataforma de Membego lo que HOY se puede leer en bloque
-- a nivel de empresa: el perfil de la empresa (`GET /companies/{id}`) y sus
-- sucursales (`GET /branches`). Se guarda como SNAPSHOT en tablas propias, sin
-- tocar `companies` ni `branches` (que son operativas y fiscales del car wash):
-- así el dato de Membego queda EN el sistema, visible, sin pisar lo que el
-- negocio ya tiene cargado.
--
-- Las membresías, clientes, citas y promociones NO tienen endpoint masivo en la
-- API actual de Membego (son por-cliente o inexistentes), así que van en la
-- Fase 2, que agrega esos endpoints al backend de Membego.
--
-- La escritura entra solo por `membego_sync_perfil` (SECURITY DEFINER), llamada
-- por el borde serverless con service_role tras verificar que quien pide es un
-- empleado de ESTA empresa. Desde el cliente, las tablas son de solo lectura y
-- acotadas por tenant.
-- ============================================================================

-- ---------------------------------------------------- Perfil de la empresa
create table if not exists public.membego_empresa_perfil (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  membego_company_id  text not null,
  nombre              text,
  slug                text,
  logo_url            text,
  moneda              text,
  zona_horaria        text,
  idioma              text,
  raw                 jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now()
);

comment on table public.membego_empresa_perfil is
  'Snapshot del perfil de la empresa en Membego (GET /companies/{id}). No pisa '
  'public.companies: es una copia informativa que refresca membego_sync_perfil.';

-- ------------------------------------------------------------ Sucursales
create table if not exists public.membego_sucursales (
  company_id         uuid not null references public.companies(id) on delete cascade,
  membego_branch_id  text not null,
  nombre             text not null default '',
  direccion          text,
  activa             boolean not null default true,
  raw                jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now(),
  primary key (company_id, membego_branch_id)
);

create index if not exists membego_sucursales_company_idx
  on public.membego_sucursales (company_id);

comment on table public.membego_sucursales is
  'Snapshot de las sucursales de la empresa en Membego (GET /branches). '
  'Informativo: no crea sucursales operativas en public.branches.';

-- --------------------------------------------------------------- RLS
alter table public.membego_empresa_perfil enable row level security;
alter table public.membego_empresa_perfil force  row level security;
alter table public.membego_sucursales     enable row level security;
alter table public.membego_sucursales     force  row level security;

drop policy if exists membego_empresa_perfil_select on public.membego_empresa_perfil;
create policy membego_empresa_perfil_select on public.membego_empresa_perfil
  for select to authenticated using (app.belongs_to_tenant(company_id));

drop policy if exists membego_sucursales_select on public.membego_sucursales;
create policy membego_sucursales_select on public.membego_sucursales
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.membego_empresa_perfil, public.membego_sucursales to authenticated;

-- ------------------------------------------------------ RPC de sincronización
-- Idempotente: reejecutar deja el snapshot igual. El borde serverless la llama
-- con service_role tras autenticar al empleado; por eso NO revalida el rol aquí
-- (SECURITY DEFINER se salta RLS), pero SÍ acota todo a la empresa que resuelve
-- el vínculo, nunca a un company_id que venga de la red.
create or replace function public.membego_sync_perfil(
  p_membego_company_id text,
  p_company            jsonb,
  p_branches           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid := app.membego_company(p_membego_company_id);
  v_sucursal  jsonb;
  v_n_branch  integer := 0;
begin
  if v_company is null then
    return jsonb_build_object('handled', false, 'reason', 'unknown_company');
  end if;

  -- Perfil (upsert por company_id).
  insert into public.membego_empresa_perfil
    (company_id, membego_company_id, nombre, slug, logo_url, moneda, zona_horaria, idioma, raw, synced_at)
  values (
    v_company,
    p_membego_company_id,
    nullif(p_company ->> 'nombre', ''),
    nullif(p_company ->> 'slug', ''),
    nullif(p_company ->> 'logoUrl', ''),
    nullif(p_company ->> 'moneda', ''),
    nullif(p_company ->> 'zonaHoraria', ''),
    nullif(p_company ->> 'idioma', ''),
    coalesce(p_company, '{}'::jsonb),
    now()
  )
  on conflict (company_id) do update set
    membego_company_id = excluded.membego_company_id,
    nombre       = excluded.nombre,
    slug         = excluded.slug,
    logo_url     = excluded.logo_url,
    moneda       = excluded.moneda,
    zona_horaria = excluded.zona_horaria,
    idioma       = excluded.idioma,
    raw          = excluded.raw,
    synced_at    = now();

  -- Sucursales: el snapshot se REEMPLAZA entero. Así una sucursal que Membego
  -- borró desaparece aquí también, sin quedar como fantasma.
  if p_branches is not null and jsonb_typeof(p_branches) = 'array' then
    delete from public.membego_sucursales where company_id = v_company;
    for v_sucursal in select * from jsonb_array_elements(p_branches)
    loop
      insert into public.membego_sucursales
        (company_id, membego_branch_id, nombre, direccion, activa, raw, synced_at)
      values (
        v_company,
        coalesce(nullif(v_sucursal ->> 'id', ''), gen_random_uuid()::text),
        coalesce(v_sucursal ->> 'nombre', ''),
        nullif(v_sucursal ->> 'direccion', ''),
        coalesce((v_sucursal ->> 'activa')::boolean, true),
        v_sucursal,
        now()
      )
      on conflict (company_id, membego_branch_id) do update set
        nombre    = excluded.nombre,
        direccion = excluded.direccion,
        activa    = excluded.activa,
        raw       = excluded.raw,
        synced_at = now();
      v_n_branch := v_n_branch + 1;
    end loop;
  end if;

  -- Bitácora: queda registro de cada sincronización, con su conteo.
  insert into public.membego_sync_logs
    (company_id, action, status, request_payload, response_payload)
  values (
    v_company, 'perfil.sincronizado', 'success',
    jsonb_build_object('membego_company_id', p_membego_company_id),
    jsonb_build_object('sucursales', v_n_branch)
  );

  return jsonb_build_object('handled', true, 'company_id', v_company, 'sucursales', v_n_branch);
end;
$$;

comment on function public.membego_sync_perfil is
  'Vuelca el perfil y las sucursales de Membego a las tablas snapshot. La llama '
  'el borde serverless con service_role tras autenticar al empleado.';

grant execute on function public.membego_sync_perfil(text, jsonb, jsonb) to service_role;
