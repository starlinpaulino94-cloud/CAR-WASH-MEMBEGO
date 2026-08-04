import { requireSupabase } from '../lib/supabase';
import { Tables, Enums, Json } from '../lib/database.types';
import { PagedResult } from '../hooks/usePagedQuery';

/**
 * Acceso a datos del resto de vistas: catálogo, clientes, vehículos, equipo,
 * gastos, bahías, reportes y ajustes.
 *
 * Todo listado se pagina y filtra en el servidor. Ninguna vista se trae el
 * histórico completo para contarlo o buscarlo en memoria.
 */

export type Customer = Tables<'customers'>;
export type Vehicle = Tables<'vehicles'>;
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

export async function fetchCustomerPage(
  page: number, pageSize: number, search: string
): Promise<PagedResult<Customer>> {
  let query = requireSupabase().from('customers').select('*', { count: 'exact' });
  if (search.trim()) {
    const t = escape(search.trim());
    query = query.or(`name.ilike.%${t}%,phone.ilike.%${t}%,email.ilike.%${t}%,tax_id.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
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

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer> {
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

export async function updateProduct(id: string, patch: Partial<Product>): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('products').update(patch).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Su rol no permite modificar el inventario.');
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
