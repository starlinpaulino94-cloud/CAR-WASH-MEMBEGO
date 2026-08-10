import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';
import { PagedResult } from '../hooks/usePagedQuery';

/**
 * Flotillas y contratos corporativos.
 *
 * Una flotilla agrupa vehículos y apunta al cliente que paga —el mismo que
 * lleva el cupo de crédito—. Su tarifa pactada gana al catálogo sin que nadie
 * aplique descuentos a mano, y el periodo se factura de una vez, a crédito.
 *
 * Aquí solo se lee y se llaman los RPC: precios y saldos los decide la base.
 */

export type Fleet = Tables<'fleets'>;
export type FleetRate = Tables<'fleet_rates'>;
export type Vehicle = Tables<'vehicles'>;
export type Invoice = Tables<'invoices'>;
export type VehicleCategory = Enums['vehicle_category'];

/** Lo que devuelve fleet_statement(). */
export interface FleetStatement {
  fleet: { id: string; name: string; code: string | null; po_reference: string | null };
  from: string;
  to: string;
  totals: {
    services: number;
    total_cents: number;
    billed_cents: number;
    unbilled_cents: number;
  };
  by_vehicle: { plate: string; services: number; total_cents: number }[];
  balance_cents: number;
}

/** Flotilla con el nombre del cliente que paga ya resuelto. */
export interface FleetRow extends Fleet {
  customer_name: string;
  vehicle_count: number;
}

interface JoinedFleet extends Fleet {
  customers: { name: string } | null;
  vehicles: { count: number }[] | null;
}

export async function fetchFleetPage(
  page: number, pageSize: number, search: string, onlyActive: boolean
): Promise<PagedResult<FleetRow>> {
  let query = requireSupabase()
    .from('fleets')
    .select('*, customers(name), vehicles(count)', { count: 'exact' });

  if (onlyActive) query = query.eq('is_active', true);
  if (search.trim()) {
    const t = search.trim().replace(/[%,()]/g, '');
    query = query.or(`name.ilike.%${t}%,code.ilike.%${t}%`);
  }

  const { data, error, count } = await query
    .order('name')
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;

  const rows = (data ?? []).map(raw => {
    const f = raw as unknown as JoinedFleet;
    return {
      ...f,
      customer_name: f.customers?.name ?? '—',
      vehicle_count: f.vehicles?.[0]?.count ?? 0
    } as FleetRow;
  });
  return { rows, total: count ?? 0 };
}

export async function fetchFleetVehicles(fleetId: string): Promise<Vehicle[]> {
  const { data, error } = await requireSupabase()
    .from('vehicles').select('*')
    .eq('fleet_id', fleetId)
    .order('plate');
  if (error) throw error;
  return data ?? [];
}

export async function fetchFleetRates(fleetId: string): Promise<FleetRate[]> {
  const { data, error } = await requireSupabase()
    .from('fleet_rates').select('*')
    .eq('fleet_id', fleetId)
    .order('service_id');
  if (error) throw error;
  return data ?? [];
}

/** Vehículos que todavía no pertenecen a ninguna flotilla, para el buscador. */
export async function searchFreeVehicles(term: string, limit = 15): Promise<Vehicle[]> {
  let query = requireSupabase().from('vehicles').select('*').is('fleet_id', null);
  if (term.trim()) {
    query = query.ilike('plate', `%${term.trim().replace(/[%,()]/g, '').toUpperCase()}%`);
  }
  const { data, error } = await query.order('plate').limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function upsertFleet(input: {
  customerId: string; name: string; fleetId?: string | null;
  code?: string | null; contactName?: string | null; contactPhone?: string | null;
  contactEmail?: string | null; poReference?: string | null; notes?: string | null;
  isActive?: boolean;
}): Promise<Fleet> {
  const { data, error } = await requireSupabase().rpc('upsert_fleet', {
    p_customer_id: input.customerId,
    p_name: input.name,
    p_fleet_id: input.fleetId ?? null,
    p_code: input.code ?? null,
    p_contact_name: input.contactName ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_contact_email: input.contactEmail ?? null,
    p_po_reference: input.poReference ?? null,
    p_notes: input.notes ?? null,
    p_is_active: input.isActive ?? true
  });
  if (error) throw error;
  return data as Fleet;
}

/** `fleetId` a null saca el vehículo de su flotilla. */
export async function assignVehicleToFleet(
  vehicleId: string, fleetId: string | null
): Promise<Vehicle> {
  const { data, error } = await requireSupabase().rpc('assign_vehicle_to_fleet', {
    p_vehicle_id: vehicleId, p_fleet_id: fleetId
  });
  if (error) throw error;
  return data as Vehicle;
}

export async function setFleetRate(input: {
  fleetId: string; serviceId: string; priceCents: number;
  vehicleCategory?: VehicleCategory | null;
}): Promise<FleetRate> {
  const { data, error } = await requireSupabase().rpc('set_fleet_rate', {
    p_fleet_id: input.fleetId,
    p_service_id: input.serviceId,
    p_price_cents: input.priceCents,
    p_vehicle_category: input.vehicleCategory ?? null
  });
  if (error) throw error;
  return data as FleetRate;
}

export async function deleteFleetRate(rateId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('delete_fleet_rate', { p_rate_id: rateId });
  if (error) throw error;
}

export async function fetchFleetStatement(
  fleetId: string, from: string, to: string
): Promise<FleetStatement> {
  const { data, error } = await requireSupabase().rpc('fleet_statement', {
    p_fleet_id: fleetId, p_from: from, p_to: to
  });
  if (error) throw error;
  return data as unknown as FleetStatement;
}

export async function invoiceFleetPeriod(input: {
  fleetId: string; from: string; to: string; clientRequestId: string;
  ncfType?: Enums['ncf_type'] | null;
}): Promise<Invoice> {
  const { data, error } = await requireSupabase().rpc('invoice_fleet_period', {
    p_fleet_id: input.fleetId,
    p_from: input.from,
    p_to: input.to,
    p_client_request_id: input.clientRequestId,
    p_ncf_type: input.ncfType ?? null
  });
  if (error) throw error;
  return data as Invoice;
}
