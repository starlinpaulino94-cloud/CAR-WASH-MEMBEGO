import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Acceso a datos de POS y Caja.
 *
 * Todo lo que toca dinero pasa por las funciones RPC del servidor
 * (`create_invoice`, `annul_invoice`), nunca por escrituras sueltas desde el
 * navegador: son las que garantizan atomicidad, idempotencia y numeración
 * fiscal. Este módulo no calcula importes; solo transporta.
 */

export type Service = Tables<'services'>;
export type Product = Tables<'products'>;
export type Invoice = Tables<'invoices'>;
export type CashSession = Tables<'cash_sessions'>;
export type CashMovement = Tables<'cash_movements'>;
export type VehicleCategory = Enums['vehicle_category'];
export type PaymentMethod = Enums['payment_method'];
export type NcfType = Enums['ncf_type'];

export interface ServiceWithPrice extends Service {
  price_cents: number;
}

export interface CartLine {
  key: string;
  itemType: 'service' | 'product';
  serviceId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;   // solo para previsualizar: el importe real lo fija el servidor
  discountCents: number;
  isMembegoCovered: boolean;
}

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  reference?: string;
}

// --------------------------------------------------------------- Catálogo

/**
 * Servicios activos con el precio de la categoría de vehículo indicada.
 *
 * Los servicios sin precio para esa categoría se excluyen: intentar
 * facturarlos haría fallar `create_invoice`, y es mejor no ofrecerlos que
 * mostrar un error al cobrar.
 */
export async function fetchServices(category: VehicleCategory): Promise<ServiceWithPrice[]> {
  const { data, error } = await requireSupabase()
    .from('services')
    .select('*, service_prices!inner(price_cents, vehicle_category)')
    .eq('is_active', true)
    .eq('service_prices.vehicle_category', category)
    .order('name');

  if (error) throw error;

  return (data ?? []).map(row => {
    const { service_prices, ...service } = row as Service & {
      service_prices: { price_cents: number }[];
    };
    return { ...service, price_cents: service_prices[0]?.price_cents ?? 0 };
  });
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await requireSupabase()
    .from('products')
    .select('*')
    .eq('is_active', true)
    .eq('is_for_sale', true)
    .order('name');

  if (error) throw error;
  return data ?? [];
}

// ------------------------------------------------------------------- Caja

