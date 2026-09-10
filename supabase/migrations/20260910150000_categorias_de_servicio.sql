-- =============================================================================
-- CATEGORÍAS DE SERVICIO (lavados, brillados, encerado…)
-- =============================================================================
-- El catálogo era una lista plana. Con 17 servicios ya cuesta encontrar uno, y
-- en la caja y en la recepción se ven TODOS los de la categoría del vehículo
-- mezclados: el lavado que se busca está entre el brillado de faroles y la
-- reparación de ribete. Agrupar por tipo de trabajo es lo que convierte esa
-- lista en algo que se recorre con la vista.
--
-- POR QUÉ UNA TABLA Y NO UNA LISTA FIJA
--
-- Porque cada local tiene su forma de agrupar: uno separa «encerado» de
-- «brillado» y otro los llama a los dos «detallado». Una lista escrita en el
-- código obliga a un despliegue para añadir un tipo de trabajo, y entonces
-- nadie lo añade y todo acaba en «otros».
--
-- CÓMO SE ATA A `services`
--
-- Por la columna `services.category`, que YA EXISTÍA como texto y estaba sin
-- usar en toda la aplicación. Guarda el `code` de la categoría. Es el mismo
-- patrón que `vehicle_categories`: la tabla pone etiqueta, orden y visibilidad;
-- el servicio guarda el código.
--
-- Se eligió código de texto y no una clave foránea a propósito: si alguien
-- borra una categoría, sus servicios NO desaparecen del catálogo ni pierden su
-- precio — se quedan «sin categoría» y se ven en el filtro correspondiente.
-- Con una foránea en cascada, borrar una categoría se llevaría por delante
-- servicios que se siguen vendiendo; con una foránea restrictiva, la categoría
-- no se podría borrar nunca. Ninguna de las dos es lo que quiere el mostrador.
-- =============================================================================

create table if not exists public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null check (code ~ '^[a-z][a-z0-9_]{0,30}$'),
  label       text not null check (length(trim(label)) > 0),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists service_categories_company_idx
  on public.service_categories (company_id) where is_active;

-- El filtro del catálogo y de la caja pregunta siempre por esta columna.
create index if not exists services_category_idx
  on public.services (company_id, category) where is_active;

comment on table public.service_categories is
  'Tipos de trabajo por empresa (lavados, brillado, encerado…). El servicio '
  'guarda el code en services.category; esta tabla pone etiqueta, orden y '
  'visibilidad.';

