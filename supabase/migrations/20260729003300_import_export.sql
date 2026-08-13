-- =============================================================================
-- 0035 · IMPORTACIÓN MASIVA
-- =============================================================================
-- Traer los datos de otro sistema es una operación peligrosa: se hace una sola
-- vez, con archivos que nadie revisó, y si sale mal deja el maestro de clientes
-- duplicado para siempre. Esta migración la vuelve reversible y aburrida.
--
-- Una sola puerta: `import_batch(entidad, filas, aplicar)`.
--
--   · Con `aplicar => false` (lo predeterminado) hace TODO el trabajo real
--     —normaliza, busca duplicados, inserta, actualiza— y luego deshace las
--     escrituras, devolviendo el informe de lo que habría pasado. No es una
--     simulación aparte que podría diverger del camino bueno: es el mismo
--     código, con el punto final descartado.
--   · Con `aplicar => true` repite exactamente eso y lo conserva.
--
-- Reglas que la importación respeta siempre:
--
--   1. NUNCA BORRA. Un campo vacío en el archivo no vacía lo que ya existe.
--      Solo un valor presente pisa a otro, y la previsualización lo enseña.
--   2. NUNCA DUPLICA. Cada entidad tiene su llave natural —el teléfono del
--      cliente, la placa del vehículo, el código del servicio— y si ya existe,
--      se actualiza en vez de crear otro.
--   3. NUNCA TOCA LA EXISTENCIA de un producto que ya existe. El inventario se
--      mueve por compras, ventas y ajustes, que dejan kardex. Al dar de alta un
--      producto nuevo sí se acepta su existencia inicial, que la 0019 registra
--      como entrada.
--   4. NO ES FISCAL. No se importan facturas, órdenes ni movimientos de caja.
--      Un comprobante emitido en otro sistema no puede renacer aquí con NCF de
--      esta empresa; eso se exporta y se archiva, no se migra.
--   5. UNA FILA MALA NO TUMBA LA TANDA. Cada fila se procesa en su propia
--      subtransacción: la que falle se reporta con su motivo y las demás siguen.
--
-- Quién puede: propietario, administrador y superadmin. Importar reescribe el
-- maestro del negocio; no es tarea de caja ni de recepción.
-- =============================================================================

-- ------------------------------------------------------- Utilidades de lectura

-- Primer valor no vacío entre varios nombres de columna posibles. El archivo
-- que exporta otro sistema no usa nuestros encabezados; aceptamos sinónimos.
create or replace function app.import_text(p_row jsonb, variadic p_keys text[])
returns text
language sql
immutable
as $$
  select nullif(btrim(v), '')
  from unnest(p_keys) as k
  cross join lateral (select p_row ->> k) as t(v)
  where nullif(btrim(coalesce(v, '')), '') is not null
  limit 1;
$$;

comment on function app.import_text(jsonb, text[]) is
  'Primer valor no vacío del objeto entre varios nombres de columna posibles.';

