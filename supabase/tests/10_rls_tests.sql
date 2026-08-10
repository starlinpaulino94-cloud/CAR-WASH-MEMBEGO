-- Batería de verificación del esquema y de las políticas RLS.
-- Se ejecuta como el rol `authenticated`, no como superusuario: un superusuario
-- se salta RLS y la prueba no demostraría nada.

create schema if not exists test;

create table if not exists test.results (
  id serial primary key, name text, passed boolean, detail text
);

-- El rol `authenticated` debe poder registrar resultados. Las funciones siguen
-- siendo SECURITY INVOKER a propósito: si fuesen DEFINER, el SQL bajo prueba se
-- ejecutaría como superusuario, se saltaría RLS y las pruebas no probarían nada.
grant usage on schema test to authenticated, anon;
grant select, insert on test.results to authenticated, anon;
grant usage, select on all sequences in schema test to authenticated, anon;

-- Contexto compartido entre archivos de prueba.
-- Antes se usaba set_config(), pero esas variables son de SESIÓN y cada
-- invocación de `psql -f` abre una nueva: el segundo archivo no veía los
-- identificadores creados por el primero.
create table if not exists test.vars (k text primary key, v text);
grant select, insert, update on test.vars to authenticated, anon;

create or replace function test.set_var(p_k text, p_v text)
returns void language sql as $$
  insert into test.vars(k, v) values (p_k, p_v)
  on conflict (k) do update set v = excluded.v;
$$;

create or replace function test.var(p_k text)
returns text language sql stable as $$
  select v from test.vars where k = p_k;
$$;

