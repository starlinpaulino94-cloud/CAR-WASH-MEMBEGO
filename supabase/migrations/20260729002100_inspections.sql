-- =============================================================================
-- 0023 · Inspección de recepción y entrega del vehículo
-- =============================================================================
-- El modelo original contemplaba inspección, combustible, daños y firma, pero
-- nada de eso llegaba a la base: si un cliente reclamaba un rayón, no había
-- evidencia de si venía de antes. Esto lo resuelve:
--
--   · vehicle_inspections: una inspección por orden y momento (recepción o
--     entrega): daños por zona, nivel de combustible, objetos de valor, notas,
--     aceptación de términos y firma del cliente.
--   · inspection_damages: cada daño marcado, con zona, tipo, gravedad y la
--     posición en el diagrama del vehículo (x/y en porcentaje, para repintarlo).
--
-- La firma se guarda como data URI (PNG del trazo, unos pocos KB). Las
-- FOTOGRAFÍAS requieren Supabase Storage (bucket + políticas); la columna
-- photo_urls queda lista para cuando se configure, y no se usa todavía.
--
-- Regla dura: una inspección FIRMADA es inmutable. Corregir exige una nueva.
-- =============================================================================

create type app.inspection_stage as enum ('recepcion', 'entrega');
create type app.damage_kind as enum
  ('rayon', 'abolladura', 'rotura', 'faltante', 'mancha', 'oxido', 'otro');
create type app.damage_severity as enum ('leve', 'moderado', 'grave');

create table public.vehicle_inspections (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  work_order_id  uuid not null,
  stage          app.inspection_stage not null default 'recepcion',
  fuel_level     app.fuel_level,
  mileage        integer check (mileage is null or mileage >= 0),
  valuables      text,                     -- objetos de valor declarados
  notes          text,
  terms_accepted boolean not null default false,
  -- Firma del cliente: data URI del trazo (image/png en base64).
  signature      text,
  signed_by      text,                     -- nombre de quien firma
  signed_at      timestamptz,
  photo_urls     text[] not null default '{}',   -- reservado para Storage
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, company_id),
  -- Una inspección por orden y momento: la de recepción y la de entrega.
  unique (work_order_id, stage),
  constraint inspections_order_same_company
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade,
  -- Firmar exige aceptar términos y dejar constancia de quién y cuándo.
  constraint inspections_signature_complete check (
    signature is null or (terms_accepted and signed_at is not null
                          and signed_by is not null and length(trim(signed_by)) > 0)
  )
);

create index vehicle_inspections_order_idx on public.vehicle_inspections (work_order_id);
create index vehicle_inspections_company_idx on public.vehicle_inspections (company_id, created_at desc);

create trigger vehicle_inspections_touch before update on public.vehicle_inspections
  for each row execute function app.touch_updated_at();

create table public.inspection_damages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  inspection_id uuid not null,
  zone          text not null check (length(trim(zone)) > 0),
  kind          app.damage_kind not null default 'rayon',
  severity      app.damage_severity not null default 'leve',
  note          text,
  -- Posición en el diagrama, en porcentaje del ancho/alto (0-100).
  pos_x         numeric(5,2) check (pos_x is null or (pos_x >= 0 and pos_x <= 100)),
  pos_y         numeric(5,2) check (pos_y is null or (pos_y >= 0 and pos_y <= 100)),
  created_at    timestamptz not null default now(),
  constraint damages_inspection_same_company
    foreign key (inspection_id, company_id) references public.vehicle_inspections(id, company_id) on delete cascade
);

create index inspection_damages_inspection_idx on public.inspection_damages (inspection_id);

-- ------------------------------------------------- Inmutabilidad tras firmar
-- Una inspección firmada es la evidencia: no se reescribe. Si algo cambió, se
-- levanta otra (la de entrega) y se comparan.
create or replace function app.inspections_freeze_signed()
returns trigger
language plpgsql
as $$
begin
  if old.signature is not null then
    raise exception 'La inspección ya está firmada: es evidencia y no se modifica. '
                    'Registre una inspección de entrega para dejar constancia de los cambios.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger vehicle_inspections_freeze
  before update on public.vehicle_inspections
  for each row execute function app.inspections_freeze_signed();

-- Los daños de una inspección firmada tampoco se tocan.
create or replace function app.damages_freeze_signed()
returns trigger
language plpgsql
as $$
declare v_signed text;
begin
  select signature into v_signed from public.vehicle_inspections
  where id = coalesce(new.inspection_id, old.inspection_id);
  if v_signed is not null then
    raise exception 'La inspección ya está firmada: sus daños no se modifican.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger inspection_damages_freeze
  before insert or update or delete on public.inspection_damages
  for each row execute function app.damages_freeze_signed();

-- ================================================================== RLS
alter table public.vehicle_inspections enable row level security;
alter table public.vehicle_inspections force  row level security;
alter table public.inspection_damages  enable row level security;
alter table public.inspection_damages  force  row level security;

create policy vehicle_inspections_select on public.vehicle_inspections
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- La levanta quien recibe el vehículo (recepción y operación).
create policy vehicle_inspections_write on public.vehicle_inspections
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor',
                          'recepcionista', 'cajero', 'operario', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor',
                               'recepcionista', 'cajero', 'operario', 'superadmin'));

create policy inspection_damages_select on public.inspection_damages
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy inspection_damages_write on public.inspection_damages
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor',
                          'recepcionista', 'cajero', 'operario', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'supervisor',
                               'recepcionista', 'cajero', 'operario', 'superadmin'));

grant select, insert, update on public.vehicle_inspections to authenticated;
grant select, insert, update, delete on public.inspection_damages to authenticated;

-- ==================================================== Firmar la inspección
-- Cierra la evidencia: exige términos aceptados y nombre de quien firma, y
-- deja la acción en la bitácora. Después de esto, la inspección es inmutable.
create or replace function public.sign_inspection(
  p_inspection_id uuid,
  p_signature     text,
  p_signed_by     text
)
returns public.vehicle_inspections
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_row     public.vehicle_inspections;
begin
  if length(coalesce(p_signature, '')) < 20 then
    raise exception 'Falta la firma del cliente.' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_signed_by, ''))) = 0 then
    raise exception 'Indique el nombre de quien firma.' using errcode = 'check_violation';
  end if;

  select * into v_row from public.vehicle_inspections
  where id = p_inspection_id and company_id = v_company;
  if v_row.id is null then
    raise exception 'Inspección inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_row.signature is not null then
    raise exception 'Esta inspección ya está firmada.' using errcode = 'check_violation';
  end if;

  update public.vehicle_inspections
     set signature = p_signature,
         signed_by = trim(p_signed_by),
         signed_at = now(),
         terms_accepted = true
   where id = p_inspection_id and company_id = v_company
  returning * into v_row;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_row.branch_id, 'FIRMAR_INSPECCION', 'vehicle_inspection', v_row.id,
          format('Inspección de %s firmada por %s', v_row.stage, trim(p_signed_by)));

  return v_row;
end;
$$;

grant execute on function public.sign_inspection(uuid, text, text) to authenticated;

comment on table public.vehicle_inspections is
  'Estado del vehículo al recibirlo y al entregarlo: daños, combustible, '
  'objetos de valor y firma del cliente. Firmada = inmutable (es evidencia).';
