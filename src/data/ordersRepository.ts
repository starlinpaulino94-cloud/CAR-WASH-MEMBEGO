import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Acceso a datos de Órdenes y Kanban.
 *
 * Los cambios de estado NUNCA se hacen con un update suelto desde el navegador:
 * van por `advance_work_order`, que valida la transición, ocupa o libera la
 * bahía, ajusta los operarios y genera las comisiones, todo en una transacción.
 */

export type WorkOrder = Tables<'work_orders'>;
export type WorkOrderItem = Tables<'work_order_items'>;
export type Bay = Tables<'bays'>;
export type Profile = Tables<'profiles'>;
export type OrderStatus = Enums['order_status'];
export type VehicleCategory = Enums['vehicle_category'];

/** Estados que siguen en el taller. Todo lo demás es histórico. */
export const ACTIVE_STATUSES: OrderStatus[] = [
  'pendiente', 'en_espera', 'asignada', 'en_proceso', 'control_calidad', 'listo'
];

/**
 * Transiciones permitidas, réplica de `app.order_transition_allowed`.
 *
 * Aquí solo sirve para no ofrecer botones que la base va a rechazar. La regla
 * que manda es la del servidor: duplicarla en el cliente es comodidad, no
 * control.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pendiente:       ['en_espera', 'asignada', 'en_proceso', 'cancelado'],
  en_espera:       ['asignada', 'en_proceso', 'cancelado'],
  asignada:        ['en_proceso', 'en_espera', 'cancelado'],
  en_proceso:      ['control_calidad', 'listo', 'cancelado'],
  control_calidad: ['listo', 'en_proceso', 'cancelado'],
  listo:           ['entregado', 'control_calidad'],
  entregado:       [],
  cancelado:       []
};

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pendiente: 'Pendiente',
  en_espera: 'En espera',
  asignada: 'Asignada',
  en_proceso: 'En lavado',
  control_calidad: 'Control de calidad',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelada'
};

// --------------------------------------------------------------- Consultas

export interface OrderPageParams {
  branchId: string;
  page: number;
  pageSize: number;
  search?: string;
  status?: OrderStatus | 'all' | 'active';
}

export interface OrderPage {
  rows: WorkOrder[];
  total: number;
}

/** Página de órdenes, filtrada y paginada en el servidor. */
export async function fetchOrderPage(params: OrderPageParams): Promise<OrderPage> {
  const from = params.page * params.pageSize;

  let query = requireSupabase()
    .from('work_orders')
    .select('*', { count: 'exact' })
    .eq('branch_id', params.branchId);

  const term = params.search?.trim();
  if (term) {
    const escaped = term.replace(/[%,()]/g, '');
    query = query.or(
      `order_number.ilike.%${escaped}%,` +
      `vehicle_plate.ilike.%${escaped}%,` +
      `customer_name.ilike.%${escaped}%`
    );
  }

  if (params.status === 'active') query = query.in('status', ACTIVE_STATUSES);
  else if (params.status && params.status !== 'all') query = query.eq('status', params.status);

  const { data, error, count } = await query
    .order('arrival_at', { ascending: false })
    .range(from, from + params.pageSize - 1);

  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/**
 * Órdenes del tablero Kanban.
 *
 * Trae las activas —cuya cantidad está acotada por las bahías físicas del
 * local— más una ventana corta de entregadas. El tablero auditado incluía una
 * columna "Entregados" sin límite: crecía sin fin y arrastraba todo el
 * histórico al navegador.
 */
export async function fetchBoardOrders(branchId: string, deliveredLimit = 15): Promise<WorkOrder[]> {
  const supabase = requireSupabase();

  const [active, delivered] = await Promise.all([
    supabase.from('work_orders').select('*')
      .eq('branch_id', branchId).in('status', ACTIVE_STATUSES)
      .order('arrival_at', { ascending: true }),
    supabase.from('work_orders').select('*')
      .eq('branch_id', branchId).eq('status', 'entregado')
      .order('delivered_at', { ascending: false }).limit(deliveredLimit)
  ]);

  if (active.error) throw active.error;
  if (delivered.error) throw delivered.error;
  return [...(active.data ?? []), ...(delivered.data ?? [])];
}

export async function fetchOrderItems(orderId: string): Promise<WorkOrderItem[]> {
  const { data, error } = await requireSupabase()
    .from('work_order_items').select('*').eq('work_order_id', orderId).order('created_at');
  if (error) throw error;
  return data ?? [];
}

/** Los ítems de varias órdenes de una vez, para no caer en un N+1 en el tablero. */
export async function fetchItemsForOrders(orderIds: string[]): Promise<Map<string, WorkOrderItem[]>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await requireSupabase()
    .from('work_order_items').select('*').in('work_order_id', orderIds);
  if (error) throw error;

  const map = new Map<string, WorkOrderItem[]>();
  for (const item of data ?? []) {
    const list = map.get(item.work_order_id) ?? [];
    list.push(item);
    map.set(item.work_order_id, list);
  }
  return map;
}

