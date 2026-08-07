import { requireSupabase } from '../lib/supabase';
import { Tables, Enums, Json } from '../lib/database.types';

/**
 * Control de calidad.
 *
 * La etapa `control_calidad` del Kanban deja de ser una columna donde se
 * arrastra una tarjeta: cada revisión guarda qué se revisó, quién lavó, quién
 * revisó y por qué se rechazó. El rechazo devuelve la orden a proceso.
 */

export type QcChecklistItem = Tables<'qc_checklist_items'>;
export type QcReview = Tables<'qc_reviews'>;
export type QcResult = Enums['qc_result'];

export interface QcResultInput {
  itemId?: string | null;
  label: string;
  passed: boolean;
  note?: string | null;
}

/** Puntos del checklist: los generales y los del servicio indicado. */
export async function fetchChecklist(serviceId?: string | null): Promise<QcChecklistItem[]> {
  let query = requireSupabase()
    .from('qc_checklist_items')
    .select('*')
    .eq('is_active', true);
  query = serviceId
    ? query.or(`service_id.is.null,service_id.eq.${serviceId}`)
    : query.is('service_id', null);
  const { data, error } = await query.order('sort_order').order('label');
  if (error) throw error;
  return data ?? [];
}

export async function createChecklistItem(input: {
  companyId: string; label: string; serviceId?: string | null; sortOrder?: number;
}): Promise<QcChecklistItem> {
  const { data, error } = await requireSupabase().from('qc_checklist_items').insert({
    company_id: input.companyId,
    label: input.label.trim(),
    service_id: input.serviceId ?? null,
    sort_order: input.sortOrder ?? 0
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteChecklistItem(id: string): Promise<void> {
  const { error } = await requireSupabase().from('qc_checklist_items').delete().eq('id', id);
  if (error) throw error;
}

/** Revisiones anteriores de una orden (para ver los reprocesos). */
export async function fetchOrderReviews(orderId: string): Promise<QcReview[]> {
  const { data, error } = await requireSupabase()
    .from('qc_reviews').select('*')
    .eq('work_order_id', orderId)
    .order('attempt', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Registra la revisión y mueve la orden: aprobada → listo,
 * rechazada → en proceso (reproceso). Todo en una operación del servidor.
 */
export async function submitQcReview(input: {
  orderId: string;
  result: QcResult;
  results: QcResultInput[];
  rejectReason?: string | null;
  washerId?: string | null;
  notes?: string | null;
}): Promise<QcReview> {
  const { data, error } = await requireSupabase().rpc('submit_qc_review', {
    p_order_id: input.orderId,
    p_result: input.result,
    p_results: input.results as unknown as Json,
    p_reject_reason: input.rejectReason ?? null,
    p_washer_id: input.washerId ?? null,
    p_notes: input.notes ?? null
  });
  if (error) throw error;
  return data as QcReview;
}
