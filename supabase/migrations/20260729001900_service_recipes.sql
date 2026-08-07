-- =============================================================================
-- 0021 · Recetas de insumos y costo real por servicio
-- =============================================================================
-- El sistema conocía el precio de venta y la comisión, pero no cuánto CUESTA
-- ejecutar cada lavado: un galón de champú se consume en decenas de servicios
-- sin pasar por el POS. Este módulo lo resuelve:
--
--   · service_recipes: qué insumos consume cada servicio y en qué cantidad
--     (fracción de la unidad del producto: 0.120 galones), con variante por
--     categoría de vehículo (NULL = todas).
--   · service_consumptions: el consumo EXACTO registrado al entregar cada
--     orden, con su costo — la materia prima de los reportes de margen.
--   · products.stock_frac: acumulador de la fracción consumida de la unidad
--     abierta. El kardex sigue siendo entero: registra 'consumo' cuando se
--     completa una unidad entera (se terminó un galón).
--   · advance_work_order se reinstala llamando a app.consume_recipes al
--     entregar (SECURITY DEFINER: el operario entrega sin necesitar permiso
--     directo de escritura sobre products).
-- =============================================================================

-- Acumulador de fracción consumida de la unidad "abierta" (0 <= f < 1).
alter table public.products
  add column stock_frac numeric(8,3) not null default 0
  check (stock_frac >= 0 and stock_frac < 1);

-- ------------------------------------------------------------------- Recetas
create table public.service_recipes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  service_id       uuid not null,
  product_id       uuid not null,
  -- NULL = aplica a todas las categorías; una fila específica la sobreescribe.
  vehicle_category app.vehicle_category,
  quantity         numeric(12,3) not null check (quantity > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint service_recipes_service_same_company
    foreign key (service_id, company_id) references public.services(id, company_id) on delete cascade,
  constraint service_recipes_product_same_company
    foreign key (product_id, company_id) references public.products(id, company_id) on delete cascade,
  -- Una sola fila por (servicio, insumo, categoría), incluida la genérica.
  unique nulls not distinct (service_id, product_id, vehicle_category)
);

create index service_recipes_service_idx on public.service_recipes (service_id);

create trigger service_recipes_touch before update on public.service_recipes
  for each row execute function app.touch_updated_at();

alter table public.service_recipes enable row level security;
alter table public.service_recipes force  row level security;

create policy service_recipes_select on public.service_recipes
  for select to authenticated using (app.belongs_to_tenant(company_id));

create policy service_recipes_write on public.service_recipes
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id)
              and app.has_role('propietario', 'administrador', 'superadmin'));

grant select, insert, update, delete on public.service_recipes to authenticated;

-- ------------------------------------------------------- Consumos registrados
create table public.service_consumptions (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  service_id    uuid,
  product_id    uuid not null,
  quantity      numeric(12,3) not null check (quantity > 0),
  cost_cents    bigint not null default 0 check (cost_cents >= 0),
  created_at    timestamptz not null default now(),
  constraint service_consumptions_product_same_company
    foreign key (product_id, company_id) references public.products(id, company_id) on delete cascade
);

create index service_consumptions_order_idx   on public.service_consumptions (work_order_id);
create index service_consumptions_company_idx on public.service_consumptions (company_id, created_at desc);

alter table public.service_consumptions enable row level security;
alter table public.service_consumptions force  row level security;

create policy service_consumptions_select on public.service_consumptions
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.service_consumptions to authenticated;

