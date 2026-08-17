-- ============================================================================
-- 0040 · EDITAR Y BORRAR DATOS, CON FRENO
--
-- Hasta aquí NADIE podía borrar nada, ni el superadministrador. De 54 tablas,
-- solo 5 tenían permiso de DELETE, y eran detalles internos. No era una
-- decisión de roles: el permiso nunca se otorgó, así que un cliente duplicado o
-- un servicio creado por error se quedaban ahí para siempre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LO QUE SE ABRE Y LO QUE NO
--
-- Se abre el CATÁLOGO y las FICHAS: servicios, productos, clientes, vehículos,
-- proveedores, promociones, equipos, bahías, citas, reclamos y flotillas.
--
-- NO se abren las facturas, los pagos, los movimientos de caja, el kardex, la
-- nómina ni la bitácora. Y no es timidez: una factura que desaparece deja un
-- hueco en la correlación de NCF que no hay forma de explicar ante la DGII. Ya
-- existe el camino que la ley reconoce —anular emitiendo una nota de crédito
-- B04—, y deja la factura, la nota y el motivo a la vista.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUIÉN MANDA: LA CLAVE AJENA, NO EL DISPARADOR
--
-- La primera versión de esto contaba los dependientes en un disparador y se
-- negaba si había alguno. Estaba mal, y la razón importa:
--
--   Un administrador limitado a una sucursal NO VE las facturas de la otra
--   —hay políticas RESTRICTIVE de alcance por sucursal—. Su cuenta habría dado
--   cero, el borrado habría pasado, y como `inventory_movements.product_id`
--   era ON DELETE CASCADE, el kardex de la otra sucursal se habría borrado
--   solo. Un freno que se puede esquivar sin querer no es un freno.
--
-- Así que la autoridad son las claves ajenas, que no pasan por RLS: las que
-- protegen historia se pasan a ON DELETE RESTRICT. El disparador se queda, pero
-- SOLO para dar un mensaje entendible antes de que la restricción salte. Si el
-- disparador se queda ciego, la restricción sigue ahí y el borrado se niega
-- igual; lo único que se pierde es la buena redacción del error.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUIÉN PUEDE
--
-- Solo propietario, administrador y superadmin. Las políticas de varias de estas
-- tablas (`customers_write`, `vehicles_write`, `bays_write`) no piden ningún
-- rol: con el GRANT puesto y nada más, un cajero podría borrar clientes. Por eso
-- el candado va como política RESTRICTIVE, que solo puede restringir y nunca
-- ampliar — no toca lo que ya existe y ninguna política futura puede relajarlo
-- sin querer.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · LAS CLAVES AJENAS QUE PROTEGEN HISTORIA PASAN A RESTRICT
--
-- Cada una de estas era CASCADE o SET NULL, y con el borrado abierto eso deja
-- de ser inofensivo:
--
--   · CASCADE se lleva la historia por delante, en silencio.
--   · SET NULL la deja huérfana: la factura sigue ahí pero ya no se sabe de
--     quién era, y el informe de «clientes que más gastan» pierde filas.
--
-- Se recrean con el MISMO nombre y la misma forma compuesta (id, company_id):
-- son las claves de inquilino, y perder la comprobación de empresa por arreglar
-- el borrado sería cambiar un agujero por otro peor.
--
-- Recrear una clave ajena la revalida, así que hay un escaneo de tabla por cada
-- una. A este tamaño son segundos; conviene correrlo fuera de hora igualmente.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  -- (tabla, restricción, columna, tabla_destino)
  v_claves text[][] := array[
    -- Un cliente con facturas no se borra. Antes: SET NULL, que dejaba la
    -- factura sin dueño.
    ['invoices',              'invoices_customer_same_company',              'customer_id',  'customers'],
    ['work_orders',           'work_orders_customer_same_company',           'customer_id',  'customers'],
    ['memberships',           'memberships_customer_same_company',           'customer_id',  'customers'],
    -- El kardex. La más importante de la lista: era CASCADE.
    ['inventory_movements',   'inventory_movements_product_same_company',    'product_id',   'products'],
    -- Lo que de verdad se consumió en cada lavado: es coste, es historia.
    ['service_consumptions',  'service_consumptions_product_same_company',   'product_id',   'products'],
    -- El rastro de cuánto se descontó y a quién. Era CASCADE.
    ['promotion_redemptions', 'redemptions_promotion_same_company',          'promotion_id', 'promotions'],
    ['maintenance_orders',    'maintenance_equipment_same_company',          'equipment_id', 'equipment'],
    ['maintenance_orders',    'maintenance_supplier_same_company',           'supplier_id',  'suppliers'],
    ['work_orders',           'work_orders_vehicle_same_company',            'vehicle_id',   'vehicles'],
    ['work_orders',           'work_orders_bay_same_company',                'bay_id',       'bays'],
    ['work_orders',           'work_orders_fleet_same_company',              'fleet_id',     'fleets']
  ];
  i integer;