-- Solo los dígitos. Es la llave con la que se reconoce a un cliente ya
-- registrado: «829-481-6319» y «8294816319» son el mismo teléfono, y un número
-- local escrito con el 1 de Norteamérica delante también.
create or replace function app.phone_key(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v = '' then return null; end if;
  if length(v) = 11 and left(v, 1) = '1' then v := right(v, 10); end if;
  return v;
end;
$$;

comment on function app.phone_key(text) is
  'Dígitos del teléfono, sin el 1 de país si es un número local de 11 cifras. '
  'Sirve para reconocer duplicados, no para mostrar.';

-- Presentación. Un número dominicano de 10 dígitos se escribe 809-000-0000;
-- cualquier otro se deja en crudo con el signo de más, porque inventarle un
-- formato a un número extranjero es más confuso que dejarlo como vino.
create or replace function app.format_phone(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if v = '' then return null; end if;
  if length(v) = 11 and left(v, 1) = '1' then v := right(v, 10); end if;
  if length(v) = 10 then
    return substr(v, 1, 3) || '-' || substr(v, 4, 3) || '-' || substr(v, 7, 4);
  end if;
  return '+' || v;
end;
$$;

-- Importe a centavos. Acepta lo que trae un archivo de verdad: «$1,271.11 DOP»,
-- «1271.11», «1.271,11», «RD$ 900». La última coma o punto manda como separador
-- decimal solo si le siguen una o dos cifras; si no, era separador de miles.
create or replace function app.parse_money(p_text text)
returns bigint
language plpgsql
immutable
as $$
declare
  v       text := regexp_replace(coalesce(p_text, ''), '[^0-9.,-]', '', 'g');
  v_neg   boolean := false;
  v_pos   integer;
  v_dot   integer;
  v_com   integer;
  v_dec   text;
  v_ent   text;
begin
  if v = '' then return null; end if;
  if left(v, 1) = '-' then v_neg := true; end if;
  v := replace(v, '-', '');
  if v = '' then return null; end if;

  -- Posición (base 0) del último punto y de la última coma. position() sobre la
  -- cadena invertida devuelve 0 cuando no encuentra, y ese 0 hay que descartarlo
  -- explícitamente: restarlo de la longitud daría una posición que no existe.
  v_dot := case when position('.' in reverse(v)) > 0
                then length(v) - position('.' in reverse(v)) else -1 end;
  v_com := case when position(',' in reverse(v)) > 0
                then length(v) - position(',' in reverse(v)) else -1 end;
  v_pos := greatest(v_dot, v_com);

  -- Manda como decimal solo si le siguen una o dos cifras: «1,200» son mil
  -- doscientos, «1,20» es uno con veinte.
  if v_pos >= 0 and length(v) - v_pos - 1 between 1 and 2 then
    v_ent := regexp_replace(left(v, v_pos), '[.,]', '', 'g');
    v_dec := rpad(substr(v, v_pos + 2), 2, '0');
  else
    v_ent := regexp_replace(v, '[.,]', '', 'g');
    v_dec := '00';
  end if;

  if v_ent = '' then v_ent := '0'; end if;
  return (case when v_neg then -1 else 1 end)
       * (v_ent::bigint * 100 + v_dec::bigint);
end;
$$;

comment on function app.parse_money(text) is
  'Convierte un importe escrito por humanos a centavos. NULL si no hay número.';

create or replace function app.parse_int(p_text text)
returns integer
language plpgsql
immutable
as $$
declare
  v text := regexp_replace(coalesce(p_text, ''), '[^0-9-]', '', 'g');
begin
  if v = '' or v = '-' then return null; end if;
  return v::integer;
exception when others then
  return null;
end;
$$;

-- «Sí», «Activo», «1», «true», «x» valen como verdadero. Lo demás, falso.
-- NULL cuando la columna no vino: eso es «no cambies nada», no «apágalo».
create or replace function app.parse_bool(p_text text)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(p_text, '')), '') is null then null
    when lower(btrim(p_text)) in
         ('si', 'sí', 'yes', 'true', 't', '1', 'x', 'activo', 'activa', 'verdadero')
      then true
    else false
  end;
$$;