export async function fetchOpenCashSession(branchId: string): Promise<CashSession | null> {
  const { data, error } = await requireSupabase()
    .from('cash_sessions')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchCashSessionHistory(branchId: string, limit = 20): Promise<CashSession[]> {
  const { data, error } = await requireSupabase()
    .from('cash_sessions')
    .select('*')
    .eq('branch_id', branchId)
    .order('opened_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchCashMovements(sessionId: string): Promise<CashMovement[]> {
  const { data, error } = await requireSupabase()
    .from('cash_movements')
    .select('*')
    .eq('cash_session_id', sessionId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function openCashSession(params: {
  companyId: string;
  branchId: string;
  cashierId: string;
  initialAmountCents: number;
  notes?: string;
}): Promise<CashSession> {
  const { data, error } = await requireSupabase()
    .from('cash_sessions')
    .insert({
      company_id: params.companyId,
      branch_id: params.branchId,
      cashier_id: params.cashierId,
      initial_amount_cents: params.initialAmountCents,
      opening_notes: params.notes ?? null
    })
    .select()
    .single();

  if (error) {
    // El índice único que permite una sola caja abierta por sucursal.
    if (error.code === '23505') {
      throw new Error('Ya hay una caja abierta en esta sucursal.');
    }
    throw error;
  }
  return data;
}

export async function closeCashSession(params: {
  sessionId: string;
  countedCashCents: number;
  expectedCashCents: number;
  notes?: string;
}): Promise<CashSession> {
  const { data, error } = await requireSupabase()
    .from('cash_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      counted_cash_cents: params.countedCashCents,
      difference_cents: params.countedCashCents - params.expectedCashCents,
      closing_notes: params.notes ?? null
    })
    .eq('id', params.sessionId)
    .eq('status', 'open')      // no se cierra dos veces
    .select();

  if (error) throw error;

  // RLS filtra en silencio: un UPDATE denegado devuelve 0 filas SIN error.
  // Sin esta comprobación, al cajero se le mostraría un cierre que no ocurrió.
  if (!data || data.length === 0) {
    throw new Error(
      'No se pudo cerrar la caja: puede que ya estuviera cerrada o que no tenga permiso.'
    );
  }
  return data[0];
}

export async function registerCashMovement(params: {
  companyId: string;
  sessionId: string;
  type: 'inflow' | 'outflow';
  method: PaymentMethod;
  amountCents: number;
  reason: string;
}): Promise<void> {
  const { error } = await requireSupabase().from('cash_movements').insert({
    company_id: params.companyId,
    cash_session_id: params.sessionId,
    type: params.type,
    method: params.method,
    amount_cents: params.amountCents,
    reason: params.reason
  });
  if (error) throw error;
}

// ------------------------------------------------------------ Facturación

export interface CreateInvoiceParams {
  branchId: string;
  clientRequestId: string;      // idempotencia: UNA por operación, no por intento
  lines: CartLine[];
  payments: PaymentInput[];
  vehicleCategory: VehicleCategory;
  workOrderId?: string | null;
  customerId?: string | null;
  customerName: string;
  customerTaxId?: string | null;
  vehiclePlate?: string | null;
  ncfType?: NcfType | null;
  cashSessionId?: string | null;
}

/**
 * Emite una factura mediante el RPC transaccional.
 *
 * No se envían precios: el servidor los resuelve contra el catálogo. Tampoco
 * totales: los calcula él. Reintentar con el mismo `clientRequestId` devuelve
 * la factura ya emitida en lugar de duplicarla.
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  const { data, error } = await requireSupabase().rpc('create_invoice', {
    p_branch_id: params.branchId,
    p_client_request_id: params.clientRequestId,
    p_items: params.lines.map(line => ({
      item_type: line.itemType,
      service_id: line.serviceId,
      product_id: line.productId,
      name: line.name,
      quantity: line.quantity,
      discount_cents: line.discountCents,
      is_membego_covered: line.isMembegoCovered
    })),
    p_payments: params.payments.map(p => ({
      method: p.method,
      amount_cents: p.amountCents,
      reference: p.reference ?? null
    })),
    p_vehicle_category: params.vehicleCategory,
    p_work_order_id: params.workOrderId ?? null,
    p_customer_id: params.customerId ?? null,
    p_customer_name: params.customerName,
    p_customer_tax_id: params.customerTaxId ?? null,
    p_vehicle_plate: params.vehiclePlate ?? null,
    p_ncf_type: params.ncfType ?? null,
    p_cash_session_id: params.cashSessionId ?? null
  });

  if (error) throw new Error(translatePostgresError(error.message));
  return data as unknown as Invoice;
}

export async function annulInvoice(
  invoiceId: string,
  reason: string,
  clientRequestId: string
): Promise<Invoice> {
  const { data, error } = await requireSupabase().rpc('annul_invoice', {
    p_invoice_id: invoiceId,
    p_reason: reason,
    p_client_request_id: clientRequestId
  });

  if (error) throw new Error(translatePostgresError(error.message));
  return data as unknown as Invoice;
}

export async function fetchInvoiceItems(invoiceId: string) {
  const { data, error } = await requireSupabase()
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at');

  if (error) throw error;
  return data ?? [];
}

export async function fetchRecentInvoices(branchId: string, limit = 50): Promise<Invoice[]> {
  const { data, error } = await requireSupabase()
    .from('invoices')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Traduce los errores del servidor a algo accionable en un mostrador.
 *
 * Un cajero no puede hacer nada con "insufficient_resource" ni con el texto de
 * una restricción; sí puede hacer algo con "pida un nuevo rango a la DGII".
 */
function translatePostgresError(message: string): string {
  if (message.includes('No hay secuencia NCF')) {
    return 'No hay comprobantes fiscales disponibles. Solicite una nueva secuencia NCF a la DGII antes de continuar facturando.';
  }
  if (message.includes('Pago insuficiente')) {
    return 'El importe recibido no cubre el total de la venta.';
  }
  if (message.includes('No hay una sesión de caja abierta')) {
    return 'Debe abrir la caja antes de cobrar en efectivo.';
  }
  if (message.includes('no tiene precio definido')) {
    return 'Uno de los servicios no tiene precio para esta categoría de vehículo.';
  }
  if (message.includes('No tiene permiso para anular')) {
    return 'Su rol no permite anular facturas. Solicítelo a un supervisor.';
  }
  if (message.includes('ya está anulada')) {
    return 'Esta factura ya fue anulada.';
  }
  if (message.includes('No hay caja abierta en la sucursal')) {
    return 'Abra la caja antes de anular: la devolución debe quedar registrada en un arqueo.';
  }
  return message;
}