export async function fetchBays(branchId: string): Promise<Bay[]> {
  const { data, error } = await requireSupabase()
    .from('bays').select('*').eq('branch_id', branchId).eq('is_active', true).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchOperators(branchId: string): Promise<Profile[]> {
  const { data, error } = await requireSupabase()
    .from('profiles').select('*')
    .eq('branch_id', branchId).eq('is_active', true)
    .in('role', ['operario', 'supervisor'])
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchAssignees(orderIds: string[]): Promise<Map<string, string[]>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await requireSupabase()
    .from('work_order_assignees').select('work_order_id, profile_id').in('work_order_id', orderIds);
  if (error) throw error;

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = map.get(row.work_order_id) ?? [];
    list.push(row.profile_id);
    map.set(row.work_order_id, list);
  }
  return map;
}

export async function fetchServicesForCategory(category: VehicleCategory) {
  const { data, error } = await requireSupabase()
    .from('services')
    .select('*, service_prices!inner(price_cents, vehicle_category)')
    .eq('is_active', true)
    .eq('service_prices.vehicle_category', category)
    .order('name');
  if (error) throw error;

  return (data ?? []).map(row => {
    const { service_prices, ...service } = row as Tables<'services'> & {
      service_prices: { price_cents: number }[];
    };
    return { ...service, price_cents: service_prices[0]?.price_cents ?? 0 };
  });
}

// --------------------------------------------------------------- Mutaciones

export interface CreateOrderParams {
  branchId: string;
  clientRequestId: string;
  plate: string;
  category: VehicleCategory;
  services: { serviceId: string; name: string; quantity: number }[];
  customerName: string | null;
  /**
   * Ficha ya existente. Cuando viene, el servidor NO crea cliente nuevo: enlaza
   * la orden a esa ficha y le asigna el vehículo si estaba huérfano. Es la
   * diferencia entre un directorio con un «Juan Pérez» y uno con nueve.
   */
  customerId?: string | null;
  customerPhone?: string | null;
  make?: string;
  model?: string;
  color?: string;
  priority?: 'normal' | 'alta' | 'vip_membego';
  notes?: string | null;
}

export async function createWorkOrder(params: CreateOrderParams): Promise<WorkOrder> {
  const { data, error } = await requireSupabase().rpc('create_work_order', {
    p_branch_id: params.branchId,
    p_client_request_id: params.clientRequestId,
    p_vehicle_plate: params.plate,
    p_vehicle_category: params.category,
    p_items: params.services.map(s => ({
      service_id: s.serviceId, name: s.name, quantity: s.quantity,
      discount_cents: 0, is_membego_covered: false
    })),
    p_customer_name: params.customerName ?? undefined,
    p_customer_id: params.customerId ?? null,
    p_customer_phone: params.customerPhone ?? null,
    p_vehicle_make: params.make ?? '',
    p_vehicle_model: params.model ?? '',
    p_vehicle_color: params.color ?? '',
    p_priority: params.priority ?? 'normal',
    p_notes: params.notes ?? null
  });

  if (error) throw new Error(translate(error.message));
  return data as unknown as WorkOrder;
}

export async function advanceOrder(
  orderId: string,
  newStatus: OrderStatus,
  bayId?: string | null,
  assignees?: string[] | null
): Promise<WorkOrder> {
  const { data, error } = await requireSupabase().rpc('advance_work_order', {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_bay_id: bayId ?? null,
    p_assignees: assignees ?? null
  });

  if (error) throw new Error(translate(error.message));
  return data as unknown as WorkOrder;
}

/**
 * Cancelar una orden, con motivo obligatorio.
 *
 * No pasa por `advanceOrder`: cancelar exige motivo, comprueba que la orden no
 * esté facturada y pide un rol distinto. Meterlo en el cambio de estado
 * genérico habría hecho que el motivo fuera opcional en la firma, y un motivo
 * opcional es un motivo que nadie escribe.
 */
export async function cancelOrder(orderId: string, reason: string): Promise<WorkOrder> {
  const { data, error } = await requireSupabase().rpc('cancel_work_order', {
    p_order_id: orderId,
    p_reason: reason
  });

  if (error) throw new Error(translate(error.message));
  return data as unknown as WorkOrder;
}

/** Mensajes del servidor traducidos a algo accionable en el taller. */
function translate(message: string): string {
  // Los mensajes de cancel_work_order ya vienen escritos para el usuario y
  // dicen qué hacer («anule primero la factura»). Traducirlos otra vez sería
  // reemplazar algo específico por algo genérico.
  if (message.includes('ya está facturada') ||
      message.includes('lista para entregar') ||
      message.includes('Explique por qué') ||
      message.includes('no permite cancelar')) {
    return message;
  }
  if (message.includes('ya está ocupada')) {
    return 'Esa bahía ya tiene un vehículo. Elija otra o libérela primero.';
  }
  if (message.includes('en mantenimiento')) {
    return 'Esa bahía está en mantenimiento y no puede recibir vehículos.';
  }
  if (message.includes('exige indicar la bahía')) {
    return 'Para iniciar el lavado hay que elegir en qué bahía entra el vehículo.';
  }
  if (message.includes('No se puede pasar de') || message.includes('Transición no permitida')) {
    return 'Ese cambio de estado no es válido desde la situación actual de la orden.';
  }
  if (message.includes('no tiene precio definido')) {
    return 'Uno de los servicios no tiene precio para esta categoría de vehículo.';
  }
  if (message.includes('placa del vehículo es obligatoria')) {
    return 'Introduzca la placa del vehículo.';
  }
  if (message.includes('al menos un servicio')) {
    return 'Seleccione al menos un servicio.';
  }
  if (message.includes('No tiene permiso')) {
    return 'Su rol no permite modificar esta orden.';
  }
  return message;
}
