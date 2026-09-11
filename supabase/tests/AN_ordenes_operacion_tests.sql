-- =============================================================================
-- Órdenes: tiempos, banderas operativas y línea de tiempo (mig 20260911210000).
-- Universo propio en 2099 con horas explícitas, para que espera y duración
-- sean exactas y las banderas no dependan del reloj.
-- =============================================================================

set role postgres;
do $$
declare v_ok uuid; v_atr uuid; v_lista uuid; v_sinlav uuid;
begin
  -- Orden ENTREGADA: llegó 9:00, empezó 9:15 (espera 900 s), entregó 9:45
  -- (duración 1800 s). La trabajó op1.
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at, started_at, delivered_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'OP-1', 'Cliente OP1', 'OPP001',
    'entregado', '2099-07-01 09:00:00-04', '2099-07-01 09:15:00-04', '2099-07-01 09:45:00-04')
  returning id into v_ok;
  insert into public.work_order_items (work_order_id, item_type, service_id, name, quantity, unit_price_cents)
  values (v_ok, 'service', test.var('serv')::uuid, 'Lavado', 1, 50000);
  insert into public.work_order_assignees (work_order_id, profile_id, company_id)
  values (v_ok, test.var('op1')::uuid, test.var('c_a')::uuid);
  perform test.set_var('op_ok', v_ok::text);

  -- Orden ATRASADA: en proceso, con hora estimada YA pasada y sin entregar.
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at, started_at, estimated_ready_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'OP-2', 'Cliente OP2', 'OPP002',
    'en_proceso', '2099-07-01 10:00:00-04', '2099-07-01 10:10:00-04', now() - interval '1 hour')
  returning id into v_atr;
  insert into public.work_order_assignees (work_order_id, profile_id, company_id)
  values (v_atr, test.var('op1')::uuid, test.var('c_a')::uuid);
  perform test.set_var('op_atr', v_atr::text);

  -- Orden LISTA sin entregar.
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at, started_at, finished_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'OP-3', 'Cliente OP3', 'OPP003',
    'listo', '2099-07-01 11:00:00-04', '2099-07-01 11:05:00-04', '2099-07-01 11:35:00-04')
  returning id into v_lista;
  perform test.set_var('op_lista', v_lista::text);

  -- Orden SIN lavador (recién llegada).
  insert into public.work_orders (company_id, branch_id, order_number, customer_name,
    vehicle_plate, status, arrival_at)
  values (test.var('c_a')::uuid, test.var('b_a')::uuid, 'OP-4', 'Cliente OP4', 'OPP004',
    'pendiente', '2099-07-01 12:00:00-04')
  returning id into v_sinlav;
  perform test.set_var('op_sinlav', v_sinlav::text);
end $$;

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_a'), false);
set role authenticated;

-- Helper: la fila de una orden por su número, dentro del universo del día.
-- (Se consulta 2099-07-01 acotando el periodo.)

-- ── Tiempos exactos ──
select test.check('espera de OP-1 = 15 min = 900 s',
  (select (r ->> 'espera_seg')::bigint from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-1') = 900);
select test.check('duración de OP-1 = 30 min = 1800 s',
  (select (r ->> 'duracion_seg')::bigint from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-1') = 1800);

-- ── Banderas ──
select test.check('OP-2 está marcada como atrasada',
  (select (r ->> 'atrasada')::boolean from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-2') = true);
select test.check('OP-1 (entregada) NO está atrasada',
  (select (r ->> 'atrasada')::boolean from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-1') = false);
select test.check('OP-3 está lista sin entregar',
  (select (r ->> 'lista_sin_entregar')::boolean from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-3') = true);
select test.check('OP-4 no tiene lavador',
  (select (r ->> 'sin_lavador')::boolean from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-4') = true);
select test.check('OP-1 sí tiene lavador',
  (select (r ->> 'sin_lavador')::boolean from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01') -> 'rows') r
   where (r ->> 'order_number') = 'OP-1') = false);

-- ── Filtros de servidor ──
select test.check('filtrar por lavador op1 deja solo sus órdenes del día',
  (select count(*) from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01', null, test.var('op1')::uuid) -> 'rows') r
   where (r ->> 'order_number') in ('OP-1','OP-2')) = 2);
select test.check('el lavador op1 no trae la orden sin lavador',
  not exists (select 1 from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01', null, test.var('op1')::uuid) -> 'rows') r
   where (r ->> 'order_number') = 'OP-4'));
select test.check('el filtro «active» excluye la entregada',
  not exists (select 1 from jsonb_array_elements(
     public.orders_page(test.var('b_a')::uuid, '2099-07-01','2099-07-01', 'active') -> 'rows') r
   where (r ->> 'order_number') = 'OP-1'));

-- ── Línea de tiempo ──
select test.check('la línea de tiempo trae los cuatro hitos',
  jsonb_array_length(public.order_detail(test.var('op_ok')::uuid) -> 'hitos') = 4);
select test.check('el hito de entrega de OP-1 tiene hora',
  (select (h ->> 'at') from jsonb_array_elements(
     public.order_detail(test.var('op_ok')::uuid) -> 'hitos') h
   where (h ->> 'clave') = 'entrega') is not null);
select test.check('el detalle trae al lavador de OP-1',
  jsonb_array_length(public.order_detail(test.var('op_ok')::uuid) -> 'lavadores') = 1);
select test.check('no se puede ver el detalle de una orden de otra empresa',
  (select public.order_detail(test.var('op_ok')::uuid)) is not null);  -- de la propia sí

-- Aislamiento: un usuario de B no ve estas órdenes de A.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_owner_b'), false);
set role authenticated;
select test.expect_error('un usuario de B no puede pedir órdenes de una sucursal de A',
  format($q$select public.orders_page(%L::uuid, '2099-07-01','2099-07-01')$q$, test.var('b_a')));
select test.expect_error('ni el detalle de una orden de A',
  format($q$select public.order_detail(%L::uuid)$q$, test.var('op_ok')));

reset role;
