-- ============================================================================
-- CATEGORÍAS DE VEHÍCULO DINÁMICAS (superadmin)
-- ============================================================================
-- Hasta aquí las categorías eran un tipo fijo (enum app.vehicle_category) usado
-- en 14 migraciones y en el camino del dinero (create_invoice). Reescribir todo
-- eso a texto sería un cambio enorme y arriesgado.
--
-- En su lugar: el enum SIGUE siendo el almacenamiento (cero cambios en las
-- funciones ni en las columnas existentes), y encima se pone una tabla de
-- METADATOS por empresa —etiqueta, orden, activo— que decide QUÉ categorías se
-- muestran y cómo se llaman. Crear una categoría nueva = agregar un valor al
-- enum (ALTER TYPE ADD VALUE, que Postgres permite dentro de una función y deja
-- usable en la siguiente transacción) + una fila de metadatos.
--
-- Así el superadmin crea categorías sin tocar el cálculo del cobro, y cada
-- empresa gestiona su propia lista. El enum solo acumula códigos; la
-- visibilidad la da la tabla.
-- ============================================================================

create table if not exists public.vehicle_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- El valor del enum app.vehicle_category (se guarda como texto: la tabla no
  -- se ata al enum para no arrastrar su rigidez).
  code        text not null check (code ~ '^[a-z][a-z0-9_]{0,30}$'),
  label       text not null check (length(trim(label)) > 0),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists vehicle_categories_company_idx
  on public.vehicle_categories (company_id) where is_active;

comment on table public.vehicle_categories is
  'Metadatos por empresa de las categorías de vehículo: etiqueta, orden y '
  'visibilidad. El almacenamiento sigue siendo el enum app.vehicle_category.';

create trigger vehicle_categories_touch before update on public.vehicle_categories
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------- Semilla por empresa
-- Cada empresa arranca con las categorías que ya existían, etiquetadas en
-- español y ordenadas. Reejecutable (on conflict do nothing).
insert into public.vehicle_categories (company_id, code, label, sort_order)
select c.id, v.code, v.label, v.ord
from public.companies c
cross join (values
  ('sedan','Sedán',10),
  ('suv','SUV',20),
  ('jeep','Jeep',30),
  ('pickup','Pickup',40),
  ('van','Van',50),
  ('truck','Camión',60),
  ('motorcycle','Moto',70),
  ('special','Especial',80)
) as v(code, label, ord)
on conflict (company_id, code) do nothing;

-- --------------------------------------------------------------------- RLS
alter table public.vehicle_categories enable row level security;
alter table public.vehicle_categories force  row level security;

drop policy if exists vehicle_categories_select on public.vehicle_categories;
create policy vehicle_categories_select on public.vehicle_categories
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Sin políticas de escritura: solo entran por las RPC (superadmin).
grant select on public.vehicle_categories to authenticated;

-- ------------------------------------------------- Normalizar una etiqueta a code
create or replace function app.slug_categoria(p_texto text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      lower(translate(trim(p_texto),
        'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
      '[^a-z0-9]+', '_', 'g'),          -- todo lo no alfanumérico → _
    '(^_+|_+$)', '', 'g')               -- sin _ al inicio/fin
$$;

comment on function app.slug_categoria is
  'Convierte "Camioneta Grande" en "camioneta_grande": el code estable del enum.';

-- ------------------------------------------------------- Crear categoría (superadmin)
create or replace function public.create_vehicle_category(
  p_label      text,
  p_code       text default null,
  p_sort_order integer default null
)
returns public.vehicle_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_code    text := coalesce(nullif(app.slug_categoria(coalesce(p_code, p_label)), ''), '');
  v_order   integer;
  v_row     public.vehicle_categories;
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.';
  end if;
  if not app.has_role('superadmin') then
    raise exception 'Solo el superadministrador puede crear categorías de vehículo.';
  end if;
  if v_code = '' or v_code !~ '^[a-z][a-z0-9_]{0,30}$' then
    raise exception 'El nombre de la categoría no es válido: use letras (por ejemplo, "Camioneta").';
  end if;
  if exists (select 1 from public.vehicle_categories
             where company_id = v_company and code = v_code) then
    raise exception 'Ya existe una categoría con ese nombre.';
  end if;

  -- Agrega el valor al enum si aún no existe. Postgres lo permite dentro de la
  -- función y lo deja usable a partir de la siguiente transacción; aquí solo se
  -- guarda el code como TEXTO, así que no se usa el valor del enum en esta tx.
  execute format('alter type app.vehicle_category add value if not exists %L', v_code);

  select coalesce(p_sort_order, coalesce(max(sort_order), 0) + 10)
    into v_order
    from public.vehicle_categories where company_id = v_company;

  insert into public.vehicle_categories (company_id, code, label, sort_order)
  values (v_company, v_code, trim(p_label), v_order)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_vehicle_category is
  'Crea una categoría de vehículo (superadmin): agrega el valor al enum y su '
  'fila de metadatos para la empresa actual. Los precios se cargan aparte.';

grant execute on function public.create_vehicle_category(text, text, integer) to authenticated;

-- --------------------------------------------------- Editar categoría (superadmin)
create or replace function public.update_vehicle_category(
  p_id         uuid,
  p_label      text default null,
  p_sort_order integer default null,
  p_is_active  boolean default null
)
returns public.vehicle_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_row     public.vehicle_categories;
begin
  if not app.has_role('superadmin') then
    raise exception 'Solo el superadministrador puede editar categorías de vehículo.';
  end if;

  update public.vehicle_categories set
    label      = coalesce(nullif(trim(p_label), ''), label),
    sort_order = coalesce(p_sort_order, sort_order),
    is_active  = coalesce(p_is_active, is_active)
  where id = p_id and company_id = v_company
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Categoría inexistente o fuera de su alcance.';
  end if;
  return v_row;
end;
$$;

comment on function public.update_vehicle_category is
  'Edita la etiqueta, el orden o la visibilidad de una categoría (superadmin). '
  'No borra el valor del enum: desactivar la esconde sin romper el histórico.';

grant execute on function public.update_vehicle_category(uuid, text, integer, boolean) to authenticated;
