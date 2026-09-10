-- ============================================================================
-- CATEGORÍAS DE SERVICIO · siembra, aislamiento, permisos y clasificación
-- ============================================================================
-- Lo que se vigila aquí es que agrupar el catálogo no abra una puerta: las
-- categorías son de la empresa que las crea, las crea quien gestiona catálogo,
-- y desactivar una NO toca los servicios que cuelgan de ella.

set role postgres;

-- ---- La siembra llega a todas las empresas, no solo a la primera.
select test.check('cada empresa nace con las ocho categorías de servicio',
  (select count(*) = 8 from public.service_categories
    where company_id = test.var('c_a')::uuid));
select test.check('y la empresa B también las tiene, con sus propias filas',
  (select count(*) = 8 from public.service_categories
    where company_id = test.var('c_b')::uuid));

-- ---- Lo que ve un cajero. Necesita leerlas para que el filtro de la caja
-- funcione, y no puede ver las de otro inquilino.
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.check('el cajero VE las categorías de su empresa (el filtro las usa)',
  (select count(*) = 8 from public.service_categories));
select test.check('y NO ve las de otra empresa',
  not exists (select 1 from public.service_categories
               where company_id = test.var('c_b')::uuid));

select test.expect_error('el cajero NO puede crear una categoría de servicio',
  $q$select public.create_service_category('Inventada')$q$);
select test.expect_error('ni renombrar una existente',
  $q$select public.update_service_category(
       (select id from public.service_categories where code = 'lavado'), 'Otra cosa')$q$);

-- ---- El propietario sí, y el código se normaliza solo.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select test.set_var('cat_nueva',
  (public.create_service_category('Detallado Fino')).id::text);

select test.check('el propietario crea una categoría y el código se normaliza',
  (select code = 'detallado_fino' and label = 'Detallado Fino'
     from public.service_categories where id = test.var('cat_nueva')::uuid));
select test.check('y nace en SU empresa, no en otra',
  (select company_id = test.var('c_a')::uuid
     from public.service_categories where id = test.var('cat_nueva')::uuid));
select test.check('el orden se calcula solo: va después de las que ya había',
  (select sort_order > 0 from public.service_categories
    where id = test.var('cat_nueva')::uuid));

select test.expect_error('no deja crear dos veces la misma categoría',
  $q$select public.create_service_category('detallado fino')$q$);
select test.expect_error('rechaza un nombre que no da un código válido',
  $q$select public.create_service_category('123')$q$);
select test.expect_error('y uno vacío',
  $q$select public.create_service_category('   ')$q$);

-- ---- Editar.
select test.check('renombrar cambia la etiqueta y deja el código quieto',
  (select label = 'Detallado Premium' and code = 'detallado_fino'
     from public.update_service_category(test.var('cat_nueva')::uuid, 'Detallado Premium')));

select test.expect_error('no se puede editar una categoría de otra empresa',
  $q$select public.update_service_category(
       (select id from public.service_categories
         where company_id = test.var('c_b')::uuid and code = 'lavado'), 'Robada')$q$);

-- ---- Desactivar esconde la categoría, NO reclasifica lo que cuelga de ella.
-- Es la invariante que de verdad importa: un servicio que pierde su categoría
-- perdería su sitio en el filtro y, si alguien lo atara al precio, su precio.
set role postgres;
update public.services set category = 'detallado_fino'
 where id = test.var('serv')::uuid;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

select public.update_service_category(test.var('cat_nueva')::uuid, null, null, false);

select test.check('desactivar la categoría NO cambia el servicio que la usaba',
  (select category = 'detallado_fino' from public.services
    where id = test.var('serv')::uuid));
select test.check('y el servicio sigue activo y vendible',
  (select is_active from public.services where id = test.var('serv')::uuid));

-- Reactivar la devuelve al filtro sin tocar nada más.
select public.update_service_category(test.var('cat_nueva')::uuid, null, null, true);
select test.check('reactivarla la devuelve al filtro con sus servicios dentro',
  (select c.is_active and s.category = c.code
     from public.service_categories c, public.services s
    where c.id = test.var('cat_nueva')::uuid and s.id = test.var('serv')::uuid));

reset role;

-- ============================================================================
-- Lo que se escriba en services.category acaba siendo una categoría de verdad
-- ============================================================================
-- La importación de CSV escribe esta columna con lo que alguien tecleó en
-- Excel. Sin normalizar, el servicio apuntaría a un código inexistente y
-- desaparecería del filtro sin decir por qué.
set role postgres;

-- 1) Un código válido se respeta tal cual.
update public.services set category = 'brillado' where id = test.var('serv')::uuid;
select test.check('un código válido se guarda tal cual',
  (select category = 'brillado' from public.services where id = test.var('serv')::uuid));

-- 2) La ETIQUETA se traduce a su código. Es lo que hace que exportar a Excel,
--    editar y reimportar no rompa la clasificación.
update public.services set category = 'Brillado y pulido' where id = test.var('serv')::uuid;
select test.check('la etiqueta del CSV se traduce a su código',
  (select category = 'brillado' from public.services where id = test.var('serv')::uuid));

update public.services set category = 'BRILLADO Y PULIDO' where id = test.var('serv')::uuid;
select test.check('y no distingue mayúsculas al traducir la etiqueta',
  (select category = 'brillado' from public.services where id = test.var('serv')::uuid));

-- 3) Un tipo de trabajo que no existía entra al catálogo en vez de perderse.
update public.services set category = 'Lavado de Motor' where id = test.var('serv')::uuid;
select test.check('un texto nuevo crea su categoría y se queda con el código',
  (select category = 'lavado_de_motor' from public.services where id = test.var('serv')::uuid));
select test.check('la categoría nueva existe y conserva el texto como etiqueta',
  exists (select 1 from public.service_categories
           where company_id = test.var('c_a')::uuid
             and code = 'lavado_de_motor' and label = 'Lavado de Motor'));
select test.check('y nace SOLO en la empresa del servicio',
  not exists (select 1 from public.service_categories
               where company_id = test.var('c_b')::uuid and code = 'lavado_de_motor'));

-- 4) Lo que no da ningún código válido se queda sin categoría, no apuntando
--    a la nada: así se ve en el filtro bajo «Sin categoría» y se puede arreglar.
update public.services set category = '123' where id = test.var('serv')::uuid;
select test.check('un texto que no da código válido deja el servicio sin categoría',
  (select category = '' from public.services where id = test.var('serv')::uuid));

-- 5) Un servicio nuevo importado con la etiqueta también queda bien clasificado.
insert into public.services (company_id, code, name, category, estimated_minutes)
values (test.var('c_a')::uuid, 'CSV-01', 'Importado del Excel', 'Reparaciones', 30);
select test.check('un servicio recién importado también se normaliza al insertar',
  (select category = 'reparacion' from public.services
    where company_id = test.var('c_a')::uuid and code = 'CSV-01'));

reset role;
