-- =============================================================================
-- PARCHE 0037 · PROCEDENCIA DEL CLIENTE  ·  Editor SQL de Supabase
-- =============================================================================
-- Ejecútelo DESPUÉS de importacion_0035.sql. Pegue el archivo completo y dele
-- «Run».
--
-- Qué instala: la columna `customers.origin`, que dice si el cliente lo trajo
-- el car wash o llegó por la red de Membego, con la guardia que la sella al
-- crear el cliente y la vuelve inmutable después. Más el resumen
-- `customer_origin_summary()`, que separa clientes, visitas y facturación por
-- canal.
--
-- QUÉ LE HACE A SUS DATOS: un solo UPDATE, el del relleno inicial. Marca como
-- «de Membego» a los clientes que ya tienen identificador de Membego, y deja
-- al resto como propios del car wash. Es la única lectura posible del pasado.
-- Nada más se toca.
--
-- Se puede ejecutar las veces que quiera: el tipo no se duplica y el relleno
-- solo actúa sobre lo que aún no está marcado.
-- =============================================================================

do $idem$
begin
  create type app.customer_origin as enum ('carwash', 'membego');
exception when duplicate_object then
  null;  -- ya estaba: seguimos
end $idem$;

comment on type app.customer_origin is
  'De dónde vino el cliente. Hecho histórico: se sella al crearlo y no cambia.';

alter table public.customers
  add column if not exists origin app.customer_origin not null default 'carwash';

comment on column public.customers.origin is
  'Procedencia: «carwash» si lo registró el negocio, «membego» si llegó por la '
  'red de Membego. No confundir con membego_customer_id, que es el vínculo de '
  'HOY: un cliente propio puede vincularse después y sigue siendo propio.';

-- Sella lo que ya está. Única lectura posible del pasado: quien tiene
-- identificador de Membego, llegó por Membego.
update public.customers
   set origin = 'membego'
 where membego_customer_id is not null
   and origin <> 'membego';

-- El listado filtra por procedencia dentro de la empresa; sin este índice sería
-- un recorrido completo de la tabla en cada pulsación del filtro.
create index if not exists customers_company_origin_idx
  on public.customers (company_id, origin);

-- --------------------------------------------------------------- La guardia

create or replace function app.customers_origin_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- No se acepta lo que venga en la sentencia: se deduce de la fila.
    new.origin := case
      when new.membego_customer_id is not null then 'membego'
      else 'carwash'
    end::app.customer_origin;
    return new;
  end if;

  if new.origin is distinct from old.origin then
    raise exception
      'La procedencia de un cliente no se cambia: es de dónde vino, no lo que '
      'es hoy. Vincularlo a Membego no lo convierte en cliente de Membego.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function app.customers_origin_guard() is
  'Sella la procedencia al crear el cliente y la vuelve inmutable después.';

drop trigger if exists customers_origin_guard on public.customers;
create trigger customers_origin_guard
  before insert or update on public.customers
  for each row execute function app.customers_origin_guard();

-- ------------------------------------------------------------- El resumen

create or replace function public.customer_origin_summary(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public, app, pg_temp
as $$
  with rango as (
    select coalesce(p_from, current_date - 365) as desde,
           coalesce(p_to,   current_date)       as hasta
  ),
  base as (
    select c.origin,
           count(*)                                        as clientes,
           count(*) filter (where c.created_at::date
                            between (select desde from rango)
                                and (select hasta from rango)) as nuevos,
           coalesce(sum(c.total_visits), 0)                 as visitas,
           coalesce(sum(c.total_spent_cents), 0)            as consumo_historico_cents
    from public.customers c
    group by c.origin
  ),
  -- Lo facturado en el rango se cuenta sobre las facturas, no sobre el
  -- acumulado del cliente: el acumulado no sabe de fechas.
  facturado as (
    select c.origin,
           count(i.*)                            as facturas,
           coalesce(sum(i.total_cents), 0)::bigint as facturado_cents
    from public.invoices i
    join public.customers c on c.id = i.customer_id
    where not i.is_annulled
      and i.created_at::date between (select desde from rango)
                                 and (select hasta from rango)
    group by c.origin
  )
  select jsonb_build_object(
    'desde', (select desde from rango),
    'hasta', (select hasta from rango),
    'por_origen', coalesce(jsonb_object_agg(o.origin, jsonb_build_object(
        'clientes',        coalesce(b.clientes, 0),
        'nuevos',          coalesce(b.nuevos, 0),
        'visitas',         coalesce(b.visitas, 0),
        'consumo_historico_cents', coalesce(b.consumo_historico_cents, 0),
        'facturas',        coalesce(f.facturas, 0),
        'facturado_cents', coalesce(f.facturado_cents, 0)
      )), '{}'::jsonb)
  )
  -- Se parte del enum, no de las filas: un origen sin un solo cliente tiene que
  -- salir en cero, no desaparecer del informe.
  from (select unnest(enum_range(null::app.customer_origin))::text as origin) o
  left join base b      on b.origin::text = o.origin
  left join facturado f on f.origin::text = o.origin;
$$;

comment on function public.customer_origin_summary(date, date) is
  'Clientes, visitas y facturación separados por procedencia. RLS decide qué '
  'filas entran, así que un empleado limitado a una sucursal ve solo la suya.';

revoke all on function public.customer_origin_summary(date, date) from public;
grant execute on function public.customer_origin_summary(date, date) to authenticated;
