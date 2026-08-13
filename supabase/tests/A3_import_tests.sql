-- =============================================================================
-- Pruebas de importación masiva (migración 0035)
-- =============================================================================
-- Continúa sobre Alfa/Beta (10_rls). Lo que se demuestra:
--   · el ensayo NO escribe, y sin embargo cuenta exactamente lo que escribiría;
--   · importar dos veces el mismo archivo no duplica a nadie;
--   · un teléfono escrito de otra forma es el mismo cliente;
--   · una fila mala se reporta y las buenas entran igual;
--   · la existencia de un producto que ya existe no se toca por importación;
--   · una empresa no ve ni pisa los datos de la otra.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ============================================== Los conversores, por separado
-- Si estos fallan, todo lo demás importa basura en silencio.

select test.check('«$1,271.11 DOP» son 127111 centavos',
  app.parse_money('$1,271.11 DOP') = 127111);
select test.check('«1.271,11» a la europea también',
  app.parse_money('1.271,11') = 127111);
select test.check('«900» sin decimales son 90000 centavos',
  app.parse_money('900') = 90000);
select test.check('«1,200» es mil doscientos, no uno con dos',
  app.parse_money('1,200') = 120000);
select test.check('«RD$ 42.37» son 4237 centavos',
  app.parse_money('RD$ 42.37') = 4237);
select test.check('un texto sin números no es un importe',
  app.parse_money('gratis') is null);

select test.check('«829-481-6319» y «8294816319» son el mismo teléfono',
  app.phone_key('829-481-6319') = app.phone_key('8294816319'));
select test.check('el 1 de país no hace distinto a un número local',
  app.phone_key('18294816319') = app.phone_key('829-481-6319'));
select test.check('un número de 10 cifras se presenta con guiones',
  app.format_phone('8294816319') = '829-481-6319');
select test.check('un número extranjero se deja como vino, con el más',
  app.format_phone('34 639 975 008') = '+34639975008');

select test.check('«Activo» es verdadero', app.parse_bool('Activo') = true);
select test.check('vacío no es ni sí ni no', app.parse_bool('') is null);
select test.check('una categoría en español se reconoce',
  app.parse_vehicle_category('Camioneta') = 'suv');
select test.check('una categoría inventada no se reconoce',
  app.parse_vehicle_category('nave espacial') is null);

-- ==================================================== Quién puede importar
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_error('un cajero no importa',
  $q$select public.import_batch('clientes',
       jsonb_build_array(jsonb_build_object('nombre','Pirata')), true)$q$);

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.expect_error('una entidad inventada se rechaza',
  $q$select public.import_batch('facturas',
       jsonb_build_array(jsonb_build_object('nombre','X')), true)$q$);
select test.expect_error('un archivo vacío se rechaza',
  $q$select public.import_batch('clientes', '[]'::jsonb, true)$q$);

-- ======================================================= El ensayo no escribe
select test.set_var('imp_clientes_pre',
  (select count(*) from public.customers where company_id = test.var('c_a')::uuid)::text);

select test.set_var('imp_ensayo',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Pedro','apellido','Almonte','telefono','829-111-2222'),
    jsonb_build_object('nombre','Ana','apellido','Reyes','telefono','8093334444',
                       'correo','ANA@Ejemplo.COM')
  ), false)::text);

select test.check('el ensayo anuncia dos altas',
  (test.var('imp_ensayo')::jsonb -> 'resumen' ->> 'crear') = '2');
select test.check('el ensayo se declara ensayo',
  (test.var('imp_ensayo')::jsonb ->> 'aplicado') = 'false');
select test.check('el ensayo NO escribió nada',
  (select count(*) from public.customers where company_id = test.var('c_a')::uuid)
    = test.var('imp_clientes_pre')::bigint);

-- ========================================================= Aplicar sí escribe
select test.set_var('imp_real',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Pedro','apellido','Almonte','telefono','829-111-2222'),
    jsonb_build_object('nombre','Ana','apellido','Reyes','telefono','8093334444',
                       'correo','ANA@Ejemplo.COM')
  ), true)::text);

select test.check('se crearon los dos clientes',
  (select count(*) from public.customers where company_id = test.var('c_a')::uuid)
    = test.var('imp_clientes_pre')::bigint + 2);
