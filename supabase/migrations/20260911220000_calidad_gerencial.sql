-- =============================================================================
-- CALIDAD COMO HERRAMIENTA GERENCIAL
-- =============================================================================
-- El módulo de Calidad solo configura el checklist; la revisión ocurre en la
-- Cola. Eso se mantiene, pero el dueño necesita además la lectura gerencial:
-- «¿cuántos aprobamos a la primera?, ¿quién acumula reprocesos?, ¿qué servicio
-- da más problemas?». Todo está en qc_reviews; faltaba agregarlo.
--
--   · qc_summary(from, to)       — la foto: aprobación a la primera, reprocesos,
--                                 causas, lavadores y servicios con más problemas.
--   · qc_history_page(...)       — el historial filtrable de revisiones.
--
-- El KPI que importa es la TASA DE APROBACIÓN A LA PRIMERA: un lavado que pasa
-- calidad al primer intento no se rehace, y no rehacer es margen.
-- =============================================================================

create or replace function public.qc_summary(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_tz      text;
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el control de calidad.'
      using errcode = 'insufficient_privilege';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  with revisiones as (
    select r.* from public.qc_reviews r
    where r.company_id = v_company
      and (p_from is null or p_to is null
           or app.dia_operativo(r.created_at, v_tz) between p_from and p_to)
  )
  select jsonb_build_object(
    'vehiculos_revisados', (select count(distinct work_order_id) from revisiones),
    'revisiones', (select count(*) from revisiones),
    'aprobados_primera', (select count(*) from revisiones where result = 'aprobado' and attempt = 1),
    'rechazados', (select count(*) from revisiones where result = 'rechazado'),
    -- Aprobación a la primera: sobre los vehículos revisados, cuántos pasaron
    -- en el intento 1. Es el indicador que resume la calidad del taller.
    'tasa_aprobacion_primera', (
      select case when count(distinct work_order_id) = 0 then null
             else round(count(distinct work_order_id) filter (where result = 'aprobado' and attempt = 1)
                        * 100.0 / count(distinct work_order_id))::int end
      from revisiones),
    'tasa_reproceso', (
      select case when count(*) = 0 then null
             else round(count(*) filter (where result = 'rechazado') * 100.0 / count(*))::int end
      from revisiones),
    -- Las causas más frecuentes de rechazo.
    'causas', coalesce((
      select jsonb_agg(jsonb_build_object('motivo', motivo, 'veces', n) order by n desc)
      from (select reject_reason motivo, count(*) n from revisiones
            where result = 'rechazado' and reject_reason is not null
            group by reject_reason order by n desc limit 8) t), '[]'::jsonb),
    -- Los lavadores con más reprocesos.
    'lavadores_top', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'reprocesos', n) order by n desc)
      from (select p.full_name name, count(*) n from revisiones r
            join public.profiles p on p.id = r.washer_id
            where r.result = 'rechazado'
            group by p.id, p.full_name order by n desc limit 8) t), '[]'::jsonb),
    -- Los servicios que más aparecen en órdenes rechazadas.
    'servicios_top', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'veces', n) order by n desc)
      from (select i.name, count(distinct r.id) n
            from revisiones r
            join public.work_order_items i on i.work_order_id = r.work_order_id and i.item_type = 'service'
            where r.result = 'rechazado'
            group by i.name order by n desc limit 8) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.qc_summary(date, date) to authenticated;

comment on function public.qc_summary is
  'Resumen gerencial de calidad: aprobación a la primera, reprocesos, causas, '
  'y lavadores y servicios con más problemas.';

-- ── Historial de revisiones ─────────────────────────────────────────────────
create or replace function public.qc_history_page(
  p_from      date default null,
  p_to        date default null,
  p_washer_id uuid default null,
  p_result    text default null,
  p_page      integer default 0,
  p_size      integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_tz      text;
  v_total   bigint;
  v_rows    jsonb;
  v_size    integer := least(greatest(coalesce(p_size, 25), 1), 200);
  v_page    integer := greatest(coalesce(p_page, 0), 0);
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar el control de calidad.'
      using errcode = 'insufficient_privilege';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  create temporary table _qc on commit drop as
  select r.id, r.attempt, r.result, r.reject_reason, r.created_at,
         r.washer_id, r.reviewer_id, o.order_number, o.vehicle_plate
    from public.qc_reviews r
    join public.work_orders o on o.id = r.work_order_id
   where r.company_id = v_company
     and (p_from is null or p_to is null
          or app.dia_operativo(r.created_at, v_tz) between p_from and p_to)
     and (p_washer_id is null or r.washer_id = p_washer_id)
     and (p_result is null or r.result = p_result::app.qc_result);

  select count(*) into v_total from _qc;

  select coalesce(jsonb_agg(fila order by created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'id', q.id, 'order_number', q.order_number, 'vehicle_plate', q.vehicle_plate,
      'attempt', q.attempt, 'result', q.result, 'reject_reason', q.reject_reason,
      'created_at', q.created_at,
      'washer', (select full_name from public.profiles where id = q.washer_id),
      'reviewer', (select full_name from public.profiles where id = q.reviewer_id),
      'servicios', (select string_agg(i.name, ', ')
                      from public.work_order_items i
                     where i.work_order_id = (select work_order_id from public.qc_reviews where id = q.id)
                       and i.item_type = 'service')
    ) as fila, q.created_at
    from _qc q order by q.created_at desc
    limit v_size offset v_page * v_size
  ) t;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

grant execute on function public.qc_history_page(date, date, uuid, text, integer, integer) to authenticated;

comment on function public.qc_history_page is
  'Historial de revisiones de calidad, filtrable por periodo, lavador y '
  'resultado, con la orden, el vehículo, el servicio, el revisor y el motivo.';
