import { requireSupabase } from '../lib/supabase';
import { Tables, Enums, Json, UpdateDto } from '../lib/database.types';
import { PagedResult } from '../hooks/usePagedQuery';

/**
 * Acceso a datos del resto de vistas: catálogo, clientes, vehículos, equipo,
 * gastos, bahías, reportes y ajustes.
 *
 * Todo listado se pagina y filtra en el servidor. Ninguna vista se trae el
 * histórico completo para contarlo o buscarlo en memoria.
 */

/**
 * `is_active` llegó a clientes y vehículos en la migración 0040 y los tipos se
 * generan contra la base (`npm run db:types`), así que se declara a mano hasta
 * la siguiente generación. Sin él no hay forma de archivar, que es lo que se
 * ofrece cuando el borrado se niega por tener historia.
 */
export type Customer = Tables<'customers'> & { is_active?: boolean };
export type Vehicle = Tables<'vehicles'> & { is_active?: boolean };
export type Service = Tables<'services'>;
export type ServicePrice = Tables<'service_prices'>;
export type Product = Tables<'products'>;
export type Profile = Tables<'profiles'>;
export type Expense = Tables<'expenses'>;
export type Bay = Tables<'bays'>;
export type Commission = Tables<'commissions'>;
export type AuditLog = Tables<'audit_logs'>;
export type Company = Tables<'companies'>;
export type MembegoSyncLog = Tables<'membego_sync_logs'>;
export type VehicleCategory = Enums['vehicle_category'];
export type ExpenseCategory = Enums['expense_category'];
export type PaymentMethod = Enums['payment_method'];
export type BayStatus = Enums['bay_status'];
export type BayType = Enums['bay_type'];

const escape = (term: string) => term.replace(/[%,()]/g, '');