select test.check('el nombre y el apellido se juntan en uno',
  exists (select 1 from public.customers
          where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte'));
select test.check('el teléfono se guarda con formato dominicano',
  (select phone from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte') = '829-111-2222');
select test.check('el correo se guarda en minúsculas',
  (select email from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Ana Reyes') = 'ana@ejemplo.com');
select test.check('la importación aplicada queda en la bitácora',
  exists (select 1 from public.audit_logs
          where company_id = test.var('c_a')::uuid and action = 'IMPORTAR' and entity = 'clientes'));

-- ============================================ Repetir el archivo no duplica
select test.set_var('imp_otra_vez',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Pedro','apellido','Almonte','telefono','829-111-2222')
  ), true)::text);

select test.check('el segundo pase no crea a nadie',
  (test.var('imp_otra_vez')::jsonb -> 'resumen' ->> 'crear') = '0');
select test.check('el segundo pase lo da por ya registrado',
  (test.var('imp_otra_vez')::jsonb -> 'resumen' ->> 'omitir') = '1');
select test.check('sigue habiendo un solo Pedro Almonte',
  (select count(*) from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte') = 1);

-- El mismo número escrito de otra forma sigue siendo la misma persona.
select test.set_var('imp_mismo_tel',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Pedro Almonte','telefono','18291112222',
                       'correo','pedro@ejemplo.com')
  ), true)::text);

select test.check('un teléfono con el 1 delante no crea otro cliente',
  (test.var('imp_mismo_tel')::jsonb -> 'resumen' ->> 'crear') = '0');
select test.check('y el correo que faltaba sí se completa',
  (select email from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte') = 'pedro@ejemplo.com');

-- Un dato vacío en el archivo no borra el que ya está.
select test.set_var('imp_no_borra',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Pedro Almonte','telefono','829-111-2222','correo','')
  ), true)::text);

select test.check('una columna vacía NO borra lo que ya había',
  (select email from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte') = 'pedro@ejemplo.com');

-- ================================================ Una fila mala no tumba nada
select test.set_var('imp_mixto',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Buena','telefono','8497770001'),
    jsonb_build_object('nombre','','telefono','8497770002'),
    jsonb_build_object('nombre','Tambien Buena','telefono','8497770003')
  ), true)::text);

select test.check('la fila sin nombre se cuenta como error',
  (test.var('imp_mixto')::jsonb -> 'resumen' ->> 'error') = '1');
select test.check('las otras dos entran igual',
  (test.var('imp_mixto')::jsonb -> 'resumen' ->> 'crear') = '2');
select test.check('el informe dice qué fila falló',
  exists (select 1 from jsonb_array_elements(test.var('imp_mixto')::jsonb -> 'detalle') d
          where d ->> 'accion' = 'error' and (d ->> 'fila')::int = 2));
select test.check('la fila buena posterior al error sí quedó guardada',
  exists (select 1 from public.customers
          where company_id = test.var('c_a')::uuid and name = 'Tambien Buena'));

-- El teléfono es la identidad, pero un archivo no renombra a nadie.
select test.set_var('imp_homonimo',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Otra Persona','telefono','829-111-2222')
  ), true)::text);

select test.check('un teléfono ya registrado no crea un cliente gemelo',
  (test.var('imp_homonimo')::jsonb -> 'resumen' ->> 'crear') = '0');
select test.check('y avisa de quién es ese teléfono',
  (select d ->> 'nota' from jsonb_array_elements(test.var('imp_homonimo')::jsonb -> 'detalle') d
   limit 1) like '%mismo teléfono que «Pedro Almonte»%');
select test.check('el nombre del cliente ya registrado no se toca',
  exists (select 1 from public.customers
          where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte'));

-- Un correo con forma inválida no bloquea la fila: entra el cliente, cae el correo.
select test.set_var('imp_correo_malo',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Correo Torcido','telefono','8095550009','correo','esto-no-es-correo')
  ), true)::text);

select test.check('un correo inválido no rechaza al cliente',
  (test.var('imp_correo_malo')::jsonb -> 'resumen' ->> 'crear') = '1');
select test.check('pero el correo inválido no se guarda',
  (select email from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Correo Torcido') is null);

-- ==================================================== Servicios y sus precios
select test.set_var('imp_serv',
  public.import_batch('servicios', jsonb_build_array(
    jsonb_build_object('nombre','Cuidado Estandar','precio','900.00',
                       'precio_suv','1,300.00', 'precio_pickup','1,500.00',
                       'categoria','Lavado','minutos','45'),
    jsonb_build_object('nombre','Brillado de faroles','precio','$1,271.11 DOP')
  ), true)::text);

select test.check('los dos servicios se crearon',
  (test.var('imp_serv')::jsonb -> 'resumen' ->> 'crear') = '2');
select test.check('al servicio sin código se le fabrica uno',
  (select code from public.services
   where company_id = test.var('c_a')::uuid and name = 'Cuidado Estandar') = 'CUIDADO-ESTANDAR');
select test.check('el precio general cubre el sedán',
  (select price_cents from public.service_prices sp
     join public.services s on s.id = sp.service_id
   where s.company_id = test.var('c_a')::uuid and s.name = 'Cuidado Estandar'
     and sp.vehicle_category = 'sedan') = 90000);
select test.check('y la columna por categoría pisa a la general',
  (select price_cents from public.service_prices sp
     join public.services s on s.id = sp.service_id
   where s.company_id = test.var('c_a')::uuid and s.name = 'Cuidado Estandar'
     and sp.vehicle_category = 'suv') = 130000);
select test.check('el importe con símbolo y miles se lee bien',
  (select price_cents from public.service_prices sp
     join public.services s on s.id = sp.service_id
   where s.company_id = test.var('c_a')::uuid and s.name = 'Brillado de faroles'
     and sp.vehicle_category = 'sedan') = 127111);

-- Reimportar con otro precio actualiza; no crea un servicio gemelo.
select test.set_var('imp_serv2',
  public.import_batch('servicios', jsonb_build_array(
    jsonb_build_object('nombre','Cuidado Estandar','precio_suv','1,400.00')
  ), true)::text);

select test.check('el mismo servicio se actualiza, no se duplica',
  (test.var('imp_serv2')::jsonb -> 'resumen' ->> 'actualizar') = '1');
select test.check('el precio nuevo quedó',
  (select price_cents from public.service_prices sp
     join public.services s on s.id = sp.service_id
   where s.company_id = test.var('c_a')::uuid and s.name = 'Cuidado Estandar'
     and sp.vehicle_category = 'suv') = 140000);
select test.check('y el que no venía en el archivo no se tocó',
  (select price_cents from public.service_prices sp
     join public.services s on s.id = sp.service_id
   where s.company_id = test.var('c_a')::uuid and s.name = 'Cuidado Estandar'
     and sp.vehicle_category = 'pickup') = 150000);

-- ================================== Productos: la existencia no se importa
select test.set_var('imp_prod',
  public.import_batch('productos', jsonb_build_array(
    jsonb_build_object('nombre','Gatorade Uva','precio','84.75','costo','60',
                       'existencia','24','unidad','Botella')
  ), true)::text);

select test.check('el producto nuevo entra con su existencia inicial',
  (select stock from public.products
   where company_id = test.var('c_a')::uuid and name = 'Gatorade Uva') = 24);
select test.check('el alta con existencia deja movimiento de kardex',
  exists (select 1 from public.inventory_movements m
            join public.products p on p.id = m.product_id
          where p.company_id = test.var('c_a')::uuid and p.name = 'Gatorade Uva'));

select test.set_var('imp_prod2',
  public.import_batch('productos', jsonb_build_array(
    jsonb_build_object('nombre','Gatorade Uva','precio','95.00','existencia','999')
  ), true)::text);

select test.check('reimportar sí corrige el precio',
  (select price_cents from public.products
   where company_id = test.var('c_a')::uuid and name = 'Gatorade Uva') = 9500);
select test.check('pero NO toca la existencia de un producto que ya existe',
  (select stock from public.products
   where company_id = test.var('c_a')::uuid and name = 'Gatorade Uva') = 24);
select test.check('y avisa que la ignoró',
  (select d ->> 'nota' from jsonb_array_elements(test.var('imp_prod2')::jsonb -> 'detalle') d
   limit 1) like '%existencia ignorada%');

-- ============================================ Vehículos y su dueño por teléfono
select test.set_var('imp_veh',
  public.import_batch('vehiculos', jsonb_build_array(
    jsonb_build_object('placa','a-123456','marca','Toyota','modelo','Corolla',
                       'ano','2019','categoria','Sedán','telefono_cliente','829 111 2222'),
    jsonb_build_object('placa','B654321','marca','Honda','modelo','CR-V',
                       'categoria','Camioneta','telefono_cliente','809-000-0000')
  ), true)::text);

select test.check('la placa se guarda normalizada',
  exists (select 1 from public.vehicles
          where company_id = test.var('c_a')::uuid and plate = 'A123456'));
select test.check('el vehículo queda pegado a su dueño por el teléfono',
  (select c.name from public.vehicles v
     join public.customers c on c.id = v.customer_id
   where v.company_id = test.var('c_a')::uuid and v.plate = 'A123456') = 'Pedro Almonte');
select test.check('la categoría en español se traduce',
  (select category from public.vehicles
   where company_id = test.var('c_a')::uuid and plate = 'B654321') = 'suv');
select test.check('un dueño que no existe no pierde el vehículo',
  (select customer_id from public.vehicles
   where company_id = test.var('c_a')::uuid and plate = 'B654321') is null);
select test.check('y el informe lo advierte',
  exists (select 1 from jsonb_array_elements(test.var('imp_veh')::jsonb -> 'detalle') d
          where d ->> 'nota' like '%no se encontró al dueño%'));

-- ====================================================== Aislamiento por empresa
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

select test.set_var('imp_beta',
  public.import_batch('clientes', jsonb_build_array(
    jsonb_build_object('nombre','Pedro Almonte','telefono','829-111-2222')
  ), true)::text);

select test.check('Beta no ve al cliente de Alfa: lo crea en su propia empresa',
  (test.var('imp_beta')::jsonb -> 'resumen' ->> 'crear') = '1');

-- Las dos comprobaciones siguientes cuentan filas de AMBAS empresas, y ninguna
-- sesión con RLS puede hacer eso: se hacen desde postgres a propósito.
set role postgres;

select test.check('y sigue habiendo un solo Pedro Almonte en Alfa',
  (select count(*) from public.customers
   where company_id = test.var('c_a')::uuid and name = 'Pedro Almonte') = 1);
select test.check('Beta tiene el suyo, aparte',
  (select count(*) from public.customers
   where company_id = test.var('c_b')::uuid and name = 'Pedro Almonte') = 1);

set role postgres;