begin
  for i in 1 .. array_length(v_claves, 1) loop
    select con.confdeltype into r
      from pg_constraint con join pg_class cl on cl.oid = con.conrelid
     where con.conname = v_claves[i][2] and cl.relname = v_claves[i][1];

    -- Idempotente: si ya es RESTRICT ('r'), no se toca. Recrearla otra vez
    -- costaría otro escaneo por nada.
    if r.confdeltype is not null and r.confdeltype <> 'r' then
      execute format('alter table public.%I drop constraint %I',
                     v_claves[i][1], v_claves[i][2]);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I, company_id) '
        'references public.%I(id, company_id) on delete restrict',
        v_claves[i][1], v_claves[i][2], v_claves[i][3], v_claves[i][4]);
    end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · EL MENSAJE ENTENDIBLE
--
-- «Tiene 40 facturas» se entiende. «violates foreign key constraint
-- invoices_customer_same_company» no, y es lo que vería el usuario si esto no
-- existiera.
--
-- Recibe tríos (tabla, columna, etiqueta) y cuenta. Es genérico a propósito:
-- once funciones iguales acabarían siendo once funciones distintas.
--
-- OJO — esto NO es lo que garantiza nada. Cuenta a través de RLS, así que puede
-- quedarse corto para un usuario con alcance limitado. La garantía es la
-- restricción de arriba; esto solo redacta mejor el «no».
-- ────────────────────────────────────────────────────────────────────────────
create or replace function app.frenar_borrado_con_historia()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  i        integer := 0;
  v_cuenta bigint;
begin
  while i < array_length(TG_ARGV, 1) loop
    execute format('select count(*) from public.%I where %I = $1', TG_ARGV[i], TG_ARGV[i + 1])
      into v_cuenta using OLD.id;

    if v_cuenta > 0 then
      raise exception
        'No se puede eliminar: tiene % % asociad%. Archívelo en vez de borrarlo: deja de aparecer y el historial se conserva.',
        v_cuenta, TG_ARGV[i + 2], case when v_cuenta = 1 then 'a' else 'as' end
        using errcode = 'foreign_key_violation';
    end if;

    i := i + 3;
  end loop;

  return OLD;
end;
$$;

comment on function app.frenar_borrado_con_historia is
  'Explica en castellano por qué no se puede borrar. NO es la garantía: eso son las claves ajenas RESTRICT, que no pasan por RLS.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · TODO BORRADO QUEDA EN LA BITÁCORA
--
-- Un borrado sin rastro es la única operación del sistema que no se puede
-- auditar después: la fila ya no está, y sin esto tampoco quién ni cuándo. Se
-- guarda el NOMBRE, no solo el identificador, porque un identificador que ya no
-- resuelve no responde a «¿quién borró a este cliente?».
-- ────────────────────────────────────────────────────────────────────────────
create or replace function app.registrar_borrado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fila   jsonb := to_jsonb(OLD);
  v_nombre text  := coalesce(v_fila ->> 'name', v_fila ->> 'plate', v_fila ->> 'code');
