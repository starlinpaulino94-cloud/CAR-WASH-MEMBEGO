import { CsvColumn } from './csv';
import { fetchAllRows } from '../data/importExportRepository';

/**
 * Qué se exporta de cada módulo, y cómo se escribe.
 *
 * Un CSV que saca las columnas crudas de la base no le sirve a nadie: trae
 * identificadores de treinta y seis caracteres, importes en centavos y estados
 * en inglés. Aquí cada exportación declara sus encabezados en español, sus
 * importes en pesos y sus fechas legibles, porque el archivo se abre en Excel
 * y se le enseña al contador, no se vuelve a cargar en un programa.
 *
 * Excepción deliberada: los códigos que SÍ sirven para volver a importar
 * —código de servicio, placa, teléfono— se exportan tal cual. Exportar,
 * corregir en Excel y reimportar es un flujo legítimo, y solo funciona si la
 * llave natural sobrevive al viaje de ida y vuelta.
 */

/** Importe en centavos a texto con dos decimales, sin símbolo ni miles: así
 *  Excel lo reconoce como número y la reimportación lo vuelve a leer. */
const money = (cents: number | null | undefined): string =>
  cents == null ? '' : (cents / 100).toFixed(2);

const date = (iso: string | null | undefined): string =>
  !iso ? '' : new Date(iso).toLocaleDateString('es-DO');

const dateTime = (iso: string | null | undefined): string =>
  !iso ? '' : new Date(iso).toLocaleString('es-DO');

const yesNo = (v: boolean | null | undefined): string => (v ? 'Sí' : 'No');

const text = (v: unknown): string => (v == null ? '' : String(v));

export interface ExportSpec<T> {
  columns: CsvColumn<T>[];
  fetchRows: () => Promise<{ rows: T[]; truncated: boolean }>;
  filename: string;
}

// --------------------------------------------------------------- Clientes

interface CustomerExport {
  origin: 'carwash' | 'membego';
  name: string; phone: string | null; email: string | null; tax_id: string | null;
  address: string | null; notes: string | null; total_visits: number;
  total_spent_cents: number; last_visit_at: string | null; created_at: string;
  credit_enabled: boolean | null; credit_limit_cents: number | null;
  credit_terms_days: number | null;
}

export const customersExport = (): ExportSpec<CustomerExport> => ({
  filename: 'clientes',
  columns: [
    { header: 'nombre',        value: r => text(r.name) },
    // Procedencia, no vínculo: un cliente propio que se hizo de Membego sigue
    // saliendo aquí como «Car wash». Ver la migración 0037.
    { header: 'procedencia',   value: r => r.origin === 'membego' ? 'Membego' : 'Car wash' },
    { header: 'telefono',      value: r => text(r.phone) },
    { header: 'correo',        value: r => text(r.email) },
    { header: 'rnc',           value: r => text(r.tax_id) },
    { header: 'direccion',     value: r => text(r.address) },
    { header: 'notas',         value: r => text(r.notes) },
    { header: 'visitas',       value: r => String(r.total_visits) },
    { header: 'consumo',       value: r => money(r.total_spent_cents) },
    { header: 'ultima_visita', value: r => date(r.last_visit_at) },
    { header: 'credito',       value: r => yesNo(r.credit_enabled) },
    { header: 'limite_credito', value: r => money(r.credit_limit_cents) },
    { header: 'dias_credito',  value: r => text(r.credit_terms_days) },
    { header: 'registrado',    value: r => date(r.created_at) }
  ],
  fetchRows: () => fetchAllRows<CustomerExport>(
    'customers',
    'origin,name,phone,email,tax_id,address,notes,total_visits,total_spent_cents,' +
    'last_visit_at,created_at,credit_enabled,credit_limit_cents,credit_terms_days',
    { column: 'name', ascending: true })
});

// -------------------------------------------------------------- Vehículos

interface VehicleExport {
  plate: string; make: string; model: string; year: number | null; color: string;
  category: string; notes: string | null; last_visit_at: string | null;
  customers: { name: string; phone: string | null } | null;
}

