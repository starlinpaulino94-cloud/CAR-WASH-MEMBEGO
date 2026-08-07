import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Inspección de recepción y entrega del vehículo.
 *
 * La evidencia que protege al car wash de un reclamo por un daño anterior.
 * Una vez firmada, la base la congela: aquí no hay función de edición porque
 * el servidor la rechazaría.
 */

export type Inspection = Tables<'vehicle_inspections'>;
export type InspectionDamage = Tables<'inspection_damages'>;
export type InspectionStage = Enums['inspection_stage'];
export type DamageKind = Enums['damage_kind'];
export type DamageSeverity = Enums['damage_severity'];
export type FuelLevel = Enums['fuel_level'];

export interface InspectionWithDamages extends Inspection {
  damages: InspectionDamage[];
}

/** Inspecciones de una orden (recepción y entrega), con sus daños. */
export async function fetchOrderInspections(orderId: string): Promise<InspectionWithDamages[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('vehicle_inspections')
    .select('*, inspection_damages(*)')
    .eq('work_order_id', orderId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(row => {
    const { inspection_damages, ...insp } = row as Inspection & { inspection_damages: InspectionDamage[] };
    return { ...insp, damages: inspection_damages ?? [] };
  });
}

export async function createInspection(input: {
  companyId: string;
  branchId: string | null;
  workOrderId: string;
  stage: InspectionStage;
  fuelLevel: FuelLevel | null;
  mileage: number | null;
  valuables: string | null;
  notes: string | null;
}): Promise<Inspection> {
  const { data, error } = await requireSupabase().from('vehicle_inspections').insert({
    company_id: input.companyId,
    branch_id: input.branchId,
    work_order_id: input.workOrderId,
    stage: input.stage,
    fuel_level: input.fuelLevel,
    mileage: input.mileage,
    valuables: input.valuables,
    notes: input.notes
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateInspection(id: string, patch: {
  fuel_level?: FuelLevel | null; mileage?: number | null;
  valuables?: string | null; notes?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase()
    .from('vehicle_inspections').update(patch).eq('id', id);
  if (error) throw error;
}

export async function addDamage(input: {
  companyId: string; inspectionId: string; zone: string;
  kind: DamageKind; severity: DamageSeverity; note: string | null;
  posX: number | null; posY: number | null;
}): Promise<InspectionDamage> {
  const { data, error } = await requireSupabase().from('inspection_damages').insert({
    company_id: input.companyId,
    inspection_id: input.inspectionId,
    zone: input.zone,
    kind: input.kind,
    severity: input.severity,
    note: input.note,
    pos_x: input.posX,
    pos_y: input.posY
  }).select().single();
  if (error) throw error;
  return data;
}

export async function removeDamage(id: string): Promise<void> {
  const { error } = await requireSupabase().from('inspection_damages').delete().eq('id', id);
  if (error) throw error;
}

/** Cierra la evidencia. Después de esto la inspección es inmutable. */
export async function signInspection(
  inspectionId: string, signature: string, signedBy: string
): Promise<Inspection> {
  const { data, error } = await requireSupabase().rpc('sign_inspection', {
    p_inspection_id: inspectionId, p_signature: signature, p_signed_by: signedBy
  });
  if (error) throw error;
  return data as Inspection;
}
