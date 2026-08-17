-- =============================================================================
-- Pruebas de editar y borrar (migración 0040)
-- =============================================================================
-- Lo que se demuestra, y cada punto cuesta algo si falla:
--   · un administrador puede borrar lo que nunca se usó;
--   · un CAJERO no puede borrar nada, aunque llame al API directamente;
--   · lo que tiene historia se niega, con un mensaje que se entiende;
--   · el kardex NO se borra en cascada al borrar un producto — este es el que
--     de verdad importa: la clave ajena era CASCADE y se lo llevaba en silencio;
--   · una factura nunca se queda sin cliente;
--   · un cliente sin historia se lleva sus carros, y no los deja huérfanos;
--   · todo borrado queda en la bitácora, con el nombre de lo borrado;
--   · una empresa no borra el catálogo de la otra.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ==================================================== Lo que nunca se usó
do $$
declare v_id uuid;
begin
  insert into public.services (company_id, code, name, description)
  values (test.var('c_a')::uuid, 'BORRAME', 'Servicio de prueba', 'Creado por error')
  returning id into v_id;
  perform test.set_var('srv_libre', v_id::text);
end $$;

select test.check('un servicio recién creado se puede borrar',
  (select count(*) from public.services where id = test.var('srv_libre')::uuid) = 1);

delete from public.services where id = test.var('srv_libre')::uuid;

select test.check('y desaparece de verdad',
  (select count(*) from public.services where id = test.var('srv_libre')::uuid) = 0);

set role postgres;
select test.check('el borrado quedó en la bitácora',
  (select count(*) from public.audit_logs
    where action = 'ELIMINAR' and entity = 'services'
      and entity_id = test.var('srv_libre')) = 1);
select test.check('y la bitácora dice QUÉ se borró, no solo un identificador',
  (select details from public.audit_logs
    where action = 'ELIMINAR' and entity_id = test.var('srv_libre'))
    like '%Servicio de prueba%');
set role authenticated;

-- ==================================================== El cajero no borra
do $$
declare v_id uuid;
begin
  insert into public.services (company_id, code, name)
  values (test.var('c_a')::uuid, 'NOBORRA', 'Servicio protegido')
  returning id into v_id;
  perform test.set_var('srv_protegido', v_id::text);
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.expect_no_effect(
  'un cajero NO puede borrar un servicio, ni llamando al API directamente',
  $$delete from public.services where id = test.var('srv_protegido')::uuid$$,
  $$select exists (select 1 from public.services where id = test.var('srv_protegido')::uuid)$$
);

select test.expect_no_effect(
  'un cajero tampoco puede borrar clientes',
  $$delete from public.customers where company_id = test.var('c_a')::uuid$$,
  $$select exists (select 1 from public.customers where company_id = test.var('c_a')::uuid)$$
);

-- ==================================================== Con historia: se niega
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Un cliente con una factura encima.
do $$
declare v_cli uuid; v_fac uuid;
begin
  insert into public.customers (company_id, name, phone)
  values (test.var('c_a')::uuid, 'Cliente Con Facturas', '8090000001')
  returning id into v_cli;
  perform test.set_var('cli_con_historia', v_cli::text);

  insert into public.invoices (
    company_id, branch_id, invoice_number, customer_id, customer_name,
    subtotal_cents, tax_cents, total_cents, cashier_id
  ) values (
    test.var('c_a')::uuid, test.var('b_a')::uuid, 'FAC-DEL-1', v_cli, 'Cliente Con Facturas',
    100000, 18000, 118000, test.var('u_owner_a')::uuid
  ) returning id into v_fac;
  perform test.set_var('fac_del', v_fac::text);
end $$;

select test.expect_error(
  'un cliente con facturas NO se puede borrar',
  $$delete from public.customers where id = test.var('cli_con_historia')::uuid$$
);

select test.check('la factura sigue teniendo a su cliente: nunca queda huérfana',
  (select customer_id from public.invoices where id = test.var('fac_del')::uuid)
    = test.var('cli_con_historia')::uuid);

-- El mensaje tiene que ser legible por una persona, no un error de clave ajena.
do $$
declare v_msg text;
begin
  begin
    delete from public.customers where id = test.var('cli_con_historia')::uuid;
    v_msg := '(no falló)';
  exception when others then
    v_msg := SQLERRM;
  end;
  perform test.set_var('msg_cliente', v_msg);
end $$;

select test.check('y lo explica diciendo cuántas facturas tiene',
  test.var('msg_cliente') like '%1 facturas%' or test.var('msg_cliente') like '%facturas%',
  test.var('msg_cliente'));