drop trigger if exists service_categories_touch on public.service_categories;
create trigger service_categories_touch before update on public.service_categories
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------- Semilla por empresa
-- Las ocho que cubren un car wash. Cada empresa puede renombrarlas, esconderlas
-- o añadir las suyas; esto solo evita que el primer día el filtro esté vacío.
--
-- Va en una función y no en un `insert` suelto porque hay DOS momentos en que
-- hace falta: al aplicar esta migración, para las empresas que ya existen, y al
-- nacer una empresa nueva. Sin lo segundo, cualquier local dado de alta después
-- —incluidos los que se auto-vinculan al entrar por SSO desde Membego— estrenaría
-- el catálogo con el filtro vacío y sin manera de saber por qué.
create or replace function app.sembrar_categorias_servicio(p_company uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.service_categories (company_id, code, label, sort_order)
  select p_company, v.code, v.label, v.ord
  from (values
    ('lavado',      'Lavados',            10),
    ('paquete',     'Paquetes',           20),
    ('encerado',    'Encerado',           30),
    ('brillado',    'Brillado y pulido',  40),
    ('tratamiento', 'Tratamientos',       50),
    ('detallado',   'Detallado',          60),
    ('reparacion',  'Reparaciones',       70),
    ('otros',       'Otros',              80)
  ) as v(code, label, ord)
  on conflict (company_id, code) do nothing;
$$;

comment on function app.sembrar_categorias_servicio is
  'Las categorías de servicio con las que arranca una empresa. La llama esta '
  'migración para las que ya existían y el disparador para las que nazcan.';

-- Las que ya existen.
select app.sembrar_categorias_servicio(id) from public.companies;

-- Y las que nazcan.
create or replace function app.al_crear_empresa_sembrar_categorias()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.sembrar_categorias_servicio(new.id);
  return new;
end;
$$;

drop trigger if exists companies_sembrar_categorias_servicio on public.companies;
create trigger companies_sembrar_categorias_servicio
  after insert on public.companies
  for each row execute function app.al_crear_empresa_sembrar_categorias();

-- ------------------------------------------- Clasificar lo que ya está creado
-- Un catálogo que estrena filtro con todo en «sin categoría» es un filtro que
-- no sirve el primer día, y clasificar a mano 17 servicios es justo lo que
-- nadie hace. Va en dos pasos, y el orden importa.

-- PASO 1 · Respetar lo que alguien ya escribió a mano.
--
-- La columna `category` existía como texto libre. Si un local la venía usando
-- —«Lavado», «Detallado Premium»— eso es una clasificación real, hecha por
-- quien conoce el negocio, y tirarla para adivinar por el nombre sería perder
-- trabajo humano a cambio de una regla. Cada valor distinto se convierte en una
-- categoría de verdad, conservando su texto como etiqueta.
--
-- Se descartan los que no dan un código válido (empiezan por número, quedan
-- vacíos al normalizar): esos caen al paso 2 y se clasifican por el nombre.
insert into public.service_categories (company_id, code, label, sort_order)
select distinct on (s.company_id, app.slug_categoria(s.category))
       s.company_id,
       app.slug_categoria(s.category),
       trim(s.category),
       100
  from public.services s
 where coalesce(trim(s.category), '') <> ''
   and app.slug_categoria(s.category) ~ '^[a-z][a-z0-9_]{0,30}$'
on conflict (company_id, code) do nothing;

-- Y el servicio pasa a guardar el código, no el texto.
update public.services s
   set category = app.slug_categoria(s.category)
 where coalesce(trim(s.category), '') <> ''
   and app.slug_categoria(s.category) ~ '^[a-z][a-z0-9_]{0,30}$'
   and exists (select 1 from public.service_categories c
                where c.company_id = s.company_id
                  and c.code = app.slug_categoria(s.category));

-- PASO 2 · Los que no tienen nada, por lo que dice su nombre.
--
-- El orden de las ramas NO es alfabético y es lo que hace que acierte:
-- «Brillado de faroles» es brillado y no detallado, y «Cuidado de cover» es
-- detallado y no un paquete. La primera que casa gana, así que lo específico va
-- antes que lo genérico.
with normalizado as (
  select id,
         lower(translate(name, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) as n
  from public.services
  where coalesce(trim(category), '') = ''
     or category !~ '^[a-z][a-z0-9_]{0,30}$'
)
update public.services s
   set category = case
     when x.n ~ 'brillad|pulid|abrillanta'                          then 'brillado'
     when x.n ~ 'cera|encerad|wax'                                  then 'encerado'
     when x.n ~ 'reparacion|pintura|ribete|desabolla|abolladura'    then 'reparacion'
     when x.n ~ 'tratamiento|protector|proteccion|leather|cuero|sellad' then 'tratamiento'
     when x.n ~ 'cover|motor|faro|headlight|detallad|detalle'       then 'detallado'
     when x.n ~ 'lavad|aspirad|limpiez|shampoo|espuma'              then 'lavado'
     when x.n ~ 'cuidado|paquete|combo|full'                        then 'paquete'
     else 'otros'
   end
  from normalizado x
 where s.id = x.id;

-- --------------------------------------------------------------------- RLS
alter table public.service_categories enable row level security;
alter table public.service_categories force  row level security;

drop policy if exists service_categories_select on public.service_categories;
create policy service_categories_select on public.service_categories
  for select to authenticated using (app.belongs_to_tenant(company_id));

-- Sin políticas de escritura: solo entran por las RPC de abajo, que comprueban
-- el rol. Es el mismo trato que vehicle_categories.
grant select on public.service_categories to authenticated;

-- ------------------------------------------------------------ Crear categoría
create or replace function public.create_service_category(
  p_label      text,
  p_code       text default null,
  p_sort_order integer default null
)
returns public.service_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_code    text := coalesce(nullif(app.slug_categoria(coalesce(p_code, p_label)), ''), '');
  v_order   integer;
  v_row     public.service_categories;
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.';
  end if;
  -- Los mismos roles que ya pueden tocar el catálogo (services_write). No se
  -- reserva al superadmin como en las categorías de vehículo: aquellas mueven
  -- el enum del que cuelga el cálculo del cobro, y esto solo agrupa.
  if not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Solo el propietario o un administrador puede crear categorías de servicio.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_code = '' or v_code !~ '^[a-z][a-z0-9_]{0,30}$' then
    raise exception 'El nombre de la categoría no es válido: use letras (por ejemplo, "Encerado").'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.service_categories
             where company_id = v_company and code = v_code) then
    raise exception 'Ya existe una categoría de servicio con ese nombre.'
      using errcode = 'unique_violation';
  end if;

  select coalesce(p_sort_order, coalesce(max(sort_order), 0) + 10)
    into v_order
    from public.service_categories where company_id = v_company;

  insert into public.service_categories (company_id, code, label, sort_order)
  values (v_company, v_code, trim(p_label), v_order)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_service_category(text, text, integer) to authenticated;

-- ----------------------------------------------------------- Editar categoría
create or replace function public.update_service_category(
  p_id         uuid,
  p_label      text default null,
  p_sort_order integer default null,
  p_is_active  boolean default null
)
returns public.service_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_row     public.service_categories;
begin
  if not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Solo el propietario o un administrador puede editar categorías de servicio.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.service_categories set
    label      = coalesce(nullif(trim(p_label), ''), label),
    sort_order = coalesce(p_sort_order, sort_order),
    is_active  = coalesce(p_is_active, is_active)
  where id = p_id and company_id = v_company
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Categoría inexistente o fuera de su alcance.'
      using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

comment on function public.update_service_category is
  'Edita etiqueta, orden o visibilidad. Desactivar NO reclasifica los servicios: '
  'siguen guardando su code y vuelven a agruparse si se reactiva.';

grant execute on function public.update_service_category(uuid, text, integer, boolean) to authenticated;

-- ============================================================================
-- QUE NADIE PUEDA ESCRIBIR UNA CATEGORÍA QUE EL FILTRO NO ENTIENDA
-- ============================================================================
-- `services.category` no la escribe solo la pantalla del catálogo: también
-- entra por la importación de CSV (`import_batch`), donde alguien teclea
-- «Lavados» o «brillado» en una celda de Excel. Si eso se guardase tal cual,
-- el servicio quedaría apuntando a un código que no existe y desaparecería del
-- filtro sin decir por qué — el mismo fallo silencioso que ya costó una tarde
-- con la marca de Membego.
--
-- Se arregla en la base y no en cada llamador: un disparador normaliza lo que
-- entre, venga de donde venga. Busca la categoría de tres formas, de la más
-- exacta a la más humana:
--
--   1. ¿Es ya un código válido de la empresa?  Se deja.
--   2. ¿Coincide con la ETIQUETA de alguna?    Se traduce a su código. Esto es
--      lo que hace que exportar a Excel, editar y reimportar funcione: el CSV
--      lleva «Brillado y pulido» y vuelve convertido en `brillado`.
--   3. ¿Su versión normalizada da un código?   Se crea la categoría con el
--      texto original como etiqueta. Un tipo de trabajo nuevo escrito en una
--      celda entra al catálogo en vez de perderse.
--
-- Lo que no da ningún código válido se queda vacío: sin categoría, visible en
-- el filtro como «Sin categoría», que es donde se puede encontrar y arreglar.
create or replace function app.normalizar_categoria_servicio()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_texto text := trim(coalesce(new.category, ''));
  v_slug  text;
  v_code  text;
begin
  if v_texto = '' then
    new.category := '';
    return new;
  end if;

  -- 1) Ya es un código de esta empresa.
  select code into v_code from public.service_categories
   where company_id = new.company_id and code = v_texto;
  if v_code is not null then
    new.category := v_code;
    return new;
  end if;

  -- 2) Es la etiqueta de una que ya existe.
  select code into v_code from public.service_categories
   where company_id = new.company_id and lower(label) = lower(v_texto)
   limit 1;
  if v_code is not null then
    new.category := v_code;
    return new;
  end if;

  -- 3) Da un código válido: se crea la categoría con el texto como etiqueta.
  v_slug := app.slug_categoria(v_texto);
  if v_slug ~ '^[a-z][a-z0-9_]{0,30}$' then
    insert into public.service_categories (company_id, code, label, sort_order)
    values (new.company_id, v_slug, v_texto,
            coalesce((select max(sort_order) + 10 from public.service_categories
                       where company_id = new.company_id), 100))
    on conflict (company_id, code) do nothing;
    new.category := v_slug;
    return new;
  end if;

  -- Nada de lo anterior: mejor sin categoría que apuntando a la nada.
  new.category := '';
  return new;
end;
$$;

drop trigger if exists services_normalizar_categoria on public.services;
create trigger services_normalizar_categoria
  before insert or update of category on public.services
  for each row execute function app.normalizar_categoria_servicio();

comment on function app.normalizar_categoria_servicio is
  'Traduce lo que se escriba en services.category —código, etiqueta o texto '
  'libre de un CSV— al código de una categoría real, creándola si hace falta.';
