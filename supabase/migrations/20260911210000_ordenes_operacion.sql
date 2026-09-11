-- =============================================================================
-- ÓRDENES: OPERACIÓN CON TIEMPOS, FILTROS Y LÍNEA DE TIEMPO
-- =============================================================================
-- El listado de órdenes filtra por estado y busca por placa, pero no responde
-- las preguntas de operación: «¿qué carro lleva demasiado esperando?», «¿cuál
-- se pasó del tiempo estimado?», «¿cuánto tardó Pedro en promedio?». Los
-- timestamps para eso ya están en work_orders (arrival, started, finished,
-- delivered); faltaba una consulta que los restara y filtrara por lavador,
-- servicio, bahía, pago y periodo, todo en el servidor.
--
--   · orders_page(...)  — órdenes con tiempos calculados, banderas operativas
--                        y siete filtros combinables, paginadas.
--   · order_detail(id)  — la línea de tiempo de una orden: sus hitos, sus
--                        lavadores, servicios, calidad, pago e inspección.
--
-- Solo lectura. Las banderas son cálculos, no inventos: «atrasada» significa
-- que pasó su hora estimada y no se ha entregado, no una corazonada.
-- =============================================================================

create or replace function public.orders_page(
  p_branch_id  uuid,
  p_from       date default null,
  p_to         date default null,
  p_status     text default null,
  p_washer_id  uuid default null,
  p_service_id uuid default null,
  p_bay_id     uuid default null,
  p_payment    text default null,
  p_search     text default null,
  p_page       integer default 0,
  p_size       integer default 25
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
  v_busca   text := nullif(trim(coalesce(p_search, '')), '');
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and company_id = v_company) then
    raise exception 'Sucursal inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  select timezone into v_tz from public.companies where id = v_company;

  create temporary table _ord on commit drop as
  select o.*
    from public.work_orders o
   where o.company_id = v_company and o.branch_id = p_branch_id
     and (p_from is null or p_to is null
          or app.dia_operativo(o.arrival_at, v_tz) between p_from and p_to)
     and (p_status is null or p_status = 'all'
          or (p_status = 'active' and o.status in
              ('pendiente','en_espera','asignada','en_proceso','control_calidad','listo'))
          or o.status = p_status::app.order_status)
     and (p_bay_id is null or o.bay_id = p_bay_id)
     and (p_payment is null or o.payment_status = p_payment::app.payment_status)
     and (p_washer_id is null or exists (
           select 1 from public.work_order_assignees a
           where a.work_order_id = o.id and a.profile_id = p_washer_id))
     and (p_service_id is null or exists (
           select 1 from public.work_order_items i
           where i.work_order_id = o.id and i.service_id = p_service_id))
     and (v_busca is null
          or o.order_number ilike '%' || v_busca || '%'
          or o.vehicle_plate ilike '%' || v_busca || '%'
          or o.customer_name ilike '%' || v_busca || '%');

  select count(*) into v_total from _ord;

  select coalesce(jsonb_agg(fila order by arrival_at desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'id', o.id, 'order_number', o.order_number,
      'vehicle_plate', o.vehicle_plate, 'vehicle_make_model', o.vehicle_make_model,
      'customer_name', o.customer_name, 'status', o.status,
      'priority', o.priority, 'payment_status', o.payment_status,
      'total_cents', o.total_cents,
      'arrival_at', o.arrival_at, 'started_at', o.started_at,
      'finished_at', o.finished_at, 'delivered_at', o.delivered_at,
      'estimated_ready_at', o.estimated_ready_at,
      'es_membego', o.membego_customer_id is not null,
      'bay_name', (select name from public.bays where id = o.bay_id),
      'lavadores', (select string_agg(p.full_name, ', ')
                      from public.work_order_assignees a
                      join public.profiles p on p.id = a.profile_id
                     where a.work_order_id = o.id),
      'sin_lavador', not exists (select 1 from public.work_order_assignees a where a.work_order_id = o.id),
      -- Espera: de la llegada al inicio del lavado (o hasta ahora si no ha
      -- empezado y sigue activa). Duración: del inicio a la entrega.
      'espera_seg', case when o.started_at is not null
                         then extract(epoch from (o.started_at - o.arrival_at))::bigint
                         when o.status in ('pendiente','en_espera','asignada')
                         then extract(epoch from (now() - o.arrival_at))::bigint
                         else null end,
      'duracion_seg', case when o.started_at is not null and o.delivered_at is not null
                           then extract(epoch from (o.delivered_at - o.started_at))::bigint
                           when o.started_at is not null and o.finished_at is not null
                           then extract(epoch from (o.finished_at - o.started_at))::bigint
                           else null end,
      -- Banderas operativas. Son condiciones verificables, no corazonadas.
      'atrasada', o.estimated_ready_at is not null
                  and o.status not in ('entregado','cancelado','listo')
                  and now() > o.estimated_ready_at,
      'lista_sin_entregar', o.status = 'listo'
    ) as fila, o.arrival_at
    from _ord o
    order by o.arrival_at desc
    limit v_size offset v_page * v_size
  ) t;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'page', v_page, 'size', v_size);
