-- =============================================================================
-- ASIGNAR EL LAVADO DE UN PLAN, DESDE EL SERVIDOR
--
-- La pantalla guardaba con un `upsert ... on conflict (company_id, plan_name)`,
-- y la base contestaba:
--
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
--
-- El índice único de `membego_plan_coberturas` es sobre una EXPRESIÓN
-- —`(company_id, lower(trim(plan_name)))`, para que «Plan Gold» y «PLAN GOLD »
-- sean el mismo plan— y `ON CONFLICT` desde PostgREST solo sabe nombrar
-- columnas planas: no puede referirse a un índice de expresión.
--
-- La salida fácil sería aflojar el índice a `(company_id, plan_name)`. Sería un
-- error: entonces el mismo plan escrito con otras mayúsculas entraría dos
-- veces, la caja encontraría una u otra según cómo viniera el nombre de
-- Membego, y el tope de la membresía —o sea, lo que se cobra— dependería de un
-- espacio de más. Un cobro no puede ser una lotería tipográfica.
--
-- Así que el guardado baja al servidor, que sí puede escribir la expresión. De
-- paso resuelve dos cosas que el cliente hacía mal o no hacía:
--
--   · La empresa sale de `app.current_company_id()`, no de una consulta suelta
--     a `profiles` desde el navegador.
--   · Quitar la asignación borra por el nombre NORMALIZADO; antes borraba por
--     igualdad exacta y dejaba huérfana la fila escrita de otra forma.
-- =============================================================================

-- Los privilegios por defecto del esquema (migración 0010) conceden `select,
-- insert, update` a las tablas nuevas, pero NO `delete`. Quitar la asignación de
-- un plan es un borrado, así que hay que concederlo a mano: sin esto la función
-- se estrellaba con «permission denied for table», que no es la RLS diciendo
-- que no —eso sería otro mensaje— sino la falta del permiso base.
grant delete on public.membego_plan_coberturas to authenticated;

create or replace function public.membego_asignar_lavado_del_plan(
  p_plan_name  text,
  p_service_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_plan    text := trim(coalesce(p_plan_name, ''));
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  if length(v_plan) = 0 then
    raise exception 'Falta el nombre del plan.' using errcode = 'invalid_parameter_value';
  end if;

  -- El rol NO se comprueba aquí a mano: la función es `security invoker`, así
  -- que la política `membego_plan_coberturas_write` decide, y un cajero se
  -- estrella contra ella igual que si escribiera la tabla directamente. Una
  -- comprobación duplicada aquí sería una segunda verdad que mantener.

  if p_service_id is null then
    delete from public.membego_plan_coberturas
     where company_id = v_company
       and lower(trim(plan_name)) = lower(v_plan);
    return;
  end if;

  -- El servicio tiene que ser de ESTA empresa. Sin esto, un id copiado de otro
  -- inquilino quedaría escrito como tope de un plan propio.
  if not exists (
    select 1 from public.services
     where id = p_service_id and company_id = v_company
  ) then
    raise exception 'Servicio inexistente o fuera de su alcance.'
      using errcode = 'no_data_found';
  end if;

  update public.membego_plan_coberturas
     set service_id = p_service_id, is_active = true, plan_name = v_plan
   where company_id = v_company
     and lower(trim(plan_name)) = lower(v_plan);

  if not found then
    insert into public.membego_plan_coberturas (company_id, plan_name, service_id)
    values (v_company, v_plan, p_service_id);
  end if;
end;
$$;

grant execute on function public.membego_asignar_lavado_del_plan(text, uuid) to authenticated;

comment on function public.membego_asignar_lavado_del_plan is
  'Asigna —o quita, con el servicio nulo— el lavado que incluye un plan de '
  'Membego. Casa el plan por su nombre normalizado, que es como lo guarda el '
  'índice único.';