export const vehiclesExport = (): ExportSpec<VehicleExport> => ({
  filename: 'vehiculos',
  columns: [
    { header: 'placa',            value: r => text(r.plate) },
    { header: 'marca',            value: r => text(r.make) },
    { header: 'modelo',           value: r => text(r.model) },
    { header: 'ano',              value: r => text(r.year) },
    { header: 'color',            value: r => text(r.color) },
    { header: 'categoria',        value: r => text(r.category) },
    { header: 'cliente',          value: r => text(r.customers?.name) },
    { header: 'telefono_cliente', value: r => text(r.customers?.phone) },
    { header: 'notas',            value: r => text(r.notes) },
    { header: 'ultima_visita',    value: r => date(r.last_visit_at) }
  ],
  fetchRows: () => fetchAllRows<VehicleExport>(
    'vehicles',
    'plate,make,model,year,color,category,notes,last_visit_at,customers(name,phone)',
    { column: 'plate', ascending: true })
});

// -------------------------------------------------------------- Servicios

interface ServiceExport {
  code: string; name: string; description: string; category: string;
  estimated_minutes: number; commission_bps: number; is_active: boolean;
  service_prices: { vehicle_category: string; price_cents: number }[] | null;
}

const CATEGORIAS = ['sedan', 'suv', 'jeep', 'pickup', 'van', 'truck', 'motorcycle', 'special'];

export const servicesExport = (): ExportSpec<ServiceExport> => ({
  filename: 'servicios',
  columns: [
    { header: 'codigo',      value: r => text(r.code) },
    { header: 'nombre',      value: r => text(r.name) },
    { header: 'categoria',   value: r => text(r.category) },
    { header: 'descripcion', value: r => text(r.description) },
    { header: 'minutos',     value: r => String(r.estimated_minutes) },
    { header: 'comision',    value: r => (r.commission_bps / 100).toFixed(2) },
    { header: 'activo',      value: r => yesNo(r.is_active) },
    // Una columna por categoría: así el archivo se corrige en Excel y se
    // reimporta sin perder que un SUV cuesta más que un sedán.
    ...CATEGORIAS.map(c => ({
      header: `precio_${c}`,
      value: (r: ServiceExport) =>
        money(r.service_prices?.find(p => p.vehicle_category === c)?.price_cents)
    }))
  ],
  fetchRows: () => fetchAllRows<ServiceExport>(
    'services',
    'code,name,description,category,estimated_minutes,commission_bps,is_active,' +
    'service_prices(vehicle_category,price_cents)',
    { column: 'name', ascending: true })
});

// -------------------------------------------------------------- Productos

interface ProductExport {
  code: string; barcode: string | null; name: string; category: string;
  cost_cents: number; price_cents: number; stock: number; min_stock: number;
  unit: string; is_for_sale: boolean; is_active: boolean;
}

export const productsExport = (): ExportSpec<ProductExport> => ({
  filename: 'productos',
  columns: [
    { header: 'codigo',        value: r => text(r.code) },
    { header: 'codigo_barras', value: r => text(r.barcode) },
    { header: 'nombre',        value: r => text(r.name) },
    { header: 'categoria',     value: r => text(r.category) },
    { header: 'precio',        value: r => money(r.price_cents) },
    { header: 'costo',         value: r => money(r.cost_cents) },
    { header: 'existencia',    value: r => String(r.stock) },
    { header: 'minimo',        value: r => String(r.min_stock) },
    { header: 'unidad',        value: r => text(r.unit) },
    { header: 'para_venta',    value: r => yesNo(r.is_for_sale) },
    { header: 'activo',        value: r => yesNo(r.is_active) }
  ],
  fetchRows: () => fetchAllRows<ProductExport>(
    'products',
    'code,barcode,name,category,cost_cents,price_cents,stock,min_stock,unit,is_for_sale,is_active',
    { column: 'name', ascending: true })
});

// ------------------------------------------------------------ Proveedores

interface SupplierExport {
  name: string; tax_id: string | null; phone: string | null; email: string | null;
  address: string | null; notes: string | null; is_active: boolean;
}

export const suppliersExport = (): ExportSpec<SupplierExport> => ({
  filename: 'proveedores',
  columns: [
    { header: 'nombre',    value: r => text(r.name) },
    { header: 'rnc',       value: r => text(r.tax_id) },
    { header: 'telefono',  value: r => text(r.phone) },
    { header: 'correo',    value: r => text(r.email) },
    { header: 'direccion', value: r => text(r.address) },
    { header: 'notas',     value: r => text(r.notes) },
    { header: 'activo',    value: r => yesNo(r.is_active) }
  ],
  fetchRows: () => fetchAllRows<SupplierExport>(
    'suppliers', 'name,tax_id,phone,email,address,notes,is_active',
    { column: 'name', ascending: true })
});

