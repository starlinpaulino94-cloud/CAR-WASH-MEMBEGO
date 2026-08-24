-- ============================================================================
-- DB-001 · Índices para las foreign keys de las tablas calientes
-- ============================================================================
-- La auditoría encontró 98 FKs sin índice en su columna líder. NO se indexan
-- las 98: la mayoría están en tablas de bajo volumen donde un índice cuesta más
-- (escritura, espacio) de lo que ahorra. Se indexan SOLO las de las tablas que
-- crecen sin techo y que se recorren de dos maneras costosas:
--
--   1. JOIN de vista: al abrir una factura, una orden o una nómina, la interfaz
--      trae sus líneas/movimientos/comisiones por esta FK. Sin índice, seq scan.
--   2. Borrado del padre: una FK con ON DELETE RESTRICT/CASCADE obliga a
--      PostgreSQL a escanear la tabla hija entera para validar cada borrado del
--      padre (un producto, una orden). Con volumen, ese borrado se degrada.
--
-- Sobre tablas vacías EXPLAIN no distingue (el planner elige seq scan por
-- tamaño, no por falta de índice), así que la justificación es estructural, no
-- por plan medido. Todos IF NOT EXISTS: la migración es reejecutable.
-- ============================================================================

-- Movimientos de inventario (kardex): la tabla que más crece. Se consulta por
-- la factura, la orden o la compra que originó el movimiento; y borrar una de
-- esas debe validar la FK aquí.
create index if not exists inventory_movements_invoice_idx
  on public.inventory_movements (invoice_id);
create index if not exists inventory_movements_work_order_idx
  on public.inventory_movements (work_order_id);
create index if not exists inventory_movements_purchase_idx
  on public.inventory_movements (purchase_id);

-- Líneas de factura: se traen al abrir cada factura, y unen a producto/servicio.
create index if not exists invoice_items_product_idx
  on public.invoice_items (product_id);
create index if not exists invoice_items_service_idx
  on public.invoice_items (service_id);

-- Comisiones: el corazón de la nómina. Se agrupan por orden, línea de orden y
-- partida de nómina al liquidar.
create index if not exists commissions_work_order_idx
  on public.commissions (work_order_id);
create index if not exists commissions_work_order_item_idx
  on public.commissions (work_order_item_id);
create index if not exists commissions_payroll_item_idx
  on public.commissions (payroll_item_id);

-- Líneas de orden de trabajo: se unen a producto/servicio y al operario asignado.
create index if not exists work_order_items_product_idx
  on public.work_order_items (product_id);
create index if not exists work_order_items_service_idx
  on public.work_order_items (service_id);
create index if not exists work_order_items_assignee_idx
  on public.work_order_items (assigned_profile_id);

-- Partidas de nómina por empleado.
create index if not exists payroll_items_profile_idx
  on public.payroll_items (profile_id);

-- Bitácora: se filtra por sucursal al auditar.
create index if not exists audit_logs_branch_idx
  on public.audit_logs (branch_id);

-- Citas: se unen a la orden generada y al servicio.
create index if not exists appointments_work_order_idx
  on public.appointments (work_order_id);
create index if not exists appointments_service_idx
  on public.appointments (service_id);