-- ------------------------------------------------------ Consumo al entregar
-- SECURITY DEFINER: la llama advance_work_order (invoker); el operario que
-- entrega no necesita permiso directo de escritura sobre products.
create or replace function app.consume_recipes(p_company uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order  public.work_orders;
  v_line   record;
  v_prod   public.products;
  v_newfrac numeric(12,3);
  v_whole  integer;
begin
  select * into v_order from public.work_orders
  where id = p_order_id and company_id = p_company;
  if v_order.id is null then
    return;
  end if;

  -- Por cada servicio de la orden: la fila de receta ESPECÍFICA de la
  -- categoría del vehículo gana; si no hay, aplica la genérica (NULL).
  for v_line in
    select r.product_id,
           i.service_id,
           sum(r.quantity * i.quantity) as qty
    from public.work_order_items i
    join lateral (
      select distinct on (r0.product_id) r0.product_id, r0.quantity
      from public.service_recipes r0
      where r0.company_id = p_company
        and r0.service_id = i.service_id
        and (r0.vehicle_category = v_order.vehicle_category or r0.vehicle_category is null)
      order by r0.product_id, r0.vehicle_category nulls last
    ) r on true
    where i.work_order_id = p_order_id and i.item_type = 'service'
    group by r.product_id, i.service_id
  loop
    select * into v_prod from public.products
    where id = v_line.product_id and company_id = p_company
    for update;
    if v_prod.id is null then
      continue;
    end if;

    -- Registro EXACTO del consumo con su costo (para el margen real).
    insert into public.service_consumptions (
      company_id, work_order_id, service_id, product_id, quantity, cost_cents
    ) values (
      p_company, p_order_id, v_line.service_id, v_line.product_id, v_line.qty,
      round(v_line.qty * v_prod.cost_cents)
    );

    -- El kardex es entero: la fracción se acumula y solo se descuenta la
    -- unidad cuando se completa (se terminó el envase).
    v_newfrac := v_prod.stock_frac + v_line.qty;
    v_whole   := floor(v_newfrac)::integer;

    if v_whole > 0 then
      perform set_config('app.inventory_ctx', jsonb_build_object(
        'kind', 'consumo', 'order_id', p_order_id, 'branch_id', v_order.branch_id,
        'reason', format('Consumo por recetas (%s unidades completadas)', v_whole)
      )::text, true);

      update public.products
         set stock = stock - v_whole,
             stock_frac = v_newfrac - v_whole
       where id = v_prod.id and company_id = p_company;
    else
      -- Sin unidad completa: solo avanza el acumulador (sin tocar stock, el
      -- guardia no interviene).
      update public.products
         set stock_frac = v_newfrac
       where id = v_prod.id and company_id = p_company;
    end if;
  end loop;
end;
$$;

-- ------------------------------------- Costo estimado por servicio/categoría
-- Para la pantalla de servicios y los reportes: cuánto cuesta ejecutar el
-- servicio HOY (recetas × último costo), eligiendo la fila específica de la
-- categoría cuando existe.
create or replace function public.service_recipe_cost(
  p_service_id uuid,
  p_vehicle_category app.vehicle_category default null
)
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(round(r.quantity * p.cost_cents)), 0)::bigint
  from (
    select distinct on (r0.product_id) r0.product_id, r0.quantity
    from public.service_recipes r0
    where r0.service_id = p_service_id
      and (p_vehicle_category is null
           or r0.vehicle_category = p_vehicle_category
           or r0.vehicle_category is null)
    order by r0.product_id, r0.vehicle_category nulls last
  ) r
  join public.products p on p.id = r.product_id
$$;

grant execute on function public.service_recipe_cost(uuid, app.vehicle_category) to authenticated;

-- ------------------------------------------- advance_work_order reinstalada
-- Cuerpo canónico de 0010 con el consumo por recetas al entregar.