// Traduce la violación de clave única (código '23505') a un mensaje accionable.
function friendlyDuplicate(error: unknown, kind: string, field: string): Error {
  if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') {
    return new Error(`Ya existe un ${kind} con ese ${field}.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

// --------------------------------------------------------------- Clientes

export type CustomerOrigin = Enums['customer_origin'];

/**
 * Página del directorio, con filtro opcional por procedencia.
 *
 * El filtro va al servidor, no a un `.filter()` sobre lo ya traído: filtrar en
 * memoria daría un contador y una paginación mentirosos —«3 de 25» sobre una
 * página que ya venía recortada—. Con RLS, además, el servidor es el único que
 * sabe cuántas filas hay de verdad.
 */
export async function fetchCustomerPage(
  page: number, pageSize: number, search: string, origin?: CustomerOrigin,
  incluirArchivados = false
): Promise<PagedResult<Customer>> {
  let query = requireSupabase().from('customers').select('*', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`name.ilike.%${t}%,phone.ilike.%${t}%,email.ilike.%${t}%,tax_id.ilike.%${t}%`);
  }
  if (origin) query = query.eq('origin', origin);
  // Archivar no sirve de nada si el archivado sigue apareciendo. El filtro va al
  // servidor para que el contador y la paginación digan la verdad.
  // El cast, otra vez, es por los tipos generados: `is_active` llegó en 0040.
  if (!incluirArchivados) query = query.eq('is_active' as never, true as never);
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Una entrada del resumen por procedencia. */
export interface OriginStats {
  clientes: number;
  nuevos: number;
  visitas: number;
  consumo_historico_cents: number;
  facturas: number;
  facturado_cents: number;
}

export interface CustomerOriginSummary {
  desde: string;
  hasta: string;
  por_origen: Record<CustomerOrigin, OriginStats>;
}

export async function fetchCustomerOriginSummary(
  from?: string, to?: string
): Promise<CustomerOriginSummary> {
  const { data, error } = await requireSupabase().rpc('customer_origin_summary', {
    p_from: from ?? null, p_to: to ?? null
  });
  if (error) throw error;
  return data as unknown as CustomerOriginSummary;
}

export type Membership = Tables<'memberships'>;
export type CustomerPromotion = Tables<'customer_promotions'>;

export interface CustomerMembego {
  memberships: Membership[];
  promotions: CustomerPromotion[];
}

/**
 * Beneficios de Membego de un cliente: membresías y promociones.
 *
 * Los alimenta el webhook de Membego (server-to-server). RLS acota todo a la
 * empresa, así que un car wash solo ve los beneficios de SUS clientes.
 */
export async function fetchCustomerMembego(customerId: string): Promise<CustomerMembego> {
  const supabase = requireSupabase();
  const [m, p] = await Promise.all([
    supabase.from('memberships').select('*').eq('customer_id', customerId)
      .order('created_at', { ascending: false }),
    supabase.from('customer_promotions').select('*').eq('customer_id', customerId)
      .order('acquired_at', { ascending: false })
  ]);
  if (m.error) throw m.error;
  if (p.error) throw p.error;
  return { memberships: m.data ?? [], promotions: p.data ?? [] };
}

export async function createCustomer(input: {
  companyId: string; branchId: string | null; name: string;
  phone?: string | null; email?: string | null; taxId?: string | null; notes?: string | null;
}): Promise<Customer> {
  const { data, error } = await requireSupabase().from('customers').insert({
    company_id: input.companyId, branch_id: input.branchId, name: input.name,
    phone: input.phone ?? null, email: input.email ?? null,
    tax_id: input.taxId ?? null, notes: input.notes ?? null
  }).select().single();
  if (error) throw error;
  return data;
}

/**
 * El parche es UpdateDto, no Partial<Customer>: desde 0028 el cupo de crédito
 * (credit_enabled, credit_limit_cents, credit_terms_days) queda fuera del tipo
 * de actualización porque un trigger rechaza tocarlo por esta vía. Se cambia
 * solo con set_customer_credit() — ver creditRepository.
 */
export async function updateCustomer(id: string, patch: UpdateDto<'customers'>): Promise<Customer> {
  const { data, error } = await requireSupabase()
    .from('customers').update(patch).eq('id', id).select();
  if (error) throw error;
  // RLS filtra en silencio: 0 filas significa denegado, no éxito.
  if (!data || data.length === 0) throw new Error('No se pudo actualizar: puede que no tenga permiso.');
  return data[0];
}

// --------------------------------------------------------------- Vehículos

export interface VehicleRow extends Vehicle {
  customer_name: string | null;
}

export async function fetchVehiclePage(
  page: number, pageSize: number, search: string
): Promise<PagedResult<VehicleRow>> {
  let query = requireSupabase()
    .from('vehicles')
    .select('*, customers(name)', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`plate.ilike.%${t}%,make.ilike.%${t}%,model.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;

  const rows = (data ?? []).map(row => {
    const { customers, ...vehicle } = row as Vehicle & { customers: { name: string } | null };
    return { ...vehicle, customer_name: customers?.name ?? null };
  });
  return { rows, total: count ?? 0 };
}

/**
 * Corregir la ficha de un vehículo.
 *
 * La placa se manda tal como se escribió: la normaliza un trigger del servidor
 * desde 0002. Normalizarla también aquí, con otras reglas, es exactamente cómo
 * se acaba teniendo dos formas de la misma matrícula y un carro duplicado.
 */
export async function updateVehicle(
  id: string, patch: UpdateDto<'vehicles'>
): Promise<Vehicle> {
  const { data, error } = await requireSupabase()
    .from('vehicles').update(patch).eq('id', id).select();
  if (error) throw friendlyDuplicate(error, 'vehículo', 'placa');
  // RLS filtra en silencio: 0 filas es denegado, no éxito.
  if (!data || data.length === 0) throw new Error('No se pudo actualizar: puede que no tenga permiso.');
  return data[0];
}

// --------------------------------------------------------------- Servicios

export interface ServiceWithPrices extends Service {
  prices: Record<string, number>;
}

export async function fetchServicesWithPrices(): Promise<ServiceWithPrices[]> {
  const { data, error } = await requireSupabase()
    .from('services')
    .select('*, service_prices(vehicle_category, price_cents)')
    .order('name');
  if (error) throw error;

  return (data ?? []).map(row => {
    const { service_prices, ...service } = row as Service & {
      service_prices: { vehicle_category: string; price_cents: number }[];
    };
    const prices: Record<string, number> = {};
    for (const p of service_prices ?? []) prices[p.vehicle_category] = p.price_cents;
    return { ...service, prices };
  });
}

export async function upsertServicePrice(
  serviceId: string, category: VehicleCategory, priceCents: number
): Promise<void> {
  const { error } = await requireSupabase()
    .from('service_prices')
    .upsert({ service_id: serviceId, vehicle_category: category, price_cents: priceCents },
            { onConflict: 'service_id,vehicle_category' });
  if (error) throw error;
}

export async function updateService(id: string, patch: Partial<Service>): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('services').update(patch).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Su rol no permite modificar el catálogo.');
}