begin
  insert into public.audit_logs (
    company_id, branch_id, actor_id, actor_name, actor_role,
    action, entity, entity_id, details
  )
  values (
    (v_fila ->> 'company_id')::uuid,
    (v_fila ->> 'branch_id')::uuid,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    app.current_role(),
    'ELIMINAR',
    TG_TABLE_NAME,
    v_fila ->> 'id',
    coalesce('Se eliminó ' || v_nombre, 'Se eliminó un registro de ' || TG_TABLE_NAME)
  );

  return OLD;
end;
$$;

comment on function app.registrar_borrado is
  'Deja el borrado en la bitácora con el nombre de lo borrado. Sin esto, un borrado es la única operación que no se puede auditar.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4 · ARCHIVAR, QUE ES LO QUE HAY QUE OFRECER CUANDO EL BORRADO SE NIEGA
--
-- `customers` y `vehicles` no tenían con qué: la única forma de sacar a un
-- cliente de las búsquedas era borrarlo, y borrarlo estaba prohibido. Así que no
-- había ninguna.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.customers add column if not exists is_active boolean not null default true;
alter table public.vehicles  add column if not exists is_active boolean not null default true;

comment on column public.customers.is_active is
  'Falso = archivado. Deja de aparecer en búsquedas y selectores; su historial de facturas queda intacto.';
comment on column public.vehicles.is_active is
  'Falso = archivado. El carro deja de proponerse al recibir, sin borrar sus órdenes.';

-- Índices PARCIALES: lo que se busca son los activos, y los archivados son —o
-- deberían ser— una minoría. Un índice completo pagaría por todos para filtrar
-- unos pocos.
create index if not exists customers_activos_idx on public.customers (company_id) where is_active;
create index if not exists vehicles_activos_idx  on public.vehicles  (company_id) where is_active;

-- ============================================================================
-- 5 · CANDADOS, PERMISOS Y BITÁCORA, TABLA POR TABLA
-- ============================================================================

do $$
declare
  v_tabla text;
  -- Las once que se abren. En un sitio, para que la duodécima sea una palabra.
  v_tablas text[] := array[
    'services', 'products', 'customers', 'vehicles', 'suppliers',
    'promotions', 'equipment', 'bays', 'appointments', 'claims', 'fleets'
  ];
begin
  foreach v_tabla in array v_tablas loop
    execute format('drop policy if exists %I on public.%I',
                   v_tabla || '_borrar_solo_admin', v_tabla);
    execute format($p$
      create policy %I on public.%I
        as restrictive for delete to authenticated
        using (app.has_role('propietario', 'administrador', 'superadmin'))
    $p$, v_tabla || '_borrar_solo_admin', v_tabla);

    execute format('grant delete on public.%I to authenticated', v_tabla);

    execute format('drop trigger if exists %I on public.%I',
                   v_tabla || '_registrar_borrado', v_tabla);
    execute format(
      'create trigger %I after delete on public.%I for each row '
      'execute function app.registrar_borrado()',
      v_tabla || '_registrar_borrado', v_tabla);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6 · LOS MENSAJES, UNO POR TABLA, CON SUS DEPENDIENTES
--
-- Esta parte no sale de un bucle porque lo que cuenta como «historia» es
-- distinto en cada caso, y decidirlo es justo el trabajo.
-- ────────────────────────────────────────────────────────────────────────────

drop trigger if exists services_frenar_borrado on public.services;
create trigger services_frenar_borrado before delete on public.services for each row
  execute function app.frenar_borrado_con_historia(
    'invoice_items',    'service_id', 'líneas de factura',
    'work_order_items', 'service_id', 'líneas de órdenes de trabajo');