-- Código a partir del nombre, para el catálogo que llega sin uno. Sin acentos y
-- sin espacios, porque un código se teclea y se busca.
create or replace function app.slug_code(p_text text, p_len integer default 24)
returns text
language sql
immutable
as $$
  select upper(left(
    regexp_replace(
      translate(btrim(coalesce(p_text, '')),
                'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
      '[^A-Za-z0-9]+', '-', 'g'),
    p_len));
$$;

-- Categoría de vehículo escrita como sea. Devuelve NULL si no se reconoce, y
-- quien llama decide si eso es un error o si cae en el valor por defecto.
create or replace function app.parse_vehicle_category(p_text text)
returns app.vehicle_category
language plpgsql
immutable
as $$
declare
  v text := lower(btrim(coalesce(p_text, '')));
begin
  if v = '' then return null; end if;
  return case
    when v in ('sedan', 'sedán', 'carro', 'auto', 'automovil', 'automóvil',
               'compacto', 'hatchback', 'hatch back', 'turismo') then 'sedan'
    when v in ('suv', 'camioneta', 'crossover', 'jeepeta')       then 'suv'
    when v in ('jeep', 'todoterreno', '4x4')                     then 'jeep'
    when v in ('pickup', 'pick up', 'pick-up', 'camioneta pickup') then 'pickup'
    when v in ('van', 'minivan', 'furgoneta')                    then 'van'
    when v in ('truck', 'camion', 'camión', 'patana')            then 'truck'
    when v in ('motorcycle', 'moto', 'motocicleta', 'motor')     then 'motorcycle'
    when v in ('special', 'especial', 'otro', 'otros')           then 'special'
    else null
  end::app.vehicle_category;
end;
$$;

-- =============================================================================
-- La puerta única
-- =============================================================================

create or replace function public.import_batch(
  p_entity  text,
  p_rows    jsonb,
  p_apply   boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, app, pg_temp
as $$
declare
  v_company    uuid := app.current_company_id();
  v_branch     uuid := app.current_branch_id();
  v_entity     text := lower(btrim(coalesce(p_entity, '')));
  v_total      integer;
  v_i          integer;
  v_row        jsonb;
  v_detail     jsonb := '[]'::jsonb;
  v_action     text;
  v_key        text;
  v_note       text;
  v_n_create   integer := 0;
  v_n_update   integer := 0;
  v_n_skip     integer := 0;
  v_n_error    integer := 0;

  -- Campos comunes de trabajo
  v_name       text;
  v_phone      text;
  v_email      text;
  v_tax        text;
  v_code       text;
  v_id         uuid;
  v_found      uuid;
  v_price      bigint;
  v_cost       bigint;
  v_qty        integer;
  v_cat        app.vehicle_category;
  v_bool       boolean;
  v_changes    text[];
  v_cur        record;
begin
  if v_company is null then
    raise exception 'No hay empresa en la sesión.' using errcode = 'insufficient_privilege';
  end if;

  if not app.has_role('propietario', 'administrador', 'superadmin') then
    raise exception
      'Solo el propietario o un administrador puede importar datos: la importación '
      'reescribe el maestro del negocio.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_entity not in ('clientes', 'vehiculos', 'servicios', 'productos',
                      'proveedores', 'promociones') then
    raise exception
      'Entidad «%» desconocida. Se admiten: clientes, vehiculos, servicios, '
      'productos, proveedores, promociones.', p_entity
      using errcode = 'invalid_parameter_value';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Las filas deben venir como arreglo JSON.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then
    raise exception 'El archivo no trae ninguna fila con datos.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_total > 2000 then
    raise exception
      'Máximo 2000 filas por tanda; llegaron %. Parta el archivo.', v_total
      using errcode = 'program_limit_exceeded';
  end if;

  -- La tanda entera vive dentro de este bloque. Al final, si es un ensayo, se
  -- lanza DRY01 y PostgreSQL revierte cuanto se escribió; las variables de
  -- PL/pgSQL —el informe— sobreviven, que es justo lo que queremos devolver.
  begin
    for v_i in 0 .. v_total - 1 loop
      v_row    := p_rows -> v_i;
      v_action := null; v_key := null; v_note := null; v_changes := '{}';

      begin  -- subtransacción por fila: una mala no tumba la tanda

        -- ------------------------------------------------------- CLIENTES
        if v_entity = 'clientes' then
          v_name := btrim(concat_ws(' ',
            app.import_text(v_row, 'nombre', 'name', 'nombres', 'first_name'),
            app.import_text(v_row, 'apellido', 'apellidos', 'last_name', 'surname')));
          if coalesce(v_name, '') = '' then
            raise exception 'Falta el nombre.';
          end if;
          v_phone := app.format_phone(
            app.import_text(v_row, 'telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil'));
          v_email := lower(app.import_text(v_row, 'correo', 'email', 'e-mail', 'mail'));
          if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
            v_note := format('correo «%s» descartado por inválido', v_email);
            v_email := null;
          end if;
          v_tax := nullif(regexp_replace(coalesce(app.import_text(
            v_row, 'rnc', 'cedula', 'cédula', 'documento',
            'documento de identidad', 'tax_id', 'identificacion'), ''), '[^0-9A-Za-z]', '', 'g'), '');
          v_key := v_name;

          -- Reconocimiento: primero el teléfono, que es lo que de verdad
          -- identifica a un cliente en un car wash; si no vino, el nombre.
          select c.id into v_found
          from public.customers c
          where c.company_id = v_company
            and (
              (app.phone_key(v_phone) is not null
               and app.phone_key(c.phone) = app.phone_key(v_phone))
              or (app.phone_key(v_phone) is null
                  and lower(btrim(c.name)) = lower(v_name))
            )
          order by c.created_at
          limit 1;

          if v_found is null then
            insert into public.customers (company_id, branch_id, name, phone, email, tax_id,
                                          address, notes)
            values (v_company, v_branch, v_name, v_phone, v_email, v_tax,
                    app.import_text(v_row, 'direccion', 'dirección', 'address'),
                    app.import_text(v_row, 'notas', 'nota', 'notes', 'comentario'));
            v_action := 'crear';
          else
            select * into v_cur from public.customers where id = v_found;
            if v_phone is not null and coalesce(v_cur.phone, '') <> v_phone then
              v_changes := v_changes || format('teléfono: %s → %s',
                coalesce(v_cur.phone, '(vacío)'), v_phone);
            end if;
            if v_email is not null and coalesce(v_cur.email, '') <> v_email then
              v_changes := v_changes || format('correo: %s → %s',
                coalesce(v_cur.email, '(vacío)'), v_email);
            end if;
            if v_tax is not null and coalesce(v_cur.tax_id, '') <> v_tax then
              v_changes := v_changes || format('RNC: %s → %s',
                coalesce(v_cur.tax_id, '(vacío)'), v_tax);
            end if;
            -- Mismo teléfono, otro nombre. En un car wash el teléfono ES la
            -- identidad, así que no se crea otro cliente; pero tampoco se le
            -- cambia el nombre a nadie por lo que diga un archivo. Se avisa y
            -- que decida quien importa.
            if lower(btrim(v_cur.name)) <> lower(v_name) then
              v_note := format('mismo teléfono que «%s», ya registrado; '
                               'no se renombra desde una importación', v_cur.name);
            end if;

            if array_length(v_changes, 1) is null then
              v_action := 'omitir';
              v_note   := coalesce(v_note, 'ya está registrado, sin cambios');
            else
              update public.customers set
                phone   = coalesce(v_phone, phone),
                email   = coalesce(v_email, email),
                tax_id  = coalesce(v_tax, tax_id),
                address = coalesce(app.import_text(v_row, 'direccion', 'dirección', 'address'), address),
                notes   = coalesce(app.import_text(v_row, 'notas', 'nota', 'notes'), notes)
              where id = v_found;
              v_action := 'actualizar';
              v_note   := trim(both '; ' from
                concat_ws('; ', v_note, array_to_string(v_changes, '; ')));
            end if;
          end if;

        -- ------------------------------------------------------ VEHÍCULOS
        elsif v_entity = 'vehiculos' then
          v_code := upper(regexp_replace(coalesce(app.import_text(
            v_row, 'placa', 'plate', 'matricula', 'matrícula'), ''), '[^A-Za-z0-9]', '', 'g'));
          if v_code = '' then
            raise exception 'Falta la placa.';
          end if;
          v_key := v_code;
          v_cat := coalesce(app.parse_vehicle_category(
            app.import_text(v_row, 'categoria', 'categoría', 'tipo', 'category')), 'sedan');

          -- Dueño: por teléfono o por nombre exacto. Si no aparece, el vehículo
          -- entra sin dueño en vez de rechazarse; asignarlo después es un clic,
          -- perder el vehículo es perder su historial.
          v_id := null;
          v_phone := app.import_text(v_row, 'telefono_cliente', 'telefono', 'teléfono',
                                     'cliente_telefono', 'phone');
          v_name := app.import_text(v_row, 'cliente', 'nombre_cliente', 'dueno', 'dueño',
                                    'propietario', 'customer');
          select c.id into v_id
          from public.customers c
          where c.company_id = v_company
            and (
              (app.phone_key(v_phone) is not null
               and app.phone_key(c.phone) = app.phone_key(v_phone))
              or (v_name is not null and lower(btrim(c.name)) = lower(btrim(v_name)))
            )
          order by c.created_at
          limit 1;
          if v_id is null and (v_phone is not null or v_name is not null) then
            v_note := 'no se encontró al dueño; el vehículo queda sin cliente';
          end if;

          select v.id into v_found
          from public.vehicles v
          where v.company_id = v_company and v.plate = v_code;

          if v_found is null then
            insert into public.vehicles (company_id, customer_id, plate, make, model,
                                         year, color, category, notes)
            values (v_company, v_id, v_code,
                    coalesce(app.import_text(v_row, 'marca', 'make'), ''),
                    coalesce(app.import_text(v_row, 'modelo', 'model'), ''),
                    app.parse_int(app.import_text(v_row, 'ano', 'año', 'year')),
                    coalesce(app.import_text(v_row, 'color'), ''),
                    v_cat,
                    app.import_text(v_row, 'notas', 'notes'));
            v_action := 'crear';
          else
            update public.vehicles set
              customer_id = coalesce(customer_id, v_id),
              make  = coalesce(nullif(app.import_text(v_row, 'marca', 'make'), ''), make),
              model = coalesce(nullif(app.import_text(v_row, 'modelo', 'model'), ''), model),
              year  = coalesce(app.parse_int(app.import_text(v_row, 'ano', 'año', 'year')), year),
              color = coalesce(nullif(app.import_text(v_row, 'color'), ''), color),
              category = v_cat
            where id = v_found;
            v_action := 'actualizar';
            v_note   := coalesce(v_note, 'placa ya registrada, datos completados');
          end if;

        -- ------------------------------------------------------- SERVICIOS
        elsif v_entity = 'servicios' then
          v_name := app.import_text(v_row, 'nombre', 'name', 'servicio', 'item');
          if v_name is null then
            raise exception 'Falta el nombre del servicio.';
          end if;
          v_key  := v_name;
          v_code := coalesce(app.import_text(v_row, 'codigo', 'código', 'code', 'sku'),
                             app.slug_code(v_name));

          select s.id into v_found
          from public.services s
          where s.company_id = v_company
            and (upper(s.code) = upper(v_code) or lower(btrim(s.name)) = lower(v_name))
          order by s.created_at
          limit 1;

          if v_found is null then
            -- Un código repetido no puede tumbar la fila: se le pone sufijo.
            while exists (select 1 from public.services
                          where company_id = v_company and upper(code) = upper(v_code)) loop
              v_code := left(v_code, 20) || '-' || substr(md5(random()::text), 1, 3);
            end loop;
            insert into public.services (company_id, code, name, description, category,
                                         estimated_minutes, commission_bps, is_active)
            values (v_company, v_code, v_name,
                    coalesce(app.import_text(v_row, 'descripcion', 'descripción', 'description'), ''),
                    coalesce(app.import_text(v_row, 'categoria', 'categoría', 'grupo'), ''),
                    coalesce(app.parse_int(app.import_text(v_row, 'minutos', 'duracion', 'duración')), 30),
                    coalesce(app.parse_int(app.import_text(v_row, 'comision_bps')),
                             coalesce(app.parse_int(app.import_text(v_row, 'comision', 'comisión')), 0) * 100),
                    coalesce(app.parse_bool(app.import_text(v_row, 'activo', 'estado', 'is_active')), true))
            returning id into v_found;
            v_action := 'crear';
          else
            update public.services set
              name        = v_name,
              description = coalesce(nullif(app.import_text(v_row, 'descripcion', 'descripción'), ''), description),
              category    = coalesce(nullif(app.import_text(v_row, 'categoria', 'categoría', 'grupo'), ''), category),
              estimated_minutes = coalesce(app.parse_int(app.import_text(v_row, 'minutos', 'duracion')), estimated_minutes),
              is_active   = coalesce(app.parse_bool(app.import_text(v_row, 'activo', 'estado')), is_active)
            where id = v_found;
            v_action := 'actualizar';
          end if;

          -- Precios. `precio` vale para todas las categorías; `precio_suv`,
          -- `precio_pickup`… pisan la suya. Un car wash cobra distinto según el
          -- tamaño del vehículo y el catálogo tiene que poder decirlo.
          v_price := app.parse_money(app.import_text(v_row, 'precio', 'precio_venta', 'price', 'monto'));
          if v_price is not null then
            insert into public.service_prices (service_id, vehicle_category, price_cents)
            select v_found, c, v_price
            from unnest(enum_range(null::app.vehicle_category)) as c
            on conflict (service_id, vehicle_category)
              do update set price_cents = excluded.price_cents;
          end if;
          for v_cat, v_cost in
            select c, app.parse_money(v_row ->> ('precio_' || c::text))
            from unnest(enum_range(null::app.vehicle_category)) as c
          loop
            if v_cost is not null then
              insert into public.service_prices (service_id, vehicle_category, price_cents)
              values (v_found, v_cat, v_cost)
              on conflict (service_id, vehicle_category)
                do update set price_cents = excluded.price_cents;
            end if;
          end loop;
          if v_price is null
             and not exists (select 1 from public.service_prices where service_id = v_found) then
            v_note := 'sin precio: quedará en 0 hasta que se le ponga uno';
          end if;

        -- ------------------------------------------------------- PRODUCTOS
        elsif v_entity = 'productos' then
          v_name := app.import_text(v_row, 'nombre', 'name', 'producto', 'item');
          if v_name is null then
            raise exception 'Falta el nombre del producto.';
          end if;
          v_key   := v_name;
          v_code  := coalesce(app.import_text(v_row, 'codigo', 'código', 'code', 'sku'),
                              app.slug_code(v_name));
          v_price := app.parse_money(app.import_text(v_row, 'precio', 'precio_venta', 'price'));
          v_cost  := app.parse_money(app.import_text(v_row, 'costo', 'cost', 'costo_base'));
          v_qty   := app.parse_int(app.import_text(v_row, 'existencia', 'stock', 'cantidad'));

          select p.id into v_found
          from public.products p
          where p.company_id = v_company
            and (upper(p.code) = upper(v_code) or lower(btrim(p.name)) = lower(v_name))
          order by p.created_at
          limit 1;

          if v_found is null then
            while exists (select 1 from public.products
                          where company_id = v_company and upper(code) = upper(v_code)) loop
              v_code := left(v_code, 20) || '-' || substr(md5(random()::text), 1, 3);
            end loop;
            insert into public.products (company_id, branch_id, code, barcode, name, category,
                                         cost_cents, price_cents, stock, min_stock, unit,
                                         is_for_sale, is_active)
            values (v_company, v_branch, v_code,
                    app.import_text(v_row, 'codigo_barras', 'barcode'),
                    v_name,
                    coalesce(app.import_text(v_row, 'categoria', 'categoría', 'grupo'), ''),
                    coalesce(v_cost, 0), coalesce(v_price, 0),
                    coalesce(v_qty, 0),
                    coalesce(app.parse_int(app.import_text(v_row, 'minimo', 'mínimo', 'min_stock')), 0),
                    coalesce(app.import_text(v_row, 'unidad', 'unit'), 'Unidad'),
                    coalesce(app.parse_bool(app.import_text(v_row, 'para_venta', 'is_for_sale')), true),
                    coalesce(app.parse_bool(app.import_text(v_row, 'activo', 'estado')), true));
            v_action := 'crear';
          else
            -- La existencia NO se toca: se mueve por compras, ventas y ajustes,
            -- que dejan kardex. Ver la guarda de la 0019.
            update public.products set
              name       = v_name,
              category   = coalesce(nullif(app.import_text(v_row, 'categoria', 'categoría'), ''), category),
              price_cents = coalesce(v_price, price_cents),
              cost_cents  = coalesce(v_cost, cost_cents),
              min_stock   = coalesce(app.parse_int(app.import_text(v_row, 'minimo', 'mínimo')), min_stock),
              unit        = coalesce(nullif(app.import_text(v_row, 'unidad', 'unit'), ''), unit),
              is_active   = coalesce(app.parse_bool(app.import_text(v_row, 'activo', 'estado')), is_active)
            where id = v_found;
            v_action := 'actualizar';
            if v_qty is not null then
              v_note := 'existencia ignorada: se ajusta desde Inventario, con motivo';
            end if;
          end if;

        -- ----------------------------------------------------- PROVEEDORES
        elsif v_entity = 'proveedores' then
          v_name := app.import_text(v_row, 'nombre', 'name', 'proveedor', 'razon_social');
          if v_name is null then
            raise exception 'Falta el nombre del proveedor.';
          end if;
          v_key := v_name;
          select s.id into v_found
          from public.suppliers s
          where s.company_id = v_company and lower(btrim(s.name)) = lower(v_name);

          if v_found is null then
            insert into public.suppliers (company_id, name, tax_id, phone, email, address, notes)
            values (v_company, v_name,
                    app.import_text(v_row, 'rnc', 'tax_id', 'cedula'),
                    app.format_phone(app.import_text(v_row, 'telefono', 'teléfono', 'phone')),
                    lower(app.import_text(v_row, 'correo', 'email')),
                    app.import_text(v_row, 'direccion', 'dirección', 'address'),
                    app.import_text(v_row, 'notas', 'notes'));
            v_action := 'crear';
          else
            update public.suppliers set
              tax_id  = coalesce(app.import_text(v_row, 'rnc', 'tax_id'), tax_id),
              phone   = coalesce(app.format_phone(app.import_text(v_row, 'telefono', 'teléfono')), phone),
              email   = coalesce(lower(app.import_text(v_row, 'correo', 'email')), email),
              address = coalesce(app.import_text(v_row, 'direccion', 'dirección'), address),
              notes   = coalesce(app.import_text(v_row, 'notas', 'notes'), notes)
            where id = v_found;
            v_action := 'actualizar';
          end if;

        -- ----------------------------------------------------- PROMOCIONES
        else
          v_name := app.import_text(v_row, 'nombre', 'name', 'descuento', 'promocion');
          if v_name is null then
            raise exception 'Falta el nombre de la promoción.';
          end if;
          v_key  := v_name;
          v_code := upper(coalesce(app.import_text(v_row, 'codigo', 'código', 'code'),
                                   app.slug_code(v_name, 16)));
          v_note := lower(coalesce(app.import_text(v_row, 'tipo', 'kind', 'modalidad'), ''));
          v_price := app.parse_money(app.import_text(v_row, 'valor', 'value', 'monto', 'importe'));

          select p.id into v_found
          from public.promotions p
          where p.company_id = v_company and upper(p.code) = v_code;

          -- Un solo camino de escritura: el RPC de la 0032, que valida que el
          -- valor case con la modalidad y que el alcance tenga a qué apuntar.
          if v_note like '%porcent%' or v_note like '%percent%' or v_note = '%' then
            perform public.upsert_promotion(
              p_code => v_code, p_name => v_name, p_kind => 'porcentaje',
              p_promotion_id => v_found,
              p_value_bps => coalesce(app.parse_int(app.import_text(v_row, 'valor', 'value')), 0) * 100,
              p_starts_on => nullif(app.import_text(v_row, 'desde', 'inicio', 'starts_on'), '')::date,
              p_ends_on   => nullif(app.import_text(v_row, 'hasta', 'fin', 'ends_on'), '')::date,
              p_min_purchase_cents => coalesce(app.parse_money(
                app.import_text(v_row, 'minimo', 'mínimo', 'compra_minima')), 0),
              p_is_active => coalesce(app.parse_bool(app.import_text(v_row, 'activo', 'estado')), true)
            );
          else
            if v_price is null then
              raise exception 'Falta el valor del descuento.';
            end if;
            perform public.upsert_promotion(
              p_code => v_code, p_name => v_name, p_kind => 'importe',
              p_promotion_id => v_found,
              p_value_cents => v_price,
              p_starts_on => nullif(app.import_text(v_row, 'desde', 'inicio', 'starts_on'), '')::date,
              p_ends_on   => nullif(app.import_text(v_row, 'hasta', 'fin', 'ends_on'), '')::date,
              p_min_purchase_cents => coalesce(app.parse_money(
                app.import_text(v_row, 'minimo', 'mínimo', 'compra_minima')), 0),
              p_is_active => coalesce(app.parse_bool(app.import_text(v_row, 'activo', 'estado')), true)
            );
          end if;
          v_action := case when v_found is null then 'crear' else 'actualizar' end;
          v_note   := null;
        end if;

        -- Cuenta y anota
        if    v_action = 'crear'      then v_n_create := v_n_create + 1;
        elsif v_action = 'actualizar' then v_n_update := v_n_update + 1;
        else                               v_n_skip   := v_n_skip   + 1;
        end if;
        v_detail := v_detail || jsonb_build_object(
          'fila', v_i + 1, 'accion', v_action, 'clave', v_key, 'nota', v_note);

      exception when others then
        v_n_error := v_n_error + 1;
        v_detail := v_detail || jsonb_build_object(
          'fila', v_i + 1, 'accion', 'error',
          'clave', coalesce(v_key, '(fila ' || (v_i + 1) || ')'),
          'nota', sqlerrm);
      end;
    end loop;

    if not p_apply then
      raise exception 'ensayo' using errcode = 'DRY01';
    end if;

    -- Solo lo aplicado deja rastro. Un ensayo no es un hecho.
    insert into public.audit_logs (company_id, branch_id, action, entity, entity_id,
                                   details, metadata)
    values (v_company, v_branch, 'IMPORTAR', v_entity, null,
            format('%s: %s creados, %s actualizados, %s omitidos, %s con error',
                   v_entity, v_n_create, v_n_update, v_n_skip, v_n_error),
            jsonb_build_object('creados', v_n_create, 'actualizados', v_n_update,
                               'omitidos', v_n_skip, 'errores', v_n_error,
                               'filas', v_total));

  exception when sqlstate 'DRY01' then
    -- Se descarta todo lo escrito. El informe, que vive en variables de
    -- PL/pgSQL y no en la base, sobrevive intacto.
    null;
  end;

  return jsonb_build_object(
    'entidad',  v_entity,
    'aplicado', p_apply,
    'filas',    v_total,
    'resumen',  jsonb_build_object('crear', v_n_create, 'actualizar', v_n_update,
                                   'omitir', v_n_skip,  'error', v_n_error),
    'detalle',  v_detail
  );
end;
$$;

comment on function public.import_batch(text, jsonb, boolean) is
  'Importa un lote a clientes, vehiculos, servicios, productos, proveedores o '
  'promociones. Con p_apply=false ejecuta el mismo camino y lo revierte, '
  'devolviendo qué habría pasado. Nunca borra ni duplica.';

revoke all on function public.import_batch(text, jsonb, boolean) from public;
grant execute on function public.import_batch(text, jsonb, boolean) to authenticated;

grant execute on function app.import_text(jsonb, text[])   to authenticated;
grant execute on function app.phone_key(text)              to authenticated;
grant execute on function app.format_phone(text)           to authenticated;
grant execute on function app.parse_money(text)            to authenticated;
grant execute on function app.parse_int(text)              to authenticated;
grant execute on function app.parse_bool(text)             to authenticated;
grant execute on function app.slug_code(text, integer)     to authenticated;
grant execute on function app.parse_vehicle_category(text) to authenticated;