export async function createService(input: {
  companyId: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  estimatedMinutes: number;
  commissionBps: number;
  includedInMembego?: boolean;
  // Precio por categoría de vehículo; solo se guardan los mayores que cero. Un
  // servicio sin precio para una categoría no se ofrece en esa categoría.
  prices: { category: VehicleCategory; priceCents: number }[];
}): Promise<Service> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('services').insert({
    company_id: input.companyId,
    code: input.code.trim(),
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    category: input.category?.trim() ?? '',
    estimated_minutes: input.estimatedMinutes,
    commission_bps: input.commissionBps,
    included_in_membego: input.includedInMembego ?? false
  }).select().single();
  if (error) throw friendlyDuplicate(error, 'servicio', 'código');

  const priceRows = input.prices
    .filter(p => p.priceCents > 0)
    .map(p => ({ service_id: data.id, vehicle_category: p.category, price_cents: p.priceCents }));
  if (priceRows.length > 0) {
    const { error: priceError } = await supabase.from('service_prices').insert(priceRows);
    if (priceError) throw priceError;
  }
  return data;
}

// --------------------------------------------------------------- Productos

export async function fetchProductPage(
  page: number, pageSize: number, search: string, onlyLowStock = false
): Promise<PagedResult<Product>> {
  let query = requireSupabase().from('products').select('*', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`name.ilike.%${t}%,code.ilike.%${t}%,category.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('name')
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;

  // El filtro de bajo stock compara dos columnas entre sí, algo que PostgREST
  // no expresa directamente; se aplica sobre la página ya traída y se avisa en
  // la interfaz de que el filtro actúa sobre lo mostrado.
  const rows = onlyLowStock ? (data ?? []).filter(p => p.stock <= p.min_stock) : (data ?? []);
  return { rows, total: count ?? 0 };
}

export async function updateProduct(id: string, patch: Omit<Partial<Product>, 'stock' | 'stock_frac'>): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('products').update(patch).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Su rol no permite modificar el inventario.');
}

/**
 * Ajuste manual de existencia. La ÚNICA vía: el servidor exige motivo y rol,
 * y deja el movimiento en el kardex y la acción en la bitácora. Editar
 * `products.stock` directo está bloqueado por trigger desde 0019.
 */
export async function adjustStock(productId: string, newQty: number, reason: string): Promise<Product> {
  const { data, error } = await requireSupabase().rpc('adjust_stock', {
    p_product_id: productId, p_new_qty: newQty, p_reason: reason
  });
  if (error) throw error;
  return data as Product;
}

export type InventoryMovement = Tables<'inventory_movements'> & {
  products: { name: string; code: string; unit: string } | null;
};
export type InventoryMovementKind = Enums['inventory_movement_kind'];

// ---------------------------------------------------------- Reporte gerencial

export interface ManagementReport {
  from: string;
  to: string;
  sales: {
    total_cents: number; invoice_count: number;
    annulled_cents: number; annulled_count: number; avg_ticket_cents: number;
  };
  by_method: { method: PaymentMethod; amount_cents: number }[];
  by_service: { service_id: string | null; name: string; qty: number; sales_cents: number }[];
  by_product: { product_id: string | null; name: string; qty: number; sales_cents: number }[];
  by_employee: { profile_id: string | null; name: string; invoice_count: number; sales_cents: number }[];
  expenses: { category: ExpenseCategory; amount_cents: number }[];
  expenses_total_cents: number;
  purchases_total_cents: number;
  payables_cents: number;
  consumption_cents: number;
  service_margin: {
    service_id: string | null; name: string;
    sales_cents: number; consumption_cents: number; margin_cents: number;
  }[];
  gross_profit_cents: number;
}

export async function fetchManagementReport(
  from: string, to: string, branchId?: string | null
): Promise<ManagementReport> {
  const { data, error } = await requireSupabase().rpc('management_report', {
    p_from: from, p_to: to, p_branch_id: branchId ?? null
  });
  if (error) throw error;
  return data as unknown as ManagementReport;
}

// ------------------------------------------------------------------- Recetas

export type ServiceRecipe = Tables<'service_recipes'> & {
  products: { name: string; code: string; unit: string; cost_cents: number } | null;
};

export async function fetchServiceRecipes(serviceId: string): Promise<ServiceRecipe[]> {
  const { data, error } = await requireSupabase()
    .from('service_recipes')
    .select('*, products!service_recipes_product_same_company(name, code, unit, cost_cents)')
    .eq('service_id', serviceId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ServiceRecipe[];
}

export async function addRecipeLine(input: {
  companyId: string; serviceId: string; productId: string;
  vehicleCategory: VehicleCategory | null; quantity: number;
}): Promise<void> {
  const { error } = await requireSupabase().from('service_recipes').insert({
    company_id: input.companyId,
    service_id: input.serviceId,
    product_id: input.productId,
    vehicle_category: input.vehicleCategory,
    quantity: input.quantity
  });
  if (error) throw friendlyDuplicate(error, 'renglón de receta', 'insumo y categoría');
}

export async function deleteRecipeLine(id: string): Promise<void> {
  const { error } = await requireSupabase().from('service_recipes').delete().eq('id', id);
  if (error) throw error;
}

/** Costo estimado de ejecutar el servicio hoy (recetas × último costo). */
export async function fetchRecipeCost(
  serviceId: string, category: VehicleCategory | null = null
): Promise<number> {
  const { data, error } = await requireSupabase().rpc('service_recipe_cost', {
    p_service_id: serviceId, p_vehicle_category: category
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ------------------------------------------------------ Proveedores y compras

export type Supplier = Tables<'suppliers'>;
export type Purchase = Tables<'purchases'> & {
  suppliers: { name: string } | null;
};

export async function fetchSupplierPage(
  page: number, pageSize: number, search: string
): Promise<PagedResult<Supplier>> {
  let query = requireSupabase().from('suppliers').select('*', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`name.ilike.%${t}%,phone.ilike.%${t}%,tax_id.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('name')
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function createSupplier(input: {
  companyId: string; name: string; taxId?: string; phone?: string; email?: string; notes?: string;
}): Promise<Supplier> {
  const { data, error } = await requireSupabase().from('suppliers').insert({
    company_id: input.companyId,
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null
  }).select().single();
  if (error) throw friendlyDuplicate(error, 'proveedor', 'nombre');
  return data;
}

export async function updateSupplier(id: string, patch: {
  name?: string; tax_id?: string | null; phone?: string | null;
  email?: string | null; address?: string | null; notes?: string | null; is_active?: boolean;
}): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('suppliers').update(patch).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Su rol no permite administrar proveedores.');
}

/** Proveedores activos para el selector de la compra (sin paginar, acotado). */
export async function fetchActiveSuppliers(): Promise<Supplier[]> {
  const { data, error } = await requireSupabase()
    .from('suppliers').select('*').eq('is_active', true).order('name').limit(200);
  if (error) throw error;
  return data ?? [];
}

type PendingFilter = 'all' | 'pending';

export async function fetchPurchasePage(
  page: number, pageSize: number, search: string, pending: PendingFilter
): Promise<PagedResult<Purchase>> {
  let query = requireSupabase()
    .from('purchases')
    .select('*, suppliers!purchases_supplier_same_company(name)', { count: 'exact' })
    .eq('status', 'recibida');
  if (pending === 'pending') {
    // Cuentas por pagar: saldo > 0. PostgREST no compara columnas entre sí:
    // se acota a crédito en el servidor y el saldo se filtra sobre la página
    // (el contado nace saldado, así que el universo correcto es el crédito).
    query = query.eq('is_credit', true);
  }
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`name.ilike.%${t}%`, { referencedTable: 'suppliers' });
  }
  const { data, error, count } = await query
    .order('purchase_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  const rows = (data ?? []) as Purchase[];
  return {
    rows: pending === 'pending' ? rows.filter(p => p.paid_cents < p.total_cents) : rows,
    total: count ?? 0
  };
}

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  unitCostCents: number;
}