// ------------------------------------------------------------ Promociones

interface PromotionExport {
  code: string; name: string; kind: string; scope: string;
  value_bps: number | null; value_cents: number | null;
  starts_on: string; ends_on: string | null; min_purchase_cents: number;
  max_uses: number | null; uses_count: number; is_active: boolean;
}

export const promotionsExport = (): ExportSpec<PromotionExport> => ({
  filename: 'descuentos',
  columns: [
    { header: 'codigo',  value: r => text(r.code) },
    { header: 'nombre',  value: r => text(r.name) },
    { header: 'tipo',    value: r => text(r.kind) },
    { header: 'valor',   value: r => r.kind === 'porcentaje'
        ? ((r.value_bps ?? 0) / 100).toFixed(2) : money(r.value_cents) },
    { header: 'alcance', value: r => text(r.scope) },
    { header: 'desde',   value: r => date(r.starts_on) },
    { header: 'hasta',   value: r => date(r.ends_on) },
    { header: 'minimo',  value: r => money(r.min_purchase_cents) },
    { header: 'usos',    value: r => String(r.uses_count) },
    { header: 'maximo_usos', value: r => text(r.max_uses) },
    { header: 'activo',  value: r => yesNo(r.is_active) }
  ],
  fetchRows: () => fetchAllRows<PromotionExport>(
    'promotions',
    'code,name,kind,scope,value_bps,value_cents,starts_on,ends_on,' +
    'min_purchase_cents,max_uses,uses_count,is_active',
    { column: 'created_at', ascending: false })
});

// -------------------------------------------------------------- Facturas

interface InvoiceExport {
  invoice_number: string; ncf: string | null; ncf_type: string | null;
  created_at: string; customer_name: string | null; customer_tax_id: string | null;
  vehicle_plate: string | null; subtotal_cents: number; discount_cents: number;
  tax_cents: number; total_cents: number; is_annulled: boolean;
  annulled_reason: string | null;
}

export const invoicesExport = (): ExportSpec<InvoiceExport> => ({
  filename: 'facturas',
  columns: [
    { header: 'numero',    value: r => text(r.invoice_number) },
    { header: 'ncf',       value: r => text(r.ncf) },
    { header: 'tipo_ncf',  value: r => text(r.ncf_type) },
    { header: 'fecha',     value: r => dateTime(r.created_at) },
    { header: 'cliente',   value: r => text(r.customer_name) },
    { header: 'rnc',       value: r => text(r.customer_tax_id) },
    { header: 'placa',     value: r => text(r.vehicle_plate) },
    { header: 'subtotal',  value: r => money(r.subtotal_cents) },
    { header: 'descuento', value: r => money(r.discount_cents) },
    { header: 'itbis',     value: r => money(r.tax_cents) },
    { header: 'total',     value: r => money(r.total_cents) },
    { header: 'anulada',   value: r => yesNo(r.is_annulled) },
    { header: 'motivo_anulacion', value: r => text(r.annulled_reason) }
  ],
  fetchRows: () => fetchAllRows<InvoiceExport>(
    'invoices',
    'invoice_number,ncf,ncf_type,created_at,customer_name,customer_tax_id,' +
    'vehicle_plate,subtotal_cents,discount_cents,tax_cents,total_cents,' +
    'is_annulled,annulled_reason',
    { column: 'created_at', ascending: false })
});

// --------------------------------------------------------------- Órdenes

interface OrderExport {
  order_number: string; created_at: string; delivered_at: string | null;
  customer_name: string | null; customer_phone: string | null;
  vehicle_plate: string | null; vehicle_make_model: string | null;
  vehicle_category: string; status: string; payment_status: string;
  subtotal_cents: number; discount_cents: number; total_cents: number;
}

