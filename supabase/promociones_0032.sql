-- =============================================================================
-- PARCHE 0032 (editor SQL de Supabase) · Promociones y descuentos controlados
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL (Production), DESPUÉS de los
-- parches 0028 (crédito), 0029 (flotillas), 0030 (nómina) y 0031 (sucursales).
-- Es idempotente: puedes correrlo más de una vez sin daño.
--
-- NO cambia lo que hoy se puede hacer: el techo del descuento manual nace en
-- 100 %, o sea, sin límite. Se baja desde Configuración › Empresa cuando el
-- dueño quiera.
-- =============================================================================

do $do$ begin
  create type app.promotion_kind as enum ('porcentaje', 'importe');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type app.promotion_scope as enum ('total', 'servicio', 'categoria');
exception when duplicate_object then null; end $do$;

alter table public.companies
  add column if not exists max_manual_discount_bps integer not null default 10000;

-- El CHECK va aparte: `add column if not exists` no lo recrea si la columna ya
-- existía, y `add constraint` no admite `if not exists`.
do $do$ begin
  alter table public.companies
    add constraint companies_max_discount_range
    check (max_manual_discount_bps between 0 and 10000);
exception when duplicate_object then null; end $do$;

comment on column public.companies.max_manual_discount_bps is
  'Techo del descuento manual, en puntos base sobre el subtotal (1000 = 10 %). '
  'La propiedad y la administración pueden superarlo; queda en la bitácora.';

-- ------------------------------------------------------------- Promociones
create table if not exists public.promotions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  code                  text not null check (length(trim(code)) > 0),
  name                  text not null check (length(trim(name)) > 0),
  kind                  app.promotion_kind  not null default 'porcentaje',
  scope                 app.promotion_scope not null default 'total',
  -- Según `kind` manda uno u otro. El RPC exige el que corresponde.
  value_bps             integer check (value_bps between 1 and 10000),
  value_cents           bigint  check (value_cents > 0),
  -- Según `scope`: a qué servicio o categoría se limita.
  service_id            uuid references public.services(id) on delete cascade,
  vehicle_category      app.vehicle_category,
  starts_on             date not null default current_date,
  ends_on               date,
  -- Días de la semana en que aplica, 0 = domingo … 6 = sábado. NULL = todos.
  -- Un car wash vive de esto: «martes de lavado», «lunes de camionetas».
  weekdays              smallint[],
  min_purchase_cents    bigint not null default 0 check (min_purchase_cents >= 0),
  max_uses              integer check (max_uses > 0),
  max_uses_per_customer integer check (max_uses_per_customer > 0),
  uses_count            integer not null default 0 check (uses_count >= 0),
  is_active             boolean not null default true,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, company_id),
  constraint promotions_range check (ends_on is null or ends_on >= starts_on),
  -- Cada modalidad exige su valor y solo el suyo: una promoción con los dos
  -- puestos no se sabría cómo cobrar.
  constraint promotions_value_matches_kind check (
    (kind = 'porcentaje' and value_bps is not null and value_cents is null) or
    (kind = 'importe'    and value_cents is not null and value_bps is null)
  ),
  constraint promotions_target_matches_scope check (
    (scope = 'total'     and service_id is null and vehicle_category is null) or
    (scope = 'servicio'  and service_id is not null) or
    (scope = 'categoria' and vehicle_category is not null)
  ),
  constraint promotions_weekdays_valid check (
    weekdays is null or (
      array_length(weekdays, 1) between 1 and 7
      and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    )
  )
);

-- El código es la llave que teclea el cajero: única e insensible a mayúsculas.
create unique index if not exists promotions_code_unique
  on public.promotions (company_id, upper(code));
create index if not exists promotions_active_idx on public.promotions (company_id) where is_active;

