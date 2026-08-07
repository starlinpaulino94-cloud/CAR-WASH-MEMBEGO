import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';
import { PagedResult } from '../hooks/usePagedQuery';

/**
 * Reclamos e incidentes.
 *
 * Registrar el reclamo permite cerrar con evidencia (la inspección firmada),
 * medir lo que costó y encontrar la causa raíz. La bitácora del reclamo es de
 * solo inserción: la historia se continúa, no se corrige.
 */

export type Claim = Tables<'claims'>;
export type ClaimEvent = Tables<'claim_events'>;
export type ClaimKind = Enums['claim_kind'];
export type ClaimStatus = Enums['claim_status'];

export async function fetchClaimPage(
  page: number, pageSize: number, search: string, onlyOpen: boolean
): Promise<PagedResult<Claim>> {
  let query = requireSupabase().from('claims').select('*', { count: 'exact' });
  if (onlyOpen) query = query.in('status', ['abierto', 'en_revision']);
  if (search.trim()) {
    const t = search.trim().replace(/[%,()]/g, '');
    query = query.or(`customer_name.ilike.%${t}%,description.ilike.%${t}%`);
  }
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function fetchClaimEvents(claimId: string): Promise<ClaimEvent[]> {
  const { data, error } = await requireSupabase()
    .from('claim_events').select('*')
    .eq('claim_id', claimId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function openClaim(input: {
  customerName: string; kind: ClaimKind; description: string;
  workOrderId?: string | null; customerPhone?: string | null;
}): Promise<Claim> {
  const { data, error } = await requireSupabase().rpc('open_claim', {
    p_customer_name: input.customerName,
    p_kind: input.kind,
    p_description: input.description,
    p_work_order_id: input.workOrderId ?? null,
    p_customer_phone: input.customerPhone ?? null
  });
  if (error) throw error;
  return data as Claim;
}

export async function addClaimNote(
  claimId: string, note: string, status?: ClaimStatus
): Promise<Claim> {
  const { data, error } = await requireSupabase().rpc('add_claim_note', {
    p_claim_id: claimId, p_note: note, p_status: status ?? null
  });
  if (error) throw error;
  return data as Claim;
}

export async function resolveClaim(input: {
  claimId: string; status: 'resuelto' | 'rechazado'; resolution: string;
  costCents?: number; rootCause?: string | null; responsibleId?: string | null;
}): Promise<Claim> {
  const { data, error } = await requireSupabase().rpc('resolve_claim', {
    p_claim_id: input.claimId,
    p_status: input.status,
    p_resolution: input.resolution,
    p_cost_cents: input.costCents ?? 0,
    p_root_cause: input.rootCause ?? null,
    p_responsible_id: input.responsibleId ?? null
  });
  if (error) throw error;
  return data as Claim;
}