end;
$$;

grant execute on function public.orders_page(uuid, date, date, text, uuid, uuid, uuid, text, text, integer, integer) to authenticated;

comment on function public.orders_page is
  'Órdenes con tiempos (espera, duración) y banderas operativas (atrasada, '
  'lista sin entregar, sin lavador), filtradas en el servidor por periodo, '
  'estado, lavador, servicio, bahía, pago y texto.';

-- ── Línea de tiempo de una orden ────────────────────────────────────────────
create or replace function public.order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_o       public.work_orders;
  v_result  jsonb;
begin
  if v_company is null then
    raise exception 'Sin empresa en el contexto.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_o from public.work_orders where id = p_order_id and company_id = v_company;
  if v_o.id is null then
    raise exception 'Orden inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    'id', v_o.id, 'order_number', v_o.order_number, 'status', v_o.status,
    'vehicle_plate', v_o.vehicle_plate, 'vehicle_make_model', v_o.vehicle_make_model,
    'vehicle_color', v_o.vehicle_color, 'customer_name', v_o.customer_name,
    'priority', v_o.priority, 'notes', v_o.notes,
    'total_cents', v_o.total_cents, 'payment_status', v_o.payment_status,
    'es_membego', v_o.membego_customer_id is not null,
    'bay_name', (select name from public.bays where id = v_o.bay_id),
    -- Los hitos, en orden. Cada uno con su hora; los nulos aún no ocurrieron.
    'hitos', jsonb_build_array(
      jsonb_build_object('clave', 'llegada', 'label', 'Llegó', 'at', v_o.arrival_at),
      jsonb_build_object('clave', 'inicio', 'label', 'Lavado iniciado', 'at', v_o.started_at),
      jsonb_build_object('clave', 'fin', 'label', 'Lavado terminado', 'at', v_o.finished_at),
      jsonb_build_object('clave', 'entrega', 'label', 'Entregado', 'at', v_o.delivered_at)
    ),
    'estimado', v_o.estimated_ready_at,
    'lavadores', coalesce((
      select jsonb_agg(p.full_name order by p.full_name)
      from public.work_order_assignees a join public.profiles p on p.id = a.profile_id
      where a.work_order_id = v_o.id), '[]'::jsonb),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'qty', quantity, 'price_cents', unit_price_cents, 'tipo', item_type))
      from public.work_order_items where work_order_id = v_o.id), '[]'::jsonb),
    -- Calidad: cada intento con su resultado y quién revisó.
    'calidad', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attempt', r.attempt, 'result', r.result, 'reject_reason', r.reject_reason,
        'reviewer', (select full_name from public.profiles where id = r.reviewer_id),
        'washer', (select full_name from public.profiles where id = r.washer_id),
        'created_at', r.created_at) order by r.attempt)
      from public.qc_reviews r where r.work_order_id = v_o.id), '[]'::jsonb),
    'inspeccion', (
      select jsonb_build_object('fuel_level', fuel_level, 'mileage', mileage,
                                'valuables', valuables, 'notes', notes, 'signed_at', signed_at)
      from public.vehicle_inspections where work_order_id = v_o.id
      order by created_at desc limit 1),
    'factura', (
      select jsonb_build_object('id', id, 'invoice_number', invoice_number,
                                'total_cents', total_cents, 'is_annulled', is_annulled)
      from public.invoices where work_order_id = v_o.id and not is_annulled
      order by created_at desc limit 1)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.order_detail(uuid) to authenticated;

comment on function public.order_detail is
  'La orden con su línea de tiempo (llegada→inicio→fin→entrega), lavadores, '
  'servicios, calidad, inspección y factura, para el detalle conectado.';