create or replace function public.advance_work_order(
  p_order_id     uuid,
  p_new_status   app.order_status,
  p_bay_id       uuid   default null,
  p_assignees    uuid[] default null
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_order    public.work_orders;
  v_bay      public.bays;
  v_result   public.work_orders;
  v_rows     integer;
  v_profile  uuid;
  v_service  record;
  v_n        integer;
  v_share    bigint;
  v_bps      integer;
begin
  v_company := app.current_company_id();

  -- FOR UPDATE serializa a dos operarios moviendo la misma tarjeta a la vez.
  select * into v_order from public.work_orders
  where id = p_order_id and company_id = v_company
  for update;

  if v_order.id is null then
    raise exception 'Orden % inexistente o fuera de su alcance', p_order_id
      using errcode = 'no_data_found';
  end if;

  if not app.order_transition_allowed(v_order.status, p_new_status) then
    raise exception 'No se puede pasar de "%" a "%"', v_order.status, p_new_status
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------------------- Bahía
  if p_new_status = 'en_proceso' then
    if p_bay_id is null then
      raise exception 'Iniciar el lavado exige indicar la bahía'
        using errcode = 'invalid_parameter_value';
    end if;

    select * into v_bay from public.bays
    where id = p_bay_id and company_id = v_company
    for update;

    if v_bay.id is null then
      raise exception 'Bahía inexistente' using errcode = 'no_data_found';
    end if;
    if v_bay.branch_id <> v_order.branch_id then
      raise exception 'La bahía pertenece a otra sucursal' using errcode = 'check_violation';
    end if;
    if v_bay.status = 'mantenimiento' then
      raise exception 'La bahía "%" está en mantenimiento', v_bay.name
        using errcode = 'check_violation';
    end if;
    -- Comprobación de capacidad que no existía: el Kanban auditado metía TODOS
    -- los vehículos en 'bay-1'.
    if v_bay.current_work_order_id is not null and v_bay.current_work_order_id <> p_order_id then
      raise exception 'La bahía "%" ya está ocupada', v_bay.name
        using errcode = 'unique_violation';
    end if;

    update public.bays
       set status = 'ocupada', current_work_order_id = p_order_id
     where id = p_bay_id;

  elsif v_order.status = 'en_proceso' then
    -- Sale de lavado: la bahía queda libre.
    update public.bays
       set status = 'disponible', current_work_order_id = null, assigned_profile_id = null
     where current_work_order_id = p_order_id and company_id = v_company;
  end if;

  -- --------------------------------------------------------- Operarios
  if p_assignees is not null then
    delete from public.work_order_assignees where work_order_id = p_order_id;
    foreach v_profile in array p_assignees loop
      insert into public.work_order_assignees (work_order_id, profile_id, company_id)
      values (p_order_id, v_profile, v_company)
      on conflict do nothing;
    end loop;
  end if;

  update public.work_orders
     set status = p_new_status,
         bay_id = case when p_new_status = 'en_proceso' then p_bay_id
                       when v_order.status = 'en_proceso' then null
                       else bay_id end
   where id = p_order_id
  returning * into v_result;

  get diagnostics v_rows = row_count;
  -- RLS filtra en silencio en UPDATE: sin esto, un cambio denegado se
  -- mostraría al operario como realizado.
  if v_rows = 0 then
    raise exception 'No tiene permiso para modificar esta orden'
      using errcode = 'insufficient_privilege';
  end if;

  -- -------------------------------------------------------- Comisiones
  -- Se generan al entregar, que es cuando el trabajo está cobrado y cerrado.
  -- En la aplicación auditada la tabla existía y nada la alimentaba.
  if p_new_status = 'entregado' then
    -- Consumo de insumos por receta (0021): descuenta el inventario según lo
    -- definido para cada servicio de la orden y deja el costo real registrado.
    perform app.consume_recipes(v_company, p_order_id);

    select count(*) into v_n from public.work_order_assignees where work_order_id = p_order_id;

    if v_n > 0 then
      for v_service in
        select i.id, i.name, i.service_id,
               (i.unit_price_cents * i.quantity - i.discount_cents) as line_cents,
               coalesce(s.commission_bps, 0) as service_bps
        from public.work_order_items i
        left join public.services s on s.id = i.service_id
        where i.work_order_id = p_order_id and i.item_type = 'service'
      loop
        -- Reparto exacto entre los operarios: la división entera se hace sobre
        -- la base, no sobre el importe, para no perder centavos por redondeo.
        v_share := v_service.line_cents / v_n;

        insert into public.commissions (
          company_id, branch_id, profile_id, work_order_id, work_order_item_id,
          service_name, base_cents, commission_bps, amount_cents
        )
        select v_company, v_order.branch_id, a.profile_id, p_order_id, v_service.id,
               v_service.name, v_share,
               coalesce(nullif(p.commission_bps, 0), v_service.service_bps),
               round(v_share::numeric
                     * coalesce(nullif(p.commission_bps, 0), v_service.service_bps) / 10000)::bigint
        from public.work_order_assignees a
        join public.profiles p on p.id = a.profile_id
        where a.work_order_id = p_order_id;
      end loop;
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (v_company, v_order.branch_id, 'CAMBIO_ESTADO_ORDEN', 'WorkOrder', p_order_id::text,
          'Orden ' || v_order.order_number || ': ' || v_order.status || ' → ' || p_new_status,
          jsonb_build_object('from', v_order.status, 'to', p_new_status, 'bay_id', p_bay_id));

  return v_result;
end;
$$;

comment on function public.advance_work_order is
  'Cambio de estado atómico: valida la transición, ocupa o libera la bahía, asigna operarios y genera comisiones al entregar.';

grant execute on function public.advance_work_order to authenticated;

comment on table public.service_recipes is
  'Insumos que consume cada servicio (fracción de la unidad del producto), con '
  'variante por categoría de vehículo. Se aplican al entregar la orden.';
comment on table public.service_consumptions is
  'Consumo exacto registrado al entregar cada orden, con su costo: la base del '
  'margen real por servicio.';