drop trigger if exists products_frenar_borrado on public.products;
create trigger products_frenar_borrado before delete on public.products for each row
  execute function app.frenar_borrado_con_historia(
    'invoice_items',       'product_id', 'líneas de factura',
    'work_order_items',    'product_id', 'líneas de órdenes de trabajo',
    'inventory_movements', 'product_id', 'entradas de kardex',
    'purchase_items',      'product_id', 'líneas de compra');

drop trigger if exists customers_frenar_borrado on public.customers;
create trigger customers_frenar_borrado before delete on public.customers for each row
  execute function app.frenar_borrado_con_historia(
    'invoices',    'customer_id', 'facturas',
    'work_orders', 'customer_id', 'órdenes de trabajo',
    'receivables', 'customer_id', 'cuentas por cobrar',
    'memberships', 'customer_id', 'membresías');

drop trigger if exists vehicles_frenar_borrado on public.vehicles;
create trigger vehicles_frenar_borrado before delete on public.vehicles for each row
  execute function app.frenar_borrado_con_historia(
    'work_orders', 'vehicle_id', 'órdenes de trabajo');

drop trigger if exists suppliers_frenar_borrado on public.suppliers;
create trigger suppliers_frenar_borrado before delete on public.suppliers for each row
  execute function app.frenar_borrado_con_historia(
    'purchases',          'supplier_id', 'compras',
    'maintenance_orders', 'supplier_id', 'órdenes de mantenimiento');

drop trigger if exists promotions_frenar_borrado on public.promotions;
create trigger promotions_frenar_borrado before delete on public.promotions for each row
  execute function app.frenar_borrado_con_historia(
    'promotion_redemptions', 'promotion_id', 'aplicaciones registradas');

drop trigger if exists equipment_frenar_borrado on public.equipment;
create trigger equipment_frenar_borrado before delete on public.equipment for each row
  execute function app.frenar_borrado_con_historia(
    'maintenance_orders', 'equipment_id', 'órdenes de mantenimiento');

drop trigger if exists bays_frenar_borrado on public.bays;
create trigger bays_frenar_borrado before delete on public.bays for each row
  execute function app.frenar_borrado_con_historia(
    'work_orders', 'bay_id', 'órdenes de trabajo');

drop trigger if exists fleets_frenar_borrado on public.fleets;
create trigger fleets_frenar_borrado before delete on public.fleets for each row
  execute function app.frenar_borrado_con_historia(
    'work_orders', 'fleet_id', 'órdenes de trabajo');

-- `appointments` y `claims` no llevan freno a propósito: una cita anotada mal y
-- un reclamo abierto por error no arrastran dinero ni historia de nadie. Los
-- eventos del reclamo son CASCADE y está bien — pertenecen al reclamo.

-- ────────────────────────────────────────────────────────────────────────────
-- 7 · UN CLIENTE SIN HISTORIA SE LLEVA SUS CARROS
--
-- `vehicles.customer_id` es ON DELETE SET NULL, así que borrar al dueño dejaría
-- vehículos sin dueño: filas que nadie encuentra ni usa. Si el cliente llegó
-- hasta aquí es que no tenía historia, y entonces sus carros tampoco.
--
-- El disparador se llama `purga` y no `borrar` por una razón práctica: los
-- disparadores del mismo evento corren en orden alfabético, y así este va
-- DESPUÉS de `customers_frenar_borrado`. Cada carro pasa además por su propio
-- freno, de modo que si alguno tuviera órdenes, el borrado entero se niega.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function app.purgar_vehiculos_del_cliente()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.vehicles where customer_id = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists customers_purgar_vehiculos on public.customers;
create trigger customers_purgar_vehiculos before delete on public.customers for each row
  execute function app.purgar_vehiculos_del_cliente();

comment on function app.purgar_vehiculos_del_cliente is
  'Al borrar un cliente sin historia se lleva sus vehículos: la clave ajena es SET NULL y quedarían filas sin dueño.';