export const ordersExport = (): ExportSpec<OrderExport> => ({
  filename: 'ordenes',
  columns: [
    { header: 'numero',    value: r => text(r.order_number) },
    { header: 'fecha',     value: r => dateTime(r.created_at) },
    { header: 'entregada', value: r => dateTime(r.delivered_at) },
    { header: 'cliente',   value: r => text(r.customer_name) },
    { header: 'telefono',  value: r => text(r.customer_phone) },
    { header: 'placa',     value: r => text(r.vehicle_plate) },
    { header: 'vehiculo',  value: r => text(r.vehicle_make_model) },
    { header: 'categoria', value: r => text(r.vehicle_category) },
    { header: 'estado',    value: r => text(r.status) },
    { header: 'pago',      value: r => text(r.payment_status) },
    { header: 'subtotal',  value: r => money(r.subtotal_cents) },
    { header: 'descuento', value: r => money(r.discount_cents) },
    { header: 'total',     value: r => money(r.total_cents) }
  ],
  fetchRows: () => fetchAllRows<OrderExport>(
    'work_orders',
    'order_number,created_at,delivered_at,customer_name,customer_phone,' +
    'vehicle_plate,vehicle_make_model,vehicle_category,status,payment_status,' +
    'subtotal_cents,discount_cents,total_cents',
    { column: 'created_at', ascending: false })
});

// ----------------------------------------------------------------- Gastos

interface ExpenseExport {
  expense_date: string; category: string; description: string;
  amount_cents: number; payment_method: string; supplier_name: string | null;
  invoice_ref: string | null;
}

export const expensesExport = (): ExportSpec<ExpenseExport> => ({
  filename: 'gastos',
  columns: [
    { header: 'fecha',       value: r => date(r.expense_date) },
    { header: 'categoria',   value: r => text(r.category) },
    { header: 'descripcion', value: r => text(r.description) },
    { header: 'importe',     value: r => money(r.amount_cents) },
    { header: 'forma_pago',  value: r => text(r.payment_method) },
    { header: 'proveedor',   value: r => text(r.supplier_name) },
    { header: 'comprobante', value: r => text(r.invoice_ref) }
  ],
  fetchRows: () => fetchAllRows<ExpenseExport>(
    'expenses',
    'expense_date,category,description,amount_cents,payment_method,supplier_name,invoice_ref',
    { column: 'expense_date', ascending: false })
});

// ---------------------------------------------------------- Cuentas por cobrar

interface ReceivableExport {
  issued_on: string; due_on: string; total_cents: number; paid_cents: number;
  status: string; customers: { name: string; phone: string | null } | null;
  invoices: { ncf: string | null; invoice_number: string } | null;
}

export const receivablesExport = (): ExportSpec<ReceivableExport> => ({
  filename: 'cuentas-por-cobrar',
  columns: [
    { header: 'cliente',   value: r => text(r.customers?.name) },
    { header: 'telefono',  value: r => text(r.customers?.phone) },
    { header: 'factura',   value: r => text(r.invoices?.ncf ?? r.invoices?.invoice_number) },
    { header: 'emitida',   value: r => date(r.issued_on) },
    { header: 'vence',     value: r => date(r.due_on) },
    { header: 'total',     value: r => money(r.total_cents) },
    { header: 'abonado',   value: r => money(r.paid_cents) },
    { header: 'pendiente', value: r => money(r.total_cents - r.paid_cents) },
    { header: 'estado',    value: r => text(r.status) }
  ],
  fetchRows: () => fetchAllRows<ReceivableExport>(
    'receivables',
    'issued_on,due_on,total_cents,paid_cents,status,' +
    'customers(name,phone),invoices(ncf,invoice_number)',
    { column: 'due_on', ascending: true })
});

// ------------------------------------------------------ Movimientos de inventario

interface MovementExport {
  created_at: string; kind: string; qty_change: number; qty_before: number;
  qty_after: number; reason: string | null;
  products: { code: string; name: string } | null;
}

export const movementsExport = (): ExportSpec<MovementExport> => ({
  filename: 'movimientos-inventario',
  columns: [
    { header: 'fecha',     value: r => dateTime(r.created_at) },
    { header: 'codigo',    value: r => text(r.products?.code) },
    { header: 'producto',  value: r => text(r.products?.name) },
    { header: 'tipo',      value: r => text(r.kind) },
    { header: 'cantidad',  value: r => String(r.qty_change) },
    { header: 'antes',     value: r => String(r.qty_before) },
    { header: 'despues',   value: r => String(r.qty_after) },
    { header: 'motivo',    value: r => text(r.reason) }
  ],
  fetchRows: () => fetchAllRows<MovementExport>(
    'inventory_movements',
    'created_at,kind,qty_change,qty_before,qty_after,reason,products(code,name)',
    { column: 'created_at', ascending: false })
});