drop trigger if exists promotions_touch on public.promotions;
create trigger promotions_touch before update on public.promotions
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------- Canjes
create table if not exists public.promotion_redemptions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  promotion_id   uuid not null,
  invoice_id     uuid not null,
  customer_id    uuid,
  discount_cents bigint not null check (discount_cents >= 0),
  created_at     timestamptz not null default now(),
  -- Una promoción por factura: acumular varias es una decisión de negocio que
  -- nadie ha tomado, y permitirla por descuido sería regalar dinero.
  unique (company_id, invoice_id),
  constraint redemptions_promotion_same_company
    foreign key (promotion_id, company_id) references public.promotions(id, company_id) on delete cascade,
  constraint redemptions_invoice_same_company
    foreign key (invoice_id, company_id) references public.invoices(id, company_id) on delete cascade
);

create index if not exists redemptions_promotion_idx on public.promotion_redemptions (promotion_id);
create index if not exists redemptions_customer_idx on public.promotion_redemptions (customer_id)
  where customer_id is not null;

-- ------------------------------------------------------------------- RLS
alter table public.promotions            enable row level security;
alter table public.promotions            force  row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.promotion_redemptions force  row level security;

-- El catálogo de promociones lo lee todo el tenant: el cajero necesita saber
-- qué códigos existen. Escribir es otra cosa.
drop policy if exists promotions_select on public.promotions;
create policy promotions_select on public.promotions
  for select to authenticated using (app.belongs_to_tenant(company_id));
drop policy if exists redemptions_select on public.promotion_redemptions;
create policy redemptions_select on public.promotion_redemptions
  for select to authenticated using (app.belongs_to_tenant(company_id));

grant select on public.promotions, public.promotion_redemptions to authenticated;

