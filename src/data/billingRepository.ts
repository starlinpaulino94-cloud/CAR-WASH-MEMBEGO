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

// -------------------------------------------------------- Beneficios Membego

export interface MembegoBenefitSummary {
  /**
   * La ficha, no solo su nombre. Sin el identificador el hallazgo se quedaba en
   * un cartel informativo: la factura salía con el nombre escrito y sin enlace,
   * así que ni contaba como visita suya ni se le podía fiar.
   */
  customerId: string;
  customerName: string;
  tier: string | null;
  activeMemberships: number;
  availablePromotions: number;
}

/**
 * Busca, por teléfono, un cliente de Membego de ESTA empresa y resume sus
 * beneficios (membresías activas y promociones disponibles). Sirve para avisar
 * al cajero en el mostrador. RLS acota todo a la empresa.
 */
export async function lookupMembegoByPhone(phone: string): Promise<MembegoBenefitSummary | null> {
  const supabase = requireSupabase();
  const { data: cust, error } = await supabase
    .from('customers')
    .select('id, name, membego_tier')
    .eq('phone', phone.trim())
    .not('membego_customer_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!cust) return null;

  const [m, p] = await Promise.all([
    supabase.from('memberships').select('id', { count: 'exact', head: true })
      .eq('customer_id', cust.id).eq('status', 'active'),
    supabase.from('customer_promotions').select('id', { count: 'exact', head: true })
      .eq('customer_id', cust.id).eq('status', 'available')
  ]);
  if (m.error) throw m.error;
  if (p.error) throw p.error;

  return {
    customerId: cust.id,
    customerName: cust.name,
    tier: cust.membego_tier,
    activeMemberships: m.count ?? 0,
    availablePromotions: p.count ?? 0
  };
}

// -------------------------------------------------------- Estado fiscal

export interface FiscalStatus {
  ready: boolean;       // ¿hay al menos una secuencia NCF utilizable?
  types: NcfType[];     // tipos NCF disponibles ahora mismo (B01, B02, ...)
}

/**
 * ¿Puede la empresa emitir comprobantes fiscales?
 *
 * Se resuelve con la función `fiscal_status`, que es SECURITY DEFINER: un cajero
 * no puede leer `ncf_sequences` (RLS), pero sí necesita saber si el cobro está
 * habilitado. La función devuelve solo un booleano y los tipos disponibles,
 * nada sensible. Fallo cerrado: sin empresa o sin rangos, `ready` es false.
 */
export async function fetchFiscalStatus(): Promise<FiscalStatus> {
  // Resiliente a propósito: si la comprobación fiscal falla (por ejemplo, la
  // función aún no está en la base, o un fallo transitorio), NO debe tumbar la
  // vista entera. Degradamos a "sin facturación" —el catálogo y el historial se
  // cargan igual, con el aviso de configuración pendiente— en vez de mostrar
  // "No se pudo cargar". El cobro se reactiva solo cuando la función responde.
  try {
    const { data, error } = await requireSupabase().rpc('fiscal_status');
    if (error) throw error;
    const parsed = (data ?? {}) as { ready?: boolean; types?: NcfType[] };
    return { ready: parsed.ready === true, types: parsed.types ?? [] };
  } catch (err) {
    console.warn('fiscal_status no disponible; se asume facturación no configurada.', err);
    return { ready: false, types: [] };
  }
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
  /** Código promocional. El descuento lo recalcula el servidor al emitir. */
  promotionCode?: string | null;
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
    p_cash_session_id: params.cashSessionId ?? null,
    p_promotion_code: params.promotionCode ?? null
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

export type InvoiceItem = Tables<'invoice_items'>;

export async function fetchInvoiceItems(invoiceId: string): Promise<InvoiceItem[]> {
  const { data, error } = await requireSupabase()
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at');

  if (error) throw error;
  return data ?? [];
}

export type InvoiceKindFilter = 'all' | 'invoices' | 'credit_notes' | 'annulled';

export interface InvoicePageParams {
  branchId: string;
  page: number;
  pageSize: number;
  search?: string;
  kind?: InvoiceKindFilter;
  fromDate?: string;   // ISO, inclusive
  toDate?: string;     // ISO, inclusive
}

export interface InvoicePage {
  rows: Invoice[];
  total: number;
}

/**
 * Página de facturas.
 *
 * Paginado en el servidor a propósito: la vista auditada renderizaba TODAS las
 * filas sin paginar ni virtualizar (§3.3), lo que a unos miles de comprobantes
 * significa decenas de miles de nodos en una sola tabla. Aquí el navegador
 * nunca recibe más de una página.
 */
export async function fetchInvoicePage(params: InvoicePageParams): Promise<InvoicePage> {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;

  let query = requireSupabase()
    .from('invoices')
    .select('*', { count: 'exact' })
    .eq('branch_id', params.branchId);

  const term = params.search?.trim();
  if (term) {
    // Filtrado en el servidor. Buscar en cliente obligaría a traerse el
    // histórico completo, que es justo lo que se quiere evitar.
    const escaped = term.replace(/[%,()]/g, '');
    query = query.or(
      `invoice_number.ilike.%${escaped}%,` +
      `ncf.ilike.%${escaped}%,` +
      `customer_name.ilike.%${escaped}%,` +
      `vehicle_plate.ilike.%${escaped}%`
    );
  }

  switch (params.kind) {
    case 'invoices':     query = query.is('credits_invoice_id', null); break;
    case 'credit_notes': query = query.not('credits_invoice_id', 'is', null); break;
    case 'annulled':     query = query.eq('is_annulled', true); break;
    default: break;
  }

  if (params.fromDate) query = query.gte('created_at', params.fromDate);
  if (params.toDate)   query = query.lte('created_at', params.toDate);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Totales del periodo consultado, calculados por el servidor. */
export async function fetchInvoiceTotals(
  branchId: string,
  fromDate?: string,
  toDate?: string
): Promise<{ issuedCents: number; annulledCents: number; count: number }> {
  let query = requireSupabase()
    .from('invoices')
    .select('total_cents, is_annulled, credits_invoice_id')
    .eq('branch_id', branchId)
    .is('credits_invoice_id', null);

  if (fromDate) query = query.gte('created_at', fromDate);
  if (toDate)   query = query.lte('created_at', toDate);

  const { data, error } = await query;
  if (error) throw error;

  let issued = 0, annulled = 0;
  for (const row of data ?? []) {
    if (row.is_annulled) annulled += row.total_cents;
    else issued += row.total_cents;
  }
  return { issuedCents: issued, annulledCents: annulled, count: (data ?? []).length };
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

// ==========================================================================
// Cobrar una orden de trabajo
// ==========================================================================
/**
 * El vehículo se recibe en Operaciones y se cobra en Ventas, y hasta aquí esas
 * dos pantallas no se hablaban: el cajero tecleaba la venta otra vez. Eso tiene
 * tres consecuencias que se pagan juntas —puede cobrarse un importe distinto al
 * de la orden, la orden se queda «pendiente» para siempre, y nada ata el lavado
 * con su comprobante—.
 *
 * `create_invoice` acepta `p_work_order_id` desde la 0008 y desde la 0028 lo usa
 * para decidir si la orden queda pagada, pendiente o parcial. Lo único que
 * faltaba era que alguien se lo pasara.
 */

export interface ChargeableOrderLine {
  item_type: 'service' | 'product';
  service_id: string | null;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  is_membego_covered: boolean;
}

export interface ChargeableOrder {
  id: string;
  order_number: string;
  vehicle_plate: string | null;
  vehicle_category: VehicleCategory;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  total_cents: number;
  created_at: string;
  work_order_items: ChargeableOrderLine[];
}

/**
 * Órdenes de esta sucursal que ya se pueden cobrar y todavía no se han cobrado.
 *
 * Se excluyen las canceladas y las que ya tienen pago: cobrar dos veces el mismo
 * lavado es justo el error que esta pantalla existe para evitar. El filtro va al
 * servidor —RLS decide qué sucursales ve quien pregunta—.
 */
export async function fetchChargeableOrders(
  branchId: string, search = ''
): Promise<ChargeableOrder[]> {
  let q = requireSupabase()
    .from('work_orders')
    .select('id,order_number,vehicle_plate,vehicle_category,customer_id,customer_name,' +
            'customer_phone,status,total_cents,created_at,' +
            'work_order_items(item_type,service_id,product_id,name,quantity,' +
            'unit_price_cents,discount_cents,is_membego_covered)')
    .eq('branch_id', branchId)
    .eq('payment_status', 'pendiente')
    .not('status', 'in', '(cancelado)')
    .order('created_at', { ascending: false })
    .limit(40);

  if (search.trim()) {
    const t = search.trim().replace(/[%,()]/g, '');
    q = q.or(`vehicle_plate.ilike.%${t}%,order_number.ilike.%${t}%,customer_name.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ChargeableOrder[];
}

// ───────────────────────────────────────────── El canje de Membego

/**
 * Consumir el beneficio en Membego y dejarlo escrito en la factura.
 *
 * PRIMERO SE FACTURA, DESPUÉS SE CANJEA, y el orden no es casual. Son dos
 * sistemas sin transacción común: uno de los pasos queda primero y el otro
 * puede fallar, así que la pregunta real es quién paga ese error.
 *
 *   · Canjear primero — si falla la factura, el cliente perdió un lavado y no
 *     tiene comprobante. Perdió él, y no tiene cómo enterarse.
 *   · Facturar primero — si falla el canje, el cliente tiene su factura con el
 *     lavado descontado y su lavado sigue en el saldo. Perdió el negocio, sabe
 *     cuánto, y se puede reintentar.
 *
 * Un fallo NO se traga: se anota en la factura como `fallido` con su motivo.
 * Una factura cubierta cuyo canje nadie confirmó es un hecho que hay que poder
 * ver y reintentar.
 */

export interface ResultadoCanje {
  ok: boolean;
  visitId: string | null;
  /** Lavados que le quedan al cliente. `null` en planes ilimitados. */
  usesLeft: number | null;
  /** Por qué falló, cuando falló. */
  motivo: string | null;
}

export async function canjearEnMembego(params: {
  invoiceId: string;
  membershipId: string;
  servicio: string;
  coveredCents: number;
  sucursalId?: string | null;
}): Promise<ResultadoCanje> {
  let visitId: string | null = null;
  let usesLeft: number | null = null;
  let motivo: string | null = null;

  try {
    const res = await fetch('/api/membego/canjear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId: params.invoiceId,
        membershipId: params.membershipId,
        servicio: params.servicio,
        sucursalId: params.sucursalId ?? null
      })
    });
    const body = (await res.json().catch(() => ({}))) as {
      visitId?: string; usesLeft?: number | null; message?: string; error?: string;
    };
    if (res.ok && body.visitId) {
      visitId = body.visitId;
      usesLeft = body.usesLeft ?? null;
    } else {
      motivo = body.message ?? body.error ?? `Membego respondió ${res.status}`;
    }
  } catch {
    motivo = 'No se pudo contactar con Membego.';
  }

  // Se anota SIEMPRE, haya salido bien o mal. Un canje fallido sin rastro es
  // una factura que dice «cubierto» y una membresía que nunca se enteró.
  try {
    await requireSupabase().rpc('record_membego_redemption', {
      p_invoice_id: params.invoiceId,
      p_visit_id: visitId,
      p_membership_id: params.membershipId,
      p_covered_cents: params.coveredCents,
      p_error: motivo
    });
  } catch {
    // Anotar es lo último y lo menos grave: el canje ya ocurrió (o no) en
    // Membego, y eso es lo que decide el saldo del cliente.
  }

  return { ok: visitId !== null, visitId, usesLeft, motivo };
}

/**
 * Devolverle el lavado al cliente al anular la factura.
 *
 * Revertir dos veces devuelve un lavado, no dos: Membego responde 200 con
 * `applied: false` si ya estaba revertida, y eso es lo correcto ante un
 * reintento tras un timeout.
 */
export async function revertirEnMembego(
  invoiceId: string, visitId: string, motivo: string
): Promise<{ ok: boolean; mensaje: string | null }> {
  try {
    const res = await fetch('/api/membego/revertir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitId, reason: motivo })
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) return { ok: false, mensaje: body.message ?? body.error ?? 'Membego rechazó la reversa.' };

    await requireSupabase().rpc('record_membego_reversal', { p_invoice_id: invoiceId });
    return { ok: true, mensaje: null };
  } catch {
    return { ok: false, mensaje: 'No se pudo contactar con Membego.' };
  }
}