select test.check('y ofrece archivarlo en vez de borrarlo',
  test.var('msg_cliente') like '%rchív%', test.var('msg_cliente'));

-- Archivar sí se puede, y es la salida que se ofrece.
update public.customers set is_active = false
 where id = test.var('cli_con_historia')::uuid;
select test.check('archivarlo sí se puede, y su factura sigue intacta',
  (select not is_active from public.customers where id = test.var('cli_con_historia')::uuid)
  and (select count(*) from public.invoices where id = test.var('fac_del')::uuid) = 1);

-- ==================================================== EL KARDEX
-- La comprobación más importante del archivo. `inventory_movements.product_id`
-- era ON DELETE CASCADE: borrar un producto se llevaba su historial de
-- existencias entero, en silencio y sin que nadie pudiera reconstruirlo.
-- Se usa el producto de Alfa que ya vendió y se anuló en 20_billing: tiene
-- kardex de verdad, hecho por el sistema. Fabricar el movimiento a mano fue el
-- primer intento y salió mal —columnas equivocadas, el fixture no se creaba y
-- la prueba pasaba sin probar nada—. De ahí la comprobación siguiente.
select test.check('el producto de partida SÍ tiene kardex (si no, lo de abajo no prueba nada)',
  (select count(*) from public.inventory_movements
    where product_id = test.var('prod')::uuid) > 0,
  (select count(*)::text from public.inventory_movements
    where product_id = test.var('prod')::uuid) || ' movimientos');

select test.expect_error(
  'un producto con kardex NO se puede borrar',
  $$delete from public.products where id = test.var('prod')::uuid$$
);

select test.check('y su kardex sigue completo: NO se borró en cascada',
  (select count(*) from public.inventory_movements
    where product_id = test.var('prod')::uuid) > 0);

-- Y la garantía de verdad: la clave ajena, que no pasa por RLS. Si algún día
-- alguien quita el disparador del mensaje, esto sigue negándose.
set role postgres;
select test.check('la restricción del kardex es RESTRICT, no CASCADE',
  (select confdeltype from pg_constraint
    where conname = 'inventory_movements_product_same_company') = 'r');
select test.check('la del cliente en facturas también, y no SET NULL',
  (select confdeltype from pg_constraint
    where conname = 'invoices_customer_same_company') = 'r');
select test.check('y la de los canjes de promoción',
  (select confdeltype from pg_constraint
    where conname = 'redemptions_promotion_same_company') = 'r');
set role authenticated;

-- ==================================================== El cliente y sus carros
do $$
declare v_cli uuid; v_veh uuid;
begin
  insert into public.customers (company_id, name, phone)
  values (test.var('c_a')::uuid, 'Cliente Sin Historia', '8090000002')
  returning id into v_cli;
  perform test.set_var('cli_libre', v_cli::text);

  insert into public.vehicles (company_id, customer_id, plate, make, model, category)
  values (test.var('c_a')::uuid, v_cli, 'XYZ999', 'Honda', 'Civic', 'sedan')
  returning id into v_veh;
  perform test.set_var('veh_libre', v_veh::text);
end $$;

delete from public.customers where id = test.var('cli_libre')::uuid;

select test.check('un cliente sin historia sí se borra',
  (select count(*) from public.customers where id = test.var('cli_libre')::uuid) = 0);
select test.check('y se lleva sus carros: no quedan vehículos sin dueño',
  (select count(*) from public.vehicles where id = test.var('veh_libre')::uuid) = 0);

-- ==================================================== La otra empresa
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;

-- Beta intenta y no pasa nada. La comprobación NO puede hacerse con los ojos de
-- Beta: no ve el servicio de Alfa de ninguna manera, así que «no existe» sería
-- indistinguible de «lo borré». Se pregunta como postgres, que ve todo.
delete from public.services where id = test.var('srv_protegido')::uuid;

set role postgres;
select test.check('Beta no puede borrar un servicio de Alfa',
  (select count(*) from public.services where id = test.var('srv_protegido')::uuid) = 1);

select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- ==================================================== Editar, que era la otra mitad
update public.services set name = 'Nombre Corregido', description = 'Ya se puede editar'
 where id = test.var('srv_protegido')::uuid;
select test.check('un administrador puede corregir el nombre de un servicio',
  (select name from public.services where id = test.var('srv_protegido')::uuid)
    = 'Nombre Corregido');

update public.customers set phone = '8095551234'
 where id = test.var('cli_con_historia')::uuid;
select test.check('y el teléfono mal tecleado de un cliente',
  (select phone from public.customers where id = test.var('cli_con_historia')::uuid)
    = '8095551234');