-- =============================================================================
-- app.promotion_discount · la regla, en un solo sitio
-- =============================================================================
-- Devuelve el descuento que corresponde, o lanza el motivo por el que no. La
-- usan la previsualización del punto de venta y la emisión de la factura, para
-- que lo que se enseña y lo que se cobra no puedan divergir.
--
-- p_lines: [{ service_id, category, amount_cents }] — el importe YA calculado
-- por el servidor de cada línea, para poder acotar el alcance.
create or replace function app.promotion_discount(
  p_promotion  public.promotions,
  p_subtotal   bigint,
  p_customer_id uuid,
  p_lines      jsonb,
  p_as_of      date default current_date
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_base  bigint := 0;
  v_line  record;
  v_usos  integer;
begin
  if not p_promotion.is_active then
    raise exception 'La promoción % está desactivada.', p_promotion.code
      using errcode = 'check_violation';
  end if;
  if p_as_of < p_promotion.starts_on then
    raise exception 'La promoción % empieza el %.', p_promotion.code, p_promotion.starts_on
      using errcode = 'check_violation';
  end if;
  if p_promotion.ends_on is not null and p_as_of > p_promotion.ends_on then
    raise exception 'La promoción % venció el %.', p_promotion.code, p_promotion.ends_on
      using errcode = 'check_violation';
  end if;
  -- extract(dow) devuelve 0 = domingo, igual que el arreglo.
  if p_promotion.weekdays is not null
     and not (extract(dow from p_as_of)::smallint = any (p_promotion.weekdays)) then
    raise exception 'La promoción % no aplica hoy.', p_promotion.code
      using errcode = 'check_violation';
  end if;
  if p_subtotal < p_promotion.min_purchase_cents then
    raise exception 'La promoción % exige una compra mínima de % centavos.',
      p_promotion.code, p_promotion.min_purchase_cents using errcode = 'check_violation';
  end if;
  if p_promotion.max_uses is not null and p_promotion.uses_count >= p_promotion.max_uses then
    raise exception 'La promoción % agotó sus % usos.', p_promotion.code, p_promotion.max_uses
      using errcode = 'check_violation';
  end if;

  if p_promotion.max_uses_per_customer is not null then
    if p_customer_id is null then
      raise exception 'La promoción % es por cliente: seleccione a quién se le aplica.',
        p_promotion.code using errcode = 'invalid_parameter_value';
    end if;
    select count(*) into v_usos from public.promotion_redemptions
    where promotion_id = p_promotion.id and customer_id = p_customer_id;
    if v_usos >= p_promotion.max_uses_per_customer then
      raise exception 'Ese cliente ya usó la promoción % las % veces permitidas.',
        p_promotion.code, p_promotion.max_uses_per_customer using errcode = 'check_violation';
    end if;
  end if;

  -- Base sobre la que se calcula: todo, o solo las líneas que encajan.
  for v_line in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x(
      service_id   uuid,
      category     app.vehicle_category,
      amount_cents bigint
    )
  loop
    if p_promotion.scope = 'total'
       or (p_promotion.scope = 'servicio'  and v_line.service_id = p_promotion.service_id)
       or (p_promotion.scope = 'categoria' and v_line.category   = p_promotion.vehicle_category) then
      v_base := v_base + coalesce(v_line.amount_cents, 0);
    end if;
  end loop;

  if v_base <= 0 then
    raise exception 'La promoción % no aplica a nada de esta venta.', p_promotion.code
      using errcode = 'check_violation';
  end if;

  -- Un importe fijo mayor que la base no regala la diferencia: se topa.
  return case p_promotion.kind
    when 'porcentaje' then round(v_base::numeric * p_promotion.value_bps / 10000)::bigint
    else least(p_promotion.value_cents, v_base)
  end;
end;
$$;

comment on function app.promotion_discount is
  'Descuento que corresponde a una promoción, o el motivo por el que no aplica. '
  'Fuente única: la previsualización del punto de venta y la factura leen de aquí.';

-- =============================================================================
-- public.validate_promotion · previsualización para el punto de venta
-- =============================================================================
-- Nunca decide dinero: solo enseña lo que la factura volverá a calcular. Por
-- eso devuelve el motivo en vez de lanzar: el cajero necesita leerlo.
create or replace function public.validate_promotion(
  p_code        text,
  p_subtotal    bigint,
  p_lines       jsonb default '[]'::jsonb,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_promo   public.promotions;
  v_desc    bigint;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_promo from public.promotions
  where company_id = v_company and upper(code) = upper(trim(coalesce(p_code, '')));

  if v_promo.id is null then
    return jsonb_build_object('valid', false, 'reason', 'Ese código no existe.');
  end if;

  begin
    v_desc := app.promotion_discount(v_promo, p_subtotal, p_customer_id, p_lines);
  exception when others then
    return jsonb_build_object('valid', false, 'reason', sqlerrm,
                              'promotion_id', v_promo.id, 'name', v_promo.name);
  end;

  return jsonb_build_object(
    'valid', true,
    'promotion_id', v_promo.id,
    'code', v_promo.code,
    'name', v_promo.name,
    'discount_cents', v_desc
  );
end;
$$;

grant execute on function public.validate_promotion(text, bigint, jsonb, uuid) to authenticated;

comment on function public.validate_promotion is
  'Previsualiza una promoción para el punto de venta. El importe que vale es el que '
  'recalcula create_invoice al emitir.';

-- =============================================================================
-- Administración de promociones
-- =============================================================================
create or replace function public.upsert_promotion(
  p_code                  text,
  p_name                  text,
  p_kind                  app.promotion_kind,
  p_scope                 app.promotion_scope default 'total',
  p_promotion_id          uuid default null,
  p_value_bps             integer default null,
  p_value_cents           bigint default null,
  p_service_id            uuid default null,
  p_vehicle_category      app.vehicle_category default null,
  p_starts_on             date default null,
  p_ends_on               date default null,
  p_weekdays              smallint[] default null,
  p_min_purchase_cents    bigint default 0,
  p_max_uses              integer default null,
  p_max_uses_per_customer integer default null,
  p_is_active             boolean default true
)
returns public.promotions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_promo   public.promotions;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception 'Su rol no permite administrar promociones.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'La promoción necesita un código.' using errcode = 'check_violation';
  end if;
  if p_kind = 'porcentaje' and coalesce(p_value_bps, 0) <= 0 then
    raise exception 'Un descuento por porcentaje necesita su porcentaje.'
      using errcode = 'check_violation';
  end if;
  if p_kind = 'importe' and coalesce(p_value_cents, 0) <= 0 then
    raise exception 'Un descuento por importe necesita su importe.'
      using errcode = 'check_violation';
  end if;
  if p_scope = 'servicio' and p_service_id is null then
    raise exception 'Una promoción de un servicio necesita decir cuál.'
      using errcode = 'check_violation';
  end if;
  if p_scope = 'categoria' and p_vehicle_category is null then
    raise exception 'Una promoción por categoría necesita decir cuál.'
      using errcode = 'check_violation';
  end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and company_id = v_company
  ) then
    raise exception 'Servicio inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;

  if p_promotion_id is null then
    insert into public.promotions (
      company_id, code, name, kind, scope,
      value_bps, value_cents, service_id, vehicle_category,
      starts_on, ends_on, weekdays, min_purchase_cents,
      max_uses, max_uses_per_customer, is_active, created_by
    ) values (
      v_company, upper(trim(p_code)), trim(p_name), p_kind, p_scope,
      case when p_kind = 'porcentaje' then p_value_bps end,
      case when p_kind = 'importe'    then p_value_cents end,
      case when p_scope = 'servicio'  then p_service_id end,
      case when p_scope = 'categoria' then p_vehicle_category end,
      coalesce(p_starts_on, current_date), p_ends_on, p_weekdays,
      coalesce(p_min_purchase_cents, 0), p_max_uses, p_max_uses_per_customer,
      coalesce(p_is_active, true), auth.uid()
    )
    returning * into v_promo;
  else
    update public.promotions
       set code                  = upper(trim(p_code)),
           name                  = trim(p_name),
           kind                  = p_kind,
           scope                 = p_scope,
           value_bps             = case when p_kind = 'porcentaje' then p_value_bps end,
           value_cents           = case when p_kind = 'importe'    then p_value_cents end,
           service_id            = case when p_scope = 'servicio'  then p_service_id end,
           vehicle_category      = case when p_scope = 'categoria' then p_vehicle_category end,
           starts_on             = coalesce(p_starts_on, starts_on),
           ends_on               = p_ends_on,
           weekdays              = p_weekdays,
           min_purchase_cents    = coalesce(p_min_purchase_cents, 0),
           max_uses              = p_max_uses,
           max_uses_per_customer = p_max_uses_per_customer,
           is_active             = coalesce(p_is_active, is_active)
     where id = p_promotion_id and company_id = v_company
    returning * into v_promo;

    if v_promo.id is null then
      raise exception 'Promoción inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.audit_logs (company_id, action, entity, entity_id, details)
  values (v_company,
          case when p_promotion_id is null then 'CREAR_PROMOCION' else 'EDITAR_PROMOCION' end,
          'promotion', v_promo.id::text,
          format('%s · %s · %s', v_promo.code, v_promo.name,
                 case v_promo.kind when 'porcentaje'
                      then (v_promo.value_bps / 100)::text || '%'
                      else v_promo.value_cents::text || ' centavos' end));

  return v_promo;
end;
$$;

grant execute on function public.upsert_promotion(
  text, text, app.promotion_kind, app.promotion_scope, uuid, integer, bigint, uuid,
  app.vehicle_category, date, date, smallint[], bigint, integer, integer, boolean
) to authenticated;

-- =============================================================================
-- app.redeem_promotion · registra el canje (interno)
-- =============================================================================
-- La llama create_invoice, que es SECURITY INVOKER y no puede escribir aquí.
-- El FOR UPDATE sobre la promoción serializa dos cajas canjeando el último uso
-- disponible a la vez.
create or replace function app.redeem_promotion(
  p_code        text,
  p_company     uuid,
  p_invoice     public.invoices,
  p_subtotal    bigint,
  p_lines       jsonb,
  p_customer_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_promo public.promotions;
  v_desc  bigint;
begin
  select * into v_promo from public.promotions
  where company_id = p_company and upper(code) = upper(trim(coalesce(p_code, '')))
  for update;

  if v_promo.id is null then
    raise exception 'El código promocional % no existe.', p_code using errcode = 'no_data_found';
  end if;

  v_desc := app.promotion_discount(v_promo, p_subtotal, p_customer_id, p_lines);

  insert into public.promotion_redemptions (
    company_id, promotion_id, invoice_id, customer_id, discount_cents
  ) values (
    p_company, v_promo.id, p_invoice.id, p_customer_id, v_desc
  );

  update public.promotions set uses_count = uses_count + 1 where id = v_promo.id;

  return v_desc;
end;
$$;

-- =============================================================================
-- public.create_invoice · con techo al descuento y código promocional
-- =============================================================================
-- Cuerpo idéntico al de 0029. Lo único que cambia: el techo del descuento
-- manual, el código promocional —cuyo importe recalcula el servidor— y el
-- registro del canje. Como el parámetro nuevo va al final y con valor por
-- defecto, ninguna llamada existente cambia de significado; aun así, la versión
-- de doce argumentos se retira para que no quede una sobrecarga ambigua.
drop function if exists public.create_invoice(
  uuid, text, jsonb, jsonb, app.vehicle_category, uuid, uuid, text, text, text,
  app.ncf_type, uuid);

create or replace function public.create_invoice(
  p_branch_id         uuid,
  p_client_request_id text,
  p_items             jsonb,
  p_payments          jsonb,
  p_vehicle_category  app.vehicle_category default 'sedan',
  p_work_order_id     uuid    default null,
  p_customer_id       uuid    default null,
  p_customer_name     text    default 'Consumidor Final',
  p_customer_tax_id   text    default null,
  p_vehicle_plate     text    default null,
  p_ncf_type          app.ncf_type default null,
  p_cash_session_id   uuid    default null,
  p_promotion_code    text    default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company      uuid;
  v_existing     public.invoices;
  v_invoice      public.invoices;
  v_item         record;
  v_payment      record;
  v_price        bigint;
  v_subtotal     bigint := 0;
  v_discount     bigint := 0;
  v_membego      bigint := 0;
  v_taxable      bigint;
  v_rate_bps     integer;
  v_tax          bigint;
  v_total        bigint;
  v_paid         bigint := 0;
  v_cash_paid    bigint := 0;
  v_credit_paid  bigint := 0;
  v_methods      integer := 0;
  v_change       bigint;
  v_ncf          text := null;
  v_session      public.cash_sessions;
  v_credit       record;
  v_receivable   public.receivables;
  v_pay_status   app.payment_status;
  v_pay_method   app.payment_method;
  v_fleet        uuid;
  v_promo_disc   bigint := 0;
  v_promo_lines  jsonb  := '[]'::jsonb;
  v_max_bps      integer;
  v_rows         integer;
begin
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'Falta la clave de idempotencia (p_client_request_id)'
      using errcode = 'invalid_parameter_value';
  end if;

  v_company := app.current_company_id();
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------- Idempotencia
  -- Un segundo clic sobre "Cobrar" devuelve la MISMA factura en lugar de emitir
  -- otra, duplicar el descuento de stock y volver a sumar el ingreso a la caja.
  select * into v_existing
  from public.invoices
  where company_id = v_company and client_request_id = p_client_request_id;

  if v_existing.id is not null then
    return v_existing;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura no tiene líneas' using errcode = 'invalid_parameter_value';
  end if;

  -- Tarifa de contrato: se resuelve por la placa, igual que en la orden.
  v_fleet := app.fleet_for_plate(v_company, p_vehicle_plate);

  -- ------------------------------------------------------------- Totales
  -- Calculados en el servidor a partir del catálogo. Lo que envía el cliente
  -- sobre precios se ignora deliberadamente.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      item_type          app.item_type,
      service_id         uuid,
      product_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Cantidad inválida en la línea "%"', v_item.name
        using errcode = 'invalid_parameter_value';
    end if;

    v_price := app.resolve_item_price(
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category, v_fleet
    );

    if coalesce(v_item.is_membego_covered, false) then
      v_membego := v_membego + v_price * v_item.quantity;
    else
      v_discount := v_discount + coalesce(v_item.discount_cents, 0);
    end if;
    v_subtotal := v_subtotal + v_price * v_item.quantity;

    -- Detalle por línea para la promoción: con esto sabe si su alcance
    -- («este servicio», «las camionetas») toca algo de esta venta.
    v_promo_lines := v_promo_lines || jsonb_build_object(
      'service_id', v_item.service_id,
      'category', p_vehicle_category,
      'amount_cents', v_price * v_item.quantity - coalesce(v_item.discount_cents, 0)
    );
  end loop;

  select tax_rate_bps, max_manual_discount_bps
    into v_rate_bps, v_max_bps
  from public.companies where id = v_company;

  -- ------------------------------------------------- Techo del descuento manual
  -- Antes de 0032 el descuento lo ponía el cliente y nadie lo miraba: se podía
  -- dejar una factura en cero. La propiedad y la administración siguen pudiendo
  -- decidir, pero queda en la bitácora.
  if v_discount > 0 and v_subtotal > 0
     and not app.has_role('propietario', 'administrador', 'superadmin') then
    if v_discount * 10000 > v_subtotal::numeric * v_max_bps then
      raise exception
        'El descuento supera el máximo autorizado para su rol (% %% del subtotal).',
        rtrim(trim(to_char(v_max_bps / 100.0, 'FM999999990.99')), '.') using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ---------------------------------------------------------------- Promoción
  -- El código NO trae importe: el servidor lo recalcula con sus propias reglas.
  -- Lo que enseñó la pantalla es una previsualización, nunca la cifra que vale.
  if p_promotion_code is not null and length(trim(p_promotion_code)) > 0 then
    v_promo_disc := app.promotion_discount(
      (select p from public.promotions p
        where p.company_id = v_company
          and upper(p.code) = upper(trim(p_promotion_code))),
      v_subtotal, p_customer_id, v_promo_lines);
    v_discount := v_discount + v_promo_disc;
  end if;

  -- MISMA fórmula que app.recalc_work_order_totals(). En la aplicación auditada
  -- había tres versiones divergentes y la factura de una orden con beneficio
  -- Membego calculaba un ITBIS distinto al de la propia orden.
  v_taxable := greatest(0, v_subtotal - v_discount - v_membego);
  v_tax     := round(v_taxable::numeric * v_rate_bps / 10000)::bigint;
  v_total   := v_taxable + v_tax;

  -- ------------------------------------------------------------- Pagos
  for v_payment in
    select * from jsonb_to_recordset(p_payments) as x(
      method       app.payment_method,
      amount_cents bigint,
      reference    text
    )
  loop
    if coalesce(v_payment.amount_cents, 0) <= 0 then
      raise exception 'Importe de pago inválido' using errcode = 'invalid_parameter_value';
    end if;
    v_paid := v_paid + v_payment.amount_cents;
    if v_payment.method = 'efectivo' then
      v_cash_paid := v_cash_paid + v_payment.amount_cents;
    elsif v_payment.method = 'credito' then
      v_credit_paid := v_credit_paid + v_payment.amount_cents;
    end if;
  end loop;

  select count(distinct method) into v_methods
  from jsonb_to_recordset(p_payments) as x(method app.payment_method);

  if v_paid < v_total then
    raise exception 'Pago insuficiente: recibido % de un total de %', v_paid, v_total
      using errcode = 'invalid_parameter_value';
  end if;

  -- El cambio se calcula UNA vez sobre el total, no una vez por pago. El código
  -- auditado hacía `cashAdd += p.amount - changeAmount` dentro de un bucle, de
  -- modo que con dos pagos en efectivo restaba el cambio dos veces.
  v_change := v_paid - v_total;

  if v_change > 0 and v_cash_paid < v_change then
    raise exception 'Solo puede devolverse cambio sobre pagos en efectivo'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------- Crédito
  -- Fiar no es cobrar. Antes de emitir se comprueba a quién se le fía, si tiene
  -- autorización, si está al día y si le queda cupo.
  if v_credit_paid > 0 then
    if v_change > 0 then
      raise exception 'Una venta a crédito no genera cambio: cobre el importe exacto.'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_customer_id is null then
      raise exception 'No se fía a consumidor final: seleccione el cliente.'
        using errcode = 'invalid_parameter_value';
    end if;

    -- Bloquea la fila del cliente: dos cajas fiando a la vez no pueden
    -- saltarse el cupo leyendo ambas el mismo saldo antiguo.
    perform 1 from public.customers
    where id = p_customer_id and company_id = v_company for update;
    if not found then
      raise exception 'Cliente inexistente o fuera de su alcance.' using errcode = 'no_data_found';
    end if;

    select * into v_credit from app.credit_snapshot(p_customer_id);

    if not v_credit.credit_enabled then
      raise exception 'El cliente no tiene crédito autorizado.' using errcode = 'insufficient_privilege';
    end if;
    if v_credit.overdue_cents > 0 then
      raise exception
        'El cliente tiene % centavos vencidos desde el %. Cobre antes de volver a fiar.',
        v_credit.overdue_cents, v_credit.oldest_due using errcode = 'check_violation';
    end if;
    if v_credit_paid > v_credit.available_cents then
      raise exception 'Cupo insuficiente: disponible % de un cupo de %.',
        v_credit.available_cents, v_credit.limit_cents using errcode = 'check_violation';
    end if;
  end if;

  -- --------------------------------------------------------- Caja abierta
  if v_cash_paid > 0 then
    select * into v_session from public.cash_sessions
    where id = p_cash_session_id and status = 'open';

    if v_session.id is null then
      raise exception 'No hay una sesión de caja abierta para registrar el efectivo'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- ---------------------------------------------------------------- NCF
  if p_ncf_type is not null then
    if p_ncf_type = 'B04' then
      raise exception 'B04 es exclusivo de notas de crédito: use annul_invoice()'
        using errcode = 'invalid_parameter_value';
    end if;
    v_ncf := app.allocate_ncf(v_company, p_ncf_type);
  end if;

  -- ------------------------------------------------------------- Escritura
  insert into public.invoices (
    company_id, branch_id, client_request_id, ncf, ncf_type,
    work_order_id, customer_id, customer_name, customer_tax_id, vehicle_plate,
    subtotal_cents, discount_cents, tax_cents, total_cents, change_cents,
    cash_session_id, cashier_id
  ) values (
    v_company, p_branch_id, p_client_request_id, v_ncf, p_ncf_type,
    p_work_order_id, p_customer_id, p_customer_name, p_customer_tax_id, p_vehicle_plate,
    v_subtotal, v_discount + v_membego, v_tax, v_total, v_change,
    p_cash_session_id, auth.uid()
  )
  returning * into v_invoice;

  -- Líneas, de nuevo con el precio del servidor.
  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      item_type          app.item_type,
      service_id         uuid,
      product_id         uuid,
      name               text,
      quantity           integer,
      discount_cents     bigint,
      is_membego_covered boolean
    )
  loop
    v_price := app.resolve_item_price(
      v_item.item_type, v_item.service_id, v_item.product_id, p_vehicle_category, v_fleet
    );

    insert into public.invoice_items (
      invoice_id, item_type, service_id, product_id, name,
      quantity, unit_price_cents, discount_cents, is_membego_covered
    ) values (
      v_invoice.id, v_item.item_type, v_item.service_id, v_item.product_id, v_item.name,
      v_item.quantity, v_price,
      case when coalesce(v_item.is_membego_covered,false) then 0 else coalesce(v_item.discount_cents,0) end,
      coalesce(v_item.is_membego_covered, false)
    );

    -- Inventario. El contexto clasifica el movimiento que registra el trigger
    -- de products (0019): sin él, el trigger rechaza el cambio de existencia.
    if v_item.item_type = 'product' then
      perform set_config('app.inventory_ctx', jsonb_build_object(
        'kind', 'venta', 'invoice_id', v_invoice.id, 'branch_id', v_invoice.branch_id
      )::text, true);
      update public.products
         set stock = stock - v_item.quantity
       where id = v_item.product_id and company_id = v_company;
    end if;
  end loop;

  -- ------------------------------------------------------- Movimientos de caja
  if p_cash_session_id is not null then
    for v_payment in
      select * from jsonb_to_recordset(p_payments) as x(
        method app.payment_method, amount_cents bigint, reference text
      )
    loop
      -- Lo fiado NO entra a la caja: no ha entrado dinero. Antes se registraba
      -- como ingreso y el arqueo cuadraba contra un cobro que no existía.
      continue when v_payment.method = 'credito';

      insert into public.cash_movements (
        company_id, cash_session_id, type, method, amount_cents, reason, invoice_id, created_by
      ) values (
        v_company, p_cash_session_id, 'inflow', v_payment.method,
        -- Solo del efectivo se descuenta el cambio entregado, y una sola vez.
        case when v_payment.method = 'efectivo'
             then v_payment.amount_cents - v_change
             else v_payment.amount_cents end,
        'Factura ' || v_invoice.invoice_number
          || case when v_payment.reference is not null then ' · ref ' || v_payment.reference else '' end,
        v_invoice.id, auth.uid()
      );
    end loop;
  end if;

  -- ------------------------------------------------------------- Canje
  -- Se registra con la factura ya creada: el canje apunta a ella, y el tope de
  -- usos se cuenta sobre canjes reales, no sobre intentos.
  if v_promo_disc > 0 then
    perform app.redeem_promotion(p_promotion_code, v_company, v_invoice,
                                 v_subtotal, v_promo_lines, p_customer_id);
  end if;

  -- ------------------------------------------------- Cuenta por cobrar
  if v_credit_paid > 0 then
    v_receivable := app.open_receivable(v_invoice, v_credit_paid, p_customer_id);
  end if;

  -- --------------------------------------------------------- Orden de trabajo
  if p_work_order_id is not null then
    -- El estado dice lo que de verdad se cobró: sin crédito queda pagada;
    -- fiada entera queda pendiente; mixta, parcial.
    v_pay_status := case
      when v_credit_paid = 0        then 'pagado'
      when v_credit_paid >= v_total then 'pendiente'
      else 'parcial'
    end;
    v_pay_method := case
      when v_methods > 1 then 'mixto'::app.payment_method
      else (p_payments -> 0 ->> 'method')::app.payment_method
    end;

    update public.work_orders
       set payment_status = v_pay_status,
           payment_method = v_pay_method
     where id = p_work_order_id and company_id = v_company;

    get diagnostics v_rows = row_count;
    -- RLS filtra en silencio: sin esta comprobación, una orden no autorizada
    -- quedaría sin marcar y nadie se enteraría.
    if v_rows = 0 then
      raise exception 'No se pudo marcar como pagada la orden %', p_work_order_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details, metadata)
  values (
    v_company, p_branch_id, 'EMITIR_FACTURA', 'Invoice', v_invoice.id::text,
    'Factura ' || v_invoice.invoice_number || ' por ' || v_total || ' centavos'
      || coalesce(' · NCF ' || v_ncf, ' · sin NCF')
      || case when v_credit_paid > 0 then ' · a crédito ' || v_credit_paid else '' end
      || case when v_promo_disc > 0
              then ' · promoción ' || upper(trim(p_promotion_code)) || ' −' || v_promo_disc
              else '' end,
    jsonb_build_object('total_cents', v_total, 'ncf', v_ncf,
                       'idempotency', p_client_request_id,
                       'credit_cents', v_credit_paid,
                       'receivable_id', v_receivable.id,
                       'fleet_id', v_fleet)
  );

  return v_invoice;
end;
$$;


grant execute on function public.create_invoice to authenticated;

comment on function public.create_invoice is
  'Emisión atómica: factura, líneas, caja, inventario, crédito, promoción, orden y auditoría '
  'en una transacción. Idempotente por client_request_id. El descuento manual tiene techo por '
  'rol y el promocional lo calcula el servidor: el importe que envía el cliente se ignora.';