export async function registerPurchase(input: {
  supplierId: string;
  items: PurchaseItemInput[];
  isCredit: boolean;
  dueDate?: string | null;
  paymentMethod: PaymentMethod;
  invoiceRef?: string;
  taxCents?: number;
  notes?: string;
  cashSessionId?: string | null;
}): Promise<Tables<'purchases'>> {
  const { data, error } = await requireSupabase().rpc('register_purchase', {
    p_supplier_id: input.supplierId,
    p_items: input.items as unknown as Json,
    p_is_credit: input.isCredit,
    p_due_date: input.dueDate ?? null,
    p_payment_method: input.paymentMethod,
    p_invoice_ref: input.invoiceRef ?? null,
    p_tax_cents: input.taxCents ?? 0,
    p_notes: input.notes ?? null,
    p_cash_session_id: input.cashSessionId ?? null
  });
  if (error) throw error;
  return data as Tables<'purchases'>;
}

export async function paySupplier(input: {
  purchaseId: string; amountCents: number; paymentMethod: PaymentMethod; reference?: string;
}): Promise<Tables<'purchases'>> {
  const { data, error } = await requireSupabase().rpc('pay_supplier', {
    p_purchase_id: input.purchaseId,
    p_amount_cents: input.amountCents,
    p_payment_method: input.paymentMethod,
    p_reference: input.reference ?? null
  });
  if (error) throw error;
  return data as Tables<'purchases'>;
}

