import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';
import { PagedResult } from '../hooks/usePagedQuery';

/**
 * Equipos y mantenimiento.
 *
 * Marcar una bahía "en mantenimiento" no dice qué se rompió, cuánto costó ni
 * cuándo toca la próxima revisión. Aquí el mantenimiento es un proceso con
 * historial y costo acumulado por equipo.
 */

export type Equipment = Tables<'equipment'>;
export type MaintenanceOrder = Tables<'maintenance_orders'>;
export type EquipmentStatus = Enums['equipment_status'];
export type MaintenanceKind = Enums['maintenance_kind'];

export async function fetchEquipmentPage(
  page: number, pageSize: number, search: string
): Promise<PagedResult<Equipment>> {
  let query = requireSupabase().from('equipment').select('*', { count: 'exact' })
    .neq('status', 'retirado');
  if (search.trim()) {
    const t = search.trim().replace(/[%,()]/g, '');
    query = query.or(`name.ilike.%${t}%,code.ilike.%${t}%,brand.ilike.%${t}%,serial_number.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('name')
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function createEquipment(input: {
  companyId: string; branchId: string | null; code: string; name: string;
  category?: string; brand?: string; model?: string; serialNumber?: string;
  purchaseDate?: string | null; purchaseCents?: number; warrantyUntil?: string | null;
  serviceEveryDays?: number | null; nextServiceAt?: string | null; notes?: string;
}): Promise<Equipment> {
  const { data, error } = await requireSupabase().from('equipment').insert({
    company_id: input.companyId,
    branch_id: input.branchId,
    code: input.code.trim(),
    name: input.name.trim(),
    category: input.category?.trim() ?? '',
    brand: input.brand?.trim() || null,
    model: input.model?.trim() || null,
    serial_number: input.serialNumber?.trim() || null,
    purchase_date: input.purchaseDate || null,
    purchase_cents: input.purchaseCents ?? 0,
    warranty_until: input.warrantyUntil || null,
    service_every_days: input.serviceEveryDays ?? null,
    next_service_at: input.nextServiceAt || null,
    notes: input.notes?.trim() || null
  }).select().single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Ya existe un equipo con ese código.');
    }
    throw error;
  }
  return data;
}

/** Intervenciones de un equipo, la más reciente primero. */
export async function fetchMaintenanceHistory(equipmentId: string): Promise<MaintenanceOrder[]> {
  const { data, error } = await requireSupabase()
    .from('maintenance_orders').select('*')
    .eq('equipment_id', equipmentId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function openMaintenance(input: {
  equipmentId: string; kind: MaintenanceKind; description: string; supplierId?: string | null;
}): Promise<MaintenanceOrder> {
  const { data, error } = await requireSupabase().rpc('open_maintenance', {
    p_equipment_id: input.equipmentId,
    p_kind: input.kind,
    p_description: input.description,
    p_supplier_id: input.supplierId ?? null
  });
  if (error) throw error;
  return data as MaintenanceOrder;
}

export async function completeMaintenance(input: {
  maintenanceId: string; costCents: number; resolution?: string; parts?: string;
}): Promise<MaintenanceOrder> {
  const { data, error } = await requireSupabase().rpc('complete_maintenance', {
    p_maintenance_id: input.maintenanceId,
    p_cost_cents: input.costCents,
    p_resolution: input.resolution ?? null,
    p_parts: input.parts ?? null
  });
  if (error) throw error;
  return data as MaintenanceOrder;
}