create or replace function test.check(p_name text, p_condition boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into test.results(name, passed, detail) values (p_name, coalesce(p_condition,false), p_detail);
end $$;

-- Verifica que una sentencia falle (RLS, CHECK, trigger...).
create or replace function test.expect_error(p_name text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  insert into test.results(name, passed, detail) values (p_name, false, 'NO falló: la sentencia fue aceptada');
exception when others then
  insert into test.results(name, passed, detail) values (p_name, true, left(sqlerrm, 90));
end $$;

create or replace function test.expect_ok(p_name text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  insert into test.results(name, passed, detail) values (p_name, true, '');
exception when others then
  insert into test.results(name, passed, detail) values (p_name, false, left(sqlerrm, 90));
end $$;

-- RLS sobre UPDATE/DELETE NO lanza excepción: filtra las filas y la sentencia
-- reporta 0 filas afectadas. Verificar con expect_error daría un falso negativo,
-- así que se ejecuta la sentencia y se comprueba que el estado NO cambió.
create or replace function test.expect_no_effect(p_name text, p_sql text, p_still_true text)
returns void language plpgsql as $$
declare v_ok boolean;
begin
  begin execute p_sql; exception when others then null; end;
  execute 'select (' || p_still_true || ')' into v_ok;
  insert into test.results(name, passed, detail)
  values (p_name, coalesce(v_ok,false), case when coalesce(v_ok,false) then 'bloqueado, estado intacto' else 'EL ESTADO CAMBIÓ' end);
end $$;

-- =============================================================== Datos base
-- Como superusuario: dos empresas competidoras y sus usuarios.

do $$
declare
  c_a uuid; c_b uuid; b_a uuid; b_b uuid;
  u_owner_a uuid; u_cashier_a uuid; u_owner_b uuid; u_orphan uuid;
begin
  insert into public.companies (trade_name, legal_name, tax_id)
    values ('Car Wash Alfa','Alfa SRL','111-11111-1') returning id into c_a;
  insert into public.companies (trade_name, legal_name, tax_id)
    values ('Car Wash Beta','Beta SRL','222-22222-2') returning id into c_b;

  insert into public.branches (company_id, name, is_main)
    values (c_a,'Alfa Central', true) returning id into b_a;
  insert into public.branches (company_id, name, is_main)
    values (c_b,'Beta Central', true) returning id into b_b;

  -- El alta en auth.users dispara el trigger que crea el perfil SIN empresa.
  -- Se incluye company_id en los metadatos a propósito: es el vector de
  -- escalada que debe quedar ignorado.
  insert into auth.users (email, raw_user_meta_data)
    values ('owner.a@example.com', jsonb_build_object('full_name','Dueño Alfa','company_id', c_b::text))
    returning id into u_owner_a;
  insert into auth.users (email, raw_user_meta_data)
    values ('cashier.a@example.com', jsonb_build_object('full_name','Cajero Alfa'))
    returning id into u_cashier_a;
  insert into auth.users (email, raw_user_meta_data)
    values ('owner.b@example.com', jsonb_build_object('full_name','Dueño Beta'))
    returning id into u_owner_b;
  insert into auth.users (email, raw_user_meta_data)
    values ('huerfano@example.com', jsonb_build_object('full_name','Sin empresa'))
    returning id into u_orphan;

  perform test.check('el registro NO asigna empresa desde los metadatos del usuario',
    (select company_id from public.profiles where id = u_owner_a) is null,
    'vector de escalada de privilegios cerrado');

  -- Un administrador asigna los tenants (aquí, el proceso de alta). Desde 0031
  -- la sucursal está protegida por un guardia (nadie se muda de local por su
  -- cuenta), así que el montaje declara el contexto igual que create_employee().
  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles set company_id=c_a, branch_id=b_a, role='propietario' where id=u_owner_a;
  update public.profiles set company_id=c_a, branch_id=b_a, role='cajero'      where id=u_cashier_a;
  update public.profiles set company_id=c_b, branch_id=b_b, role='propietario' where id=u_owner_b;
  perform set_config('app.branch_ctx', '', true);
  -- u_orphan queda sin empresa a propósito.

  -- Catálogo y datos de cada empresa.
  insert into public.services (company_id, code, name) values (c_a,'S1','Lavado Alfa');
  insert into public.services (company_id, code, name) values (c_b,'S1','Lavado Beta');
  insert into public.customers (company_id, name, phone) values (c_a,'Cliente de Alfa','809-555-0001');
  insert into public.customers (company_id, name, phone) values (c_b,'Cliente de Beta','809-555-0002');
  insert into public.vehicles (company_id, plate, make) values (c_a,'a-000 111','Toyota');
  insert into public.vehicles (company_id, plate, make) values (c_b,'B000222','Honda');

  -- Rango NCF vigente solo para Alfa.
  insert into public.ncf_sequences (company_id, ncf_type, range_start, range_end, next_value, authorized_until)
    values (c_a,'B02',1,3,1, current_date + 365);

  perform test.set_var('c_a', c_a::text);
  perform test.set_var('c_b', c_b::text);
  perform test.set_var('b_a', b_a::text);
  perform test.set_var('u_owner_a', u_owner_a::text);
  perform test.set_var('u_cashier_a', u_cashier_a::text);
  perform test.set_var('u_owner_b', u_owner_b::text);
  perform test.set_var('u_orphan', u_orphan::text);
end $$;

-- Normalización de placa (se insertó 'a-000 111').
select test.check('la placa se normaliza a mayúsculas y sin separadores',
  (select plate from public.vehicles where company_id = test.var('c_a')::uuid) = 'A000111',
  (select plate from public.vehicles where company_id = test.var('c_a')::uuid));

-- =============================================================== Aislamiento

set role authenticated;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);

select test.check('el usuario de Alfa ve su propia empresa',
  (select count(*) from public.companies) = 1);

select test.check('el usuario de Alfa NO ve la empresa Beta',
  not exists (select 1 from public.companies where trade_name = 'Car Wash Beta'));

select test.check('el usuario de Alfa solo ve sus clientes',
  (select count(*) from public.customers) = 1
  and exists (select 1 from public.customers where name = 'Cliente de Alfa'));

select test.check('el usuario de Alfa solo ve sus vehículos',
  (select count(*) from public.vehicles) = 1);

select test.check('el usuario de Alfa solo ve su catálogo de servicios',
  (select count(*) from public.services) = 1
  and exists (select 1 from public.services where name = 'Lavado Alfa'));

-- Inserción cruzada de tenant.
select test.expect_error('no puede insertar un cliente en la empresa ajena',
  format('insert into public.customers (company_id, name) values (%L, %L)',
         test.var('c_b'), 'Infiltrado'));

-- Escalada de privilegios sobre el propio perfil.
select test.expect_error('no puede cambiar su propia empresa',
  format('update public.profiles set company_id = %L where id = %L',
         test.var('c_b'), test.var('u_owner_a')));

select test.expect_no_effect('un propietario NO puede auto-ascenderse a superadmin',
  format('update public.profiles set role = ''superadmin'' where id = %L', test.var('u_owner_a')),
  format('(select role from public.profiles where id = %L) = ''propietario''', test.var('u_owner_a')));

-- Usuario sin empresa asignada: fallo cerrado.
select set_config('request.jwt.claim.sub', test.var('u_orphan'), false);

select test.check('un usuario recién registrado no ve NINGUNA empresa',
  (select count(*) from public.companies) = 0);
select test.check('un usuario recién registrado no ve NINGÚN cliente',
  (select count(*) from public.customers) = 0);
select test.check('un usuario recién registrado no ve NINGUNA orden',
  (select count(*) from public.work_orders) = 0);
select test.expect_error('un usuario sin empresa no puede insertar nada',
  format('insert into public.customers (company_id, name) values (%L, %L)',
         test.var('c_a'), 'Colado'));

-- =============================================================== Negocio

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- Numeración correlativa de órdenes.
do $$
declare v_o1 uuid; v_o2 uuid; n1 text; n2 text; v_c uuid; v_b uuid;
begin
  v_c := test.var('c_a')::uuid;
  v_b := test.var('b_a')::uuid;
  insert into public.work_orders (company_id, branch_id, customer_name, vehicle_plate)
    values (v_c, v_b, 'Cliente 1', 'A000111') returning id, order_number into v_o1, n1;
  insert into public.work_orders (company_id, branch_id, customer_name, vehicle_plate)
    values (v_c, v_b, 'Cliente 2', 'A000112') returning id, order_number into v_o2, n2;

  perform test.check('los números de orden son correlativos y distintos',
    n1 <> n2 and n1 like 'CW-%-00001' and n2 like 'CW-%-00002', n1 || ' / ' || n2);

  -- Totales derivados: 2 × 100,00 con ITBIS al 18%.
  insert into public.work_order_items
    (work_order_id, item_type, name, quantity, unit_price_cents)
    values (v_o1, 'service', 'Lavado', 2, 10000);

  perform test.check('los totales se derivan de las líneas con una sola fórmula',
    (select subtotal_cents = 20000 and tax_cents = 3600 and total_cents = 23600
       from public.work_orders where id = v_o1),
    (select format('sub=%s tax=%s total=%s', subtotal_cents, tax_cents, total_cents)
       from public.work_orders where id = v_o1));

  -- Línea cubierta por Membego: no paga ITBIS ni suma al total.
  insert into public.work_order_items
    (work_order_id, item_type, name, quantity, unit_price_cents, is_membego_covered)
    values (v_o1, 'service', 'Encerado (beneficio)', 1, 50000, true);

  perform test.check('el beneficio Membego sale de la base imponible',
    (select membego_benefit_cents = 50000 and tax_cents = 3600 and total_cents = 23600
       from public.work_orders where id = v_o1),
    (select format('membego=%s tax=%s total=%s', membego_benefit_cents, tax_cents, total_cents)
       from public.work_orders where id = v_o1));

  perform test.set_var('o1', v_o1::text);
end $$;

-- Descuento superior al importe de la línea.
select test.expect_error('rechaza un descuento mayor que el importe de la línea',
  format('insert into public.work_order_items (work_order_id, item_type, name, quantity, unit_price_cents, discount_cents)
          values (%L, ''service'', ''Abuso'', 1, 1000, 5000)', test.var('o1')));

select test.expect_error('rechaza un precio negativo',
  format('insert into public.work_order_items (work_order_id, item_type, name, quantity, unit_price_cents)
          values (%L, ''service'', ''Negativo'', 1, -1000)', test.var('o1')));

select test.expect_error('rechaza cantidad cero',
  format('insert into public.work_order_items (work_order_id, item_type, name, quantity, unit_price_cents)
          values (%L, ''service'', ''Cero'', 0, 1000)', test.var('o1')));

-- Placa duplicada dentro de la empresa.
select test.expect_error('rechaza una placa duplicada en la misma empresa',
  format('insert into public.vehicles (company_id, plate) values (%L, ''A000111'')',
         test.var('c_a')));

-- =============================================================== Caja

do $$
declare v_s uuid; v_c uuid; v_b uuid;
begin
  v_c := test.var('c_a')::uuid;
  v_b := test.var('b_a')::uuid;
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values (v_c, v_b, test.var('u_cashier_a')::uuid, 300000)
    returning id into v_s;
  perform test.set_var('s1', v_s::text);

  insert into public.cash_movements (company_id, cash_session_id, type, method, amount_cents, reason)
    values (v_c, v_s, 'inflow', 'efectivo', 100000, 'Venta en efectivo');
  insert into public.cash_movements (company_id, cash_session_id, type, method, amount_cents, reason)
    values (v_c, v_s, 'inflow', 'tarjeta', 250000, 'Venta con tarjeta');

  perform test.check('el efectivo esperado solo cuenta el efectivo',
    (select expected_cash_cents = 400000 and total_card_sales_cents = 250000
       from public.cash_sessions where id = v_s),
    (select format('esperado=%s tarjeta=%s', expected_cash_cents, total_card_sales_cents)
       from public.cash_sessions where id = v_s));

  perform test.check('total_inflows SÍ se mantiene (antes nunca se incrementaba)',
    (select total_inflows_cents = 350000 from public.cash_sessions where id = v_s));

  -- Salida mayor que el saldo: debe quedar NEGATIVO, no recortado a cero.
  insert into public.cash_movements (company_id, cash_session_id, type, method, amount_cents, reason)
    values (v_c, v_s, 'outflow', 'efectivo', 500000, 'Retiro grande');

  perform test.check('un descuadre negativo se refleja, no se recorta a cero',
    (select expected_cash_cents = -100000 from public.cash_sessions where id = v_s),
    (select expected_cash_cents::text from public.cash_sessions where id = v_s));
end $$;

select test.expect_error('solo se admite una caja abierta por sucursal',
  format('insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
          values (%L, %L, %L, 1000)',
         test.var('c_a'), test.var('b_a'), test.var('u_cashier_a')));

-- =============================================================== Fiscalidad

do $$
declare n1 text; n2 text; n3 text;
begin
  n1 := app.allocate_ncf(test.var('c_a')::uuid, 'B02');
  n2 := app.allocate_ncf(test.var('c_a')::uuid, 'B02');
  n3 := app.allocate_ncf(test.var('c_a')::uuid, 'B02');
  perform test.check('los NCF son correlativos, sin huecos y con formato DGII',
    n1 = 'B0200000001' and n2 = 'B0200000002' and n3 = 'B0200000003',
    n1 || ' ' || n2 || ' ' || n3);
end $$;

-- El rango sembrado era de 3: el cuarto debe fallar en lugar de inventar.
select test.expect_error('al agotarse el rango NCF falla en vez de improvisar',
  format('select app.allocate_ncf(%L, ''B02'')', test.var('c_a')));

select test.expect_error('sin rango autorizado para ese tipo, no se emite NCF',
  format('select app.allocate_ncf(%L, ''B01'')', test.var('c_a')));

-- Numeración de facturas.
do $$
declare v_i uuid; f1 text;
begin
  insert into public.invoices (company_id, branch_id, customer_name, cashier_id, cash_session_id)
    values (test.var('c_a')::uuid, test.var('b_a')::uuid,
            'Cliente', test.var('u_cashier_a')::uuid, test.var('s1')::uuid)
    returning id, invoice_number into v_i, f1;
  perform test.check('la factura recibe numeración correlativa del servidor',
    f1 = 'FAC-00000001', f1);
  perform test.set_var('i1', v_i::text);
end $$;

-- Anulación sin motivo: se prueba como propietario, que SÍ tiene permiso,
-- para que lo que falle sea la restricción CHECK y no el filtro de RLS.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('no se puede anular sin motivo ni fecha',
  format('update public.invoices set is_annulled = true where id = %L', test.var('i1')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

-- =============================================================== Auditoría

do $$
begin
  insert into public.audit_logs (company_id, action, entity, details)
    values (test.var('c_a')::uuid, 'PRUEBA', 'Test', 'entrada de prueba');
  -- El cajero puede escribir en la bitácora pero no leerla (política correcta),
  -- así que la comprobación se hace con un rol autorizado.
  set local role postgres;
  perform test.check('la bitácora sella al actor desde el perfil autenticado, no desde el cliente',
    (select actor_id = test.var('u_cashier_a')::uuid and actor_role = 'cajero'
       from public.audit_logs order by id desc limit 1),
    (select coalesce(actor_name,'(nulo)') from public.audit_logs order by id desc limit 1));
  set local role authenticated;
end $$;

select test.expect_error('la bitácora rechaza UPDATE (es de solo inserción)',
  'update public.audit_logs set details = ''manipulado'' where action = ''PRUEBA''');

select test.expect_error('la bitácora rechaza DELETE',
  'delete from public.audit_logs where action = ''PRUEBA''');

-- =============================================================== Roles

-- El cajero NO debe poder anular facturas (política restringida a mando).
select test.expect_no_effect('un cajero NO puede anular una factura',
  format('update public.invoices set is_annulled = true, annulled_at = now(),
          annulled_reason = ''intento'' where id = %L', test.var('i1')),
  format('(select not is_annulled from public.invoices where id = %L)', test.var('i1')));

-- El propietario sí.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_ok('un propietario sí puede anular una factura',
  format('update public.invoices set is_annulled = true, annulled_at = now(),
          annulled_reason = ''anulación autorizada'' where id = %L', test.var('i1')));

-- Un cajero no puede tocar los precios del catálogo.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_no_effect('un cajero NO puede modificar el catálogo de servicios',
  'update public.services set name = ''Precio manipulado''',
  '(select count(*) = 0 from public.services where name = ''Precio manipulado'')');

-- Los contadores de documentos quedan fuera de alcance directo.
select test.expect_error('los contadores de numeración no son accesibles al cliente',
  'select * from public.document_counters');

-- Techo de concesión de roles: el administrador no puede crear propietarios.
set role postgres;
insert into auth.users (email) values ('admin.a@example.com');
-- En un bloque: `set_config(..., true)` es local a la transacción, y psql abre
-- una por sentencia. Suelto, el contexto se perdería antes del UPDATE.
do $$
begin
  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles set company_id = test.var('c_a')::uuid,
         branch_id = test.var('b_a')::uuid, role = 'administrador'
   where email = 'admin.a@example.com';
  perform set_config('app.branch_ctx', '', true);
end $$;
select test.set_var('u_admin_a', (select id::text from public.profiles where email='admin.a@example.com'));
select set_config('request.jwt.claim.sub', test.var('u_admin_a'), false);
set role authenticated;

select test.expect_no_effect('un administrador NO puede ascender a nadie a propietario',
  format('update public.profiles set role = ''propietario'' where id = %L', test.var('u_cashier_a')),
  format('(select role from public.profiles where id = %L) = ''cajero''', test.var('u_cashier_a')));

select test.expect_no_effect('un administrador NO puede auto-ascenderse',
  format('update public.profiles set role = ''propietario'' where id = %L', test.var('u_admin_a')),
  format('(select role from public.profiles where id = %L) = ''administrador''', test.var('u_admin_a')));

-- La empresa Beta no ve nada de lo creado por Alfa.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.check('la empresa Beta no ve las órdenes de Alfa',
  (select count(*) from public.work_orders) = 0);
select test.check('la empresa Beta no ve las facturas de Alfa',
  (select count(*) from public.invoices) = 0);
select test.check('la empresa Beta no ve las sesiones de caja de Alfa',
  (select count(*) from public.cash_sessions) = 0);
select test.check('la empresa Beta no ve la bitácora de Alfa',
  (select count(*) from public.audit_logs) = 0);
select test.check('la empresa Beta no ve los rangos NCF de Alfa',
  (select count(*) from public.ncf_sequences) = 0);

reset role;

-- =============================================================== Cobertura RLS

-- Ninguna tabla de negocio puede quedarse sin RLS por olvido.
select test.check('todas las tablas de public tienen RLS activo y forzado',
  not exists (
    select 1 from pg_tables t
    join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
    where t.schemaname = 'public'
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ),
  coalesce((select string_agg(t.tablename, ', ') from pg_tables t
    join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
    where t.schemaname='public' and not (c.relrowsecurity and c.relforcerowsecurity)), 'ninguna sin RLS'));