/** Kardex paginado. `kind` filtra por clase; la búsqueda es por producto. */
export async function fetchInventoryMovementPage(
  page: number, pageSize: number, search: string, kind: InventoryMovementKind | 'all'
): Promise<PagedResult<InventoryMovement>> {
  let query = requireSupabase()
    .from('inventory_movements')
    .select('*, products!inner(name, code, unit)', { count: 'exact' });
  if (kind !== 'all') query = query.eq('kind', kind);
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`name.ilike.%${t}%,code.ilike.%${t}%`, { referencedTable: 'products' });
  }
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as InventoryMovement[], total: count ?? 0 };
}

export async function createProduct(input: {
  companyId: string;
  branchId: string | null;
  code: string;
  name: string;
  category?: string;
  costCents: number;
  priceCents: number;
  stock: number;
  minStock: number;
  unit: string;
  isForSale: boolean;
}): Promise<Product> {
  const { data, error } = await requireSupabase().from('products').insert({
    company_id: input.companyId,
    branch_id: input.branchId,
    code: input.code.trim(),
    name: input.name.trim(),
    category: input.category?.trim() ?? '',
    cost_cents: input.costCents,
    price_cents: input.priceCents,
    stock: input.stock,
    min_stock: input.minStock,
    unit: input.unit.trim() || 'Unidad',
    is_for_sale: input.isForSale
  }).select().single();
  if (error) throw friendlyDuplicate(error, 'producto', 'código');
  return data;
}

// --------------------------------------------------------------- Equipo

export type UserRole = Enums['user_role'];
export type Branch = Tables<'branches'>;

export async function fetchTeam(): Promise<Profile[]> {
  const { data, error } = await requireSupabase()
    .from('profiles').select('*').order('full_name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchBranches(): Promise<Branch[]> {
  const { data, error } = await requireSupabase()
    .from('branches').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return data ?? [];
}

/**
 * Alta de empleado.
 *
 * Crear el usuario de acceso de otra persona no puede hacerse con seguridad
 * desde el navegador (exigiría la service_role). Se delega en la función
 * `create_employee` del servidor, que verifica el rol de quien llama, aplica el
 * techo de rol y fuerza el tenant. Los mensajes de error ya vienen en claro.
 */
export async function createEmployee(input: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  branchId?: string | null;
  phone?: string | null;
  commissionBps?: number | null;
}): Promise<Profile> {
  const { data, error } = await requireSupabase().rpc('create_employee', {
    p_email: input.email,
    p_password: input.password,
    p_full_name: input.fullName,
    p_role: input.role,
    p_branch_id: input.branchId ?? undefined,
    p_phone: input.phone ?? undefined,
    p_commission_bps: input.commissionBps ?? undefined
  });
  if (error) throw new Error(error.message);
  return data as unknown as Profile;
}

