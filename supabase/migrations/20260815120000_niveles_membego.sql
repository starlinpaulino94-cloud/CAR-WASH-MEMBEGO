-- ============================================================================
-- 0038 · NIVEL TARIFARIO POR CATEGORÍA DE VEHÍCULO
--
-- Membego decide si una membresía cubre un carro comparando NÚMEROS, no
-- nombres: cada plan lleva un tope (`nivelTarifarioMax`) y cada categoría un
-- nivel. Un plan de nivel 1 cubre sedanes; una SUV de nivel 3 no le cabe.
--
-- Este car wash tiene sus propias categorías —sedan, suv, jeep, pickup, van,
-- truck, motorcycle, special— y en ninguna parte dice cuál vale 1 y cuál 3. Esa
-- equivalencia es una decisión DEL NEGOCIO: en un local una jeepeta y una SUV
-- son lo mismo y en otro no. Ponerla en el código sería congelar la tarifa de
-- alguien en un despliegue.
--
-- ────────────────────────────────────────────────────────────────────────────
-- SIN FILA = SIN NIVEL, Y ESO NO ES CERO
--
-- Una categoría sin configurar devuelve NULL, no 1. Con 1 por defecto, todas
-- las categorías cabrían en el plan más barato y el negocio regalaría lavados
-- de camión sin enterarse. Con NULL, quien consulta sabe que no lo sabe, y la
-- pantalla puede decir «configure el nivel de esta categoría» en vez de cobrar
-- mal en silencio.
-- ============================================================================

create table if not exists public.vehicle_category_levels (
  company_id  uuid not null references public.companies(id) on delete cascade,
  category    app.vehicle_category not null,
  -- El mismo número que `TipoVehiculo.nivelTarifario` en Membego. Se acota
  -- por arriba para atrapar el dedazo —un 30 en vez de un 3 haría que ningún
  -- plan cubriera nada y nadie sabría por qué.
  level       integer not null check (level between 1 and 9),
  updated_at  timestamptz not null default now(),
  primary key (company_id, category)
);

comment on table public.vehicle_category_levels is
  'Equivalencia entre las categorías de vehículo de este sistema y los niveles tarifarios de Membego. Sin fila = sin nivel configurado (NULL), nunca 1.';

alter table public.vehicle_category_levels enable row level security;
alter table public.vehicle_category_levels force  row level security;

-- Leer: cualquiera del inquilino. El mostrador necesita el nivel para saber si
-- la membresía cubre el carro que tiene delante.
drop policy if exists vehicle_category_levels_select on public.vehicle_category_levels;
create policy vehicle_category_levels_select on public.vehicle_category_levels
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Escribir: solo quien administra el catálogo. Cambiar un nivel cambia lo que
-- se le cobra a los clientes con membresía, así que no es una preferencia de
-- pantalla — es tarifa.
drop policy if exists vehicle_category_levels_write on public.vehicle_category_levels;
create policy vehicle_category_levels_write on public.vehicle_category_levels
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'));

-- DELETE explícito, y hace falta decir por qué: el esquema otorga por defecto
-- solo select/insert/update, porque aquí las cosas no se borran, se marcan —
-- una factura anulada sigue existiendo, una visita revertida también. Esta
-- tabla es la excepción por lo mismo que `work_order_assignees`: no guarda
-- historia, guarda una CONFIGURACIÓN vigente. Quitar la equivalencia de una
-- categoría no pierde ningún hecho del pasado; deja de haber una regla. La
-- alternativa —un nivel nulo en una fila que se queda— daría dos formas de
-- decir «sin configurar» y alguien acabaría comprobando solo una.
grant delete on public.vehicle_category_levels to authenticated;

create or replace function app.touch_vehicle_category_levels()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vehicle_category_levels_touch on public.vehicle_category_levels;
create trigger vehicle_category_levels_touch
  before update on public.vehicle_category_levels
  for each row execute function app.touch_vehicle_category_levels();

-- ────────────────────────────────────────────────────────────────────────────
-- Guardar el mapa entero de una vez.
--
-- Una fila por categoría con ocho llamadas dejaría el mapa a medias si la
-- tercera falla, y un mapa a medias cobra mal sin avisar. Esto entra completo
-- o no entra: es una sola transacción.
--
-- `p_niveles` es un objeto {categoria: nivel}. Una categoría con `null` BORRA
-- su fila —volver a «sin configurar» tiene que ser posible—, y una categoría
-- ausente del objeto se deja como estaba.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.set_vehicle_category_levels(p_niveles jsonb)
returns setof public.vehicle_category_levels
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_par     record;
  v_cat     app.vehicle_category;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'No tiene permiso para cambiar los niveles tarifarios'
      using errcode = 'insufficient_privilege';
  end if;
  if p_niveles is null or jsonb_typeof(p_niveles) <> 'object' then
    raise exception 'Se espera un objeto {categoria: nivel}' using errcode = 'invalid_parameter_value';
  end if;

  for v_par in select key, value from jsonb_each(p_niveles) loop
    -- La categoría se valida con un cast al enum: un nombre inventado revienta
    -- aquí con un mensaje claro en vez de guardarse y no coincidir nunca.
    begin
      v_cat := v_par.key::app.vehicle_category;
    exception when others then
      raise exception 'Categoría de vehículo desconocida: %', v_par.key
        using errcode = 'invalid_parameter_value';
    end;

    if jsonb_typeof(v_par.value) = 'null' then
      delete from public.vehicle_category_levels
       where company_id = v_company and category = v_cat;
    else
      insert into public.vehicle_category_levels (company_id, category, level)
      values (v_company, v_cat, (v_par.value #>> '{}')::integer)
      on conflict (company_id, category)
        do update set level = excluded.level;
    end if;
  end loop;

  insert into public.audit_logs (company_id, action, entity, entity_id, details)
  values (v_company, 'NIVELES_MEMBEGO', 'VehicleCategoryLevel', v_company::text,
          'Se actualizaron los niveles tarifarios: ' || p_niveles::text);

  return query
    select * from public.vehicle_category_levels
     where company_id = v_company
     order by level, category;
end;
$$;

revoke all on function public.set_vehicle_category_levels(jsonb) from public;
grant execute on function public.set_vehicle_category_levels(jsonb) to authenticated;

comment on function public.set_vehicle_category_levels is
  'Guarda el mapa completo de categorías a niveles de Membego en una transacción. null en una categoría la devuelve a «sin configurar».';
