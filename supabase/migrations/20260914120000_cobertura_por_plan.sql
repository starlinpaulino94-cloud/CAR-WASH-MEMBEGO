-- =============================================================================
-- QUÉ SERVICIO INCLUYE CADA PLAN DE MEMBEGO
--
-- Hasta ahora la cobertura se decidía con una casilla GLOBAL por servicio,
-- `services.included_in_membego`: «este lavado lo puede pagar una membresía».
-- Esa casilla no dice CUÁL. Con ella, marcar el «Lavado Premium» hace que
-- cualquier plan —incluido el más barato— lo absorba entero, y el lavadero
-- regala la diferencia en cada visita sin que nada lo delate.
--
-- El dato que faltaba ya estaba a mano: `memberships.plan_name`, que llega por
-- el webhook de Membego con el plan de cada cliente. Lo que no existía era la
-- otra mitad —qué lavado de ESTE catálogo incluye ese plan—, porque Membego no
-- la puede saber: su contrato dice que las tarifas del satélite son del
-- satélite. La pone el lavadero, aquí.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CÓMO SE USA EN LA CAJA
--
--   plan del cliente → su servicio incluido → precio de ESE servicio en la
--   categoría del vehículo = TOPE.
--
--   cubierto = min(tope, precio de lo que se vendió)
--   diferencia = el resto, que se cobra.
--
-- Un plan de «Lavado Básico» con un «Premium» de 1.500 y un básico de 900 cubre
-- 900 y cobra 600. Un plan de Premium al que se le hace un básico cubre los 900
-- enteros y no devuelve nada: una membresía da derecho a un lavado hasta cierto
-- valor, no a un saldo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- SI UN PLAN NO ESTÁ CONFIGURADO, NO SE ADIVINA
--
-- Hubo una versión que, sin saber el plan, tomaba el incluible más caro como
-- «lo que vale la membresía». Parecía razonable y era falso: a un cliente con
-- PLAN GOLD, cuya ficha decía «Cubre este vehículo», le cobró una diferencia
-- inventada. Un cobro inventado es peor que un cobro completo explicado: el
-- completo se discute en el mostrador y se corrige; el inventado tiene pinta de
-- correcto y se cobra mil veces. Sin fila aquí, la caja avisa y cobra entero.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ LA CLAVE ES EL NOMBRE DEL PLAN
--
-- Es lo único que Membego da tanto en el webhook (`memberships.plan_name`) como
-- en la ficha en vivo (`/benefits/evaluate` devuelve el `nombre` de la
-- membresía), así que es lo que permite casar al cliente que está en el
-- mostrador con lo que el dueño configuró. Los nombres traen a veces la
-- categoría dentro —«PLAN GOLD (SUV GRANDE)»— y eso es una ventaja, no un
-- estorbo: un plan de SUV grande puede incluir otro lavado que el de sedán, y
-- así se configuran por separado.
-- =============================================================================

create table if not exists public.membego_plan_coberturas (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- Tal como lo manda Membego. Se compara sin distinguir mayúsculas ni espacios
  -- de sobra: el mismo plan escrito «Plan Gold» y «PLAN GOLD » es el mismo plan,
  -- y hacer que dependa de eso convierte un cobro en una lotería.
  plan_name   text not null check (length(trim(plan_name)) > 0),
  service_id  uuid not null references public.services(id) on delete restrict,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists membego_plan_coberturas_unica
  on public.membego_plan_coberturas (company_id, lower(trim(plan_name)));

create index if not exists membego_plan_coberturas_empresa
  on public.membego_plan_coberturas (company_id) where is_active;

alter table public.membego_plan_coberturas enable row level security;
alter table public.membego_plan_coberturas force row level security;

-- Leer: cualquier empleado del inquilino. La caja lo necesita para calcular la
-- diferencia, y el mostrador entero cobra. Estrecharlo por rol repetiría el
-- fallo de `membego_company_links`, que dejaba a los cajeros sin ver su propio
-- vínculo y hacía que el sistema los acusara de ser otra empresa.
create policy membego_plan_coberturas_select on public.membego_plan_coberturas
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Escribir: los mismos que tocan el catálogo. Decidir qué cubre un plan es
-- decidir cuánto se cobra.
create policy membego_plan_coberturas_write on public.membego_plan_coberturas
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'superadmin'));

create trigger membego_plan_coberturas_touch
  before update on public.membego_plan_coberturas
  for each row execute function app.touch_updated_at();

comment on table public.membego_plan_coberturas is
  'Qué servicio del catálogo incluye cada plan de Membego. Sin fila, la caja no '
  'adivina: avisa y cobra el lavado completo.';

-- ── Los planes que el local ha visto, con su cobertura si la tiene ───────────
--
-- La pantalla de ajustes no puede pedir que se escriba el nombre del plan a
-- mano: un nombre mal tecleado no casa con nada y el fallo aparece días después
-- en la caja, sin pista de dónde mirar. Esta función devuelve los planes REALES
-- —los que han llegado por el webhook— para elegir de una lista.
create or replace function public.membego_planes_con_cobertura()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_filas   jsonb;
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(fila order by plan_name), '[]'::jsonb) into v_filas
  from (
    select p.plan_name,
           jsonb_build_object(
             'plan_name', p.plan_name,
             'clientes', p.clientes,
             'service_id', c.service_id,
             'service_name', s.name,
             'is_active', coalesce(c.is_active, false)
           ) as fila
    from (
      select m.plan_name, count(distinct m.customer_id) as clientes
        from public.memberships m
       where m.company_id = v_company
         and m.status = 'active'
         and length(trim(m.plan_name)) > 0
       group by m.plan_name
    ) p
    left join public.membego_plan_coberturas c
      on c.company_id = v_company
     and lower(trim(c.plan_name)) = lower(trim(p.plan_name))
    left join public.services s on s.id = c.service_id
  ) t;

  return v_filas;
end;
$$;

grant execute on function public.membego_planes_con_cobertura() to authenticated;

comment on function public.membego_planes_con_cobertura is
  'Los planes de Membego que este local ha visto, con cuántos clientes los '
  'tienen y qué servicio incluye cada uno (null si nadie lo ha configurado).';