export interface CommissionSummary {
  profileId: string;
  totalCents: number;
  unpaidCents: number;
  count: number;
}

/**
 * Resumen de comisiones por operario en un periodo.
 *
 * Se agrupa en el cliente sobre las filas del periodo —acotadas por fecha—, no
 * sobre el histórico completo.
 */
export async function fetchCommissionSummary(
  fromDate: string, toDate: string
): Promise<Map<string, CommissionSummary>> {
  const { data, error } = await requireSupabase()
    .from('commissions')
    .select('profile_id, amount_cents, is_paid')
    .gte('earned_on', fromDate)
    .lte('earned_on', toDate);
  if (error) throw error;

  const map = new Map<string, CommissionSummary>();
  for (const row of data ?? []) {
    const entry = map.get(row.profile_id)
      ?? { profileId: row.profile_id, totalCents: 0, unpaidCents: 0, count: 0 };
    entry.totalCents += row.amount_cents;
    if (!row.is_paid) entry.unpaidCents += row.amount_cents;
    entry.count += 1;
    map.set(row.profile_id, entry);
  }
  return map;
}

// --------------------------------------------------------------- Gastos

export async function fetchExpensePage(
  page: number, pageSize: number, search: string, category?: ExpenseCategory | 'all'
): Promise<PagedResult<Expense>> {
  let query = requireSupabase().from('expenses').select('*', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`description.ilike.%${t}%,supplier_name.ilike.%${t}%,invoice_ref.ilike.%${t}%`);
  }
  if (category && category !== 'all') query = query.eq('category', category);

  const { data, error, count } = await query
    .order('expense_date', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function createExpense(params: {
  branchId: string; clientRequestId: string; description: string; amountCents: number;
  category: ExpenseCategory; paymentMethod: PaymentMethod;
  supplierName?: string | null; cashSessionId?: string | null;
}): Promise<Expense> {
  const { data, error } = await requireSupabase().rpc('create_expense', {
    p_branch_id: params.branchId,
    p_client_request_id: params.clientRequestId,
    p_description: params.description,
    p_amount_cents: params.amountCents,
    p_category: params.category,
    p_payment_method: params.paymentMethod,
    p_supplier_name: params.supplierName ?? undefined,
    p_cash_session_id: params.cashSessionId ?? undefined
  });
  if (error) {
    if (error.message.includes('exige una caja abierta')) {
      throw new Error('Para registrar un gasto en efectivo debe haber una caja abierta.');
    }
    throw new Error(error.message);
  }
  return data as unknown as Expense;
}

// --------------------------------------------------------------- Bahías

export async function fetchAllBays(branchId: string): Promise<Bay[]> {
  const { data, error } = await requireSupabase()
    .from('bays').select('*').eq('branch_id', branchId).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function setBayStatus(id: string, status: BayStatus): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('bays').update({ status }).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('No se pudo cambiar el estado de la bahía.');
}

export async function createBay(input: {
  companyId: string;
  branchId: string;
  name: string;
  type: BayType;
}): Promise<Bay> {
  const { data, error } = await requireSupabase().from('bays').insert({
    company_id: input.companyId,
    branch_id: input.branchId,
    name: input.name.trim(),
    type: input.type
  }).select().single();
  if (error) throw friendlyDuplicate(error, 'bahía', 'nombre');
  return data;
}

// --------------------------------------------------------------- Reportes

export async function fetchAuditPage(
  page: number, pageSize: number, search: string
): Promise<PagedResult<AuditLog>> {
  let query = requireSupabase().from('audit_logs').select('*', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`action.ilike.%${t}%,details.ilike.%${t}%,actor_name.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('occurred_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export interface DashboardMetrics {
  in_queue: number; in_process: number; ready: number;
  arrived: number; delivered: number; membego_orders: number;
  sales_cents: number; invoice_count: number;
  avg_ticket_cents: number; annulled_cents: number;
}

export async function fetchDashboardMetrics(
  branchId: string, from: Date, to: Date
): Promise<DashboardMetrics> {
  const { data, error } = await requireSupabase().rpc('dashboard_metrics', {
    p_branch_id: branchId,
    p_from: from.toISOString(),
    p_to: to.toISOString()
  });
  if (error) throw error;
  return data as unknown as DashboardMetrics;
}

// --------------------------------------------------------------- Ajustes

// --------------------------------------------------------------- Membego

export interface MembegoLink {
  membegoCompanyId: string;
  isActive: boolean;
}

/** Vínculo actual de esta empresa con su comercio de Membego (o null). */
export async function fetchMembegoLink(): Promise<MembegoLink | null> {
  const { data, error } = await requireSupabase()
    .from('membego_company_links')
    .select('membego_company_id, is_active')
    .maybeSingle();
  if (error) throw error;
  return data ? { membegoCompanyId: data.membego_company_id, isActive: data.is_active } : null;
}

/**
 * Vincula el comercio de Membego a la empresa del usuario. Lo hace por RPC con la
 * sesión del dueño (auth.uid()), no como el editor SQL: la función comprueba el
 * rol. Reejecutar cambia el companyId.
 */
export async function linkMembegoCompany(membegoCompanyId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('membego_link_company', {
    p_membego_company_id: membegoCompanyId.trim()
  });
  if (error) throw new Error(error.message);
}

export async function updateCompany(id: string, patch: Partial<Company>): Promise<Company> {
  const { data, error } = await requireSupabase()
    .from('companies').update(patch).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Solo el propietario puede modificar los datos de la empresa.');
  }
  return data[0];
}

// --------------------------------------------------------------- Membego

export async function fetchMembegoLogs(limit = 50): Promise<MembegoSyncLog[]> {
  const { data, error } = await requireSupabase()
    .from('membego_sync_logs').select('*')
    .order('occurred_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function recordMembegoLog(input: {
  companyId: string; branchId: string | null; action: string;
  status: 'success' | 'failed' | 'retry_pending';
  idempotencyKey?: string | null;
  request?: Json; response?: Json; errorMessage?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from('membego_sync_logs').insert({
    company_id: input.companyId, branch_id: input.branchId,
    action: input.action, status: input.status,
    idempotency_key: input.idempotencyKey ?? null,
    request_payload: input.request ?? {}, response_payload: input.response ?? {},
    error_message: input.errorMessage ?? null
  });
  if (error) throw error;
}

// ─────────────────────────────────── Niveles tarifarios de Membego

/**
 * Equivalencia entre las categorías de vehículo de este sistema y los niveles
 * tarifarios de Membego.
 *
 * Membego decide si una membresía cubre un carro comparando NÚMEROS: cada plan
 * lleva un tope y cada categoría un nivel. Cuál de las nuestras vale 1 y cuál 3
 * es una decisión del negocio —en un local una jeepeta y una SUV son lo mismo y
 * en otro no—, así que se configura, no se codifica.
 *
 * Sin fila = sin nivel. NO es 1: con 1 por defecto, todas las categorías
 * cabrían en el plan más barato y el negocio regalaría lavados de camión sin
 * enterarse.
 */

export type NivelesPorCategoria = Partial<Record<VehicleCategory, number>>;

export async function fetchVehicleCategoryLevels(): Promise<NivelesPorCategoria> {
  const { data, error } = await requireSupabase()
    .from('vehicle_category_levels')
    .select('category, level');
  if (error) throw error;

  const mapa: NivelesPorCategoria = {};
  for (const fila of data ?? []) mapa[fila.category as VehicleCategory] = fila.level;
  return mapa;
}

/**
 * Guarda el mapa entero de una vez.
 *
 * Una llamada por categoría dejaría el mapa a medias si la tercera falla, y un
 * mapa a medias cobra mal sin avisar. `null` en una categoría la devuelve a
 * «sin configurar»; una categoría ausente se deja como estaba.
 */
export async function setVehicleCategoryLevels(
  niveles: Partial<Record<VehicleCategory, number | null>>
): Promise<NivelesPorCategoria> {
  const { data, error } = await requireSupabase()
    .rpc('set_vehicle_category_levels', { p_niveles: niveles as never });
  if (error) throw new Error(error.message);

  const mapa: NivelesPorCategoria = {};
  for (const fila of (data ?? []) as { category: string; level: number }[]) {
    mapa[fila.category as VehicleCategory] = fila.level;
  }
  return mapa;
}

// ─────────────────────────────────── Eliminar y archivar (migración 0040)

/**
 * Por qué no se pudo borrar. El motivo importa porque cada uno tiene una salida
 * distinta, y decirle «error» a las tres es dejar al usuario sin saber qué hacer.
 */
export type MotivoNoBorrado = 'con_historia' | 'sin_permiso' | 'desconocido';

export class ErrorBorrado extends Error {
  constructor(readonly motivo: MotivoNoBorrado, mensaje: string) {
    super(mensaje);
  }
}

/** Las tablas que la migración 0040 abrió. Nada más se puede pasar por aquí. */
export type TablaBorrable =
  | 'services' | 'products' | 'customers' | 'vehicles' | 'suppliers'
  | 'promotions' | 'equipment' | 'bays' | 'appointments' | 'claims' | 'fleets';

/**
 * Borrar una fila, distinguiendo los tres «no» posibles.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * UN DELETE DENEGADO POR RLS NO DA ERROR
 *
 * Esta es la trampa. PostgREST no falla cuando una política impide borrar:
 * la sentencia se ejecuta, afecta CERO filas y responde 200. Sin comprobar
 * cuántas filas volvieron, la pantalla diría «eliminado» y la fila seguiría
 * ahí — el peor de los resultados, porque el usuario deja de mirar.
 *
 * De ahí el `.select()`: obliga a que la respuesta traiga lo borrado, y si
 * viene vacía es que no se borró nada.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EL MENSAJE DE LA BASE SE APROVECHA CUANDO ES BUENO
 *
 * El disparador de 0040 ya redacta «tiene 40 facturas asociadas», así que ese
 * texto se pasa tal cual. Pero cuando salta la clave ajena en crudo —le pasa a
 * un administrador limitado a una sucursal, que no ve el historial de la otra—
 * el mensaje es ilegible y se sustituye.
 */
export async function eliminarFila(tabla: TablaBorrable, id: string): Promise<void> {
  const { data, error } = await requireSupabase()
    .from(tabla).delete().eq('id', id).select();

  if (error) {
    // 23503 = clave ajena. Es «tiene historia», venga del disparador con su
    // mensaje bueno o de la restricción con el suyo, que no se le puede
    // enseñar a nadie.
    if (error.code === '23503') {
      const suyo = error.message?.includes('No se puede eliminar')
        ? error.message
        : 'No se puede eliminar: tiene registros asociados (puede que en otra sucursal). ' +
          'Archívelo en vez de borrarlo: deja de aparecer y el historial se conserva.';
      throw new ErrorBorrado('con_historia', suyo);
    }
    throw new ErrorBorrado('desconocido', error.message ?? 'No se pudo eliminar.');
  }

  if (!data || data.length === 0) {
    throw new ErrorBorrado(
      'sin_permiso',
      'No se pudo eliminar: su rol no lo permite. Solo el propietario y los administradores pueden.'
    );
  }
}

/**
 * Archivar en vez de borrar: la salida que se ofrece cuando hay historia.
 *
 * No es un borrado suave disfrazado — la fila sigue entera y sus facturas
 * siguen enlazadas. Lo único que cambia es que deja de aparecer en búsquedas y
 * selectores, que es lo que de verdad estorbaba.
 */
export async function archivarFila(
  tabla: 'customers' | 'vehicles' | 'services' | 'products' | 'suppliers' | 'promotions',
  id: string,
  archivar = true
): Promise<void> {
  // El cast es por los tipos generados, que todavía no conocen `is_active` en
  // clientes ni vehículos. La columna existe desde 0040; se va con la próxima
  // generación de tipos.
  const { data, error } = await requireSupabase()
    .from(tabla).update({ is_active: !archivar } as never).eq('id', id).select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('No se pudo archivar: puede que su rol no lo permita.');
  }
}
