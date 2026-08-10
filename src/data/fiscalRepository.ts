import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Rangos NCF, notas de crédito y usuarios.
 *
 * Las tres pantallas que quedaban pendientes. Ni los rangos ni los perfiles
 * necesitaron SQL nuevo: sus políticas ya existían desde 0007 —los rangos solo
 * los ve la administración, y hay barreras RESTRICTIVE que impiden ascenderse a
 * uno mismo o fabricar propietarios—. Lo único que faltaba era la pantalla.
 */

export type NcfSequence = Tables<'ncf_sequences'>;
export type Invoice = Tables<'invoices'>;
export type InvoiceItem = Tables<'invoice_items'>;
export type Profile = Tables<'profiles'>;
export type NcfType = Enums['ncf_type'];
export type Role = Enums['user_role'];

// ------------------------------------------------------------------ Fiscal

export async function fetchNcfSequences(): Promise<NcfSequence[]> {
  const { data, error } = await requireSupabase()
    .from('ncf_sequences').select('*')
    .order('ncf_type')
    .order('authorized_until', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveNcfSequence(input: {
  id?: string | null; companyId: string; branchId?: string | null;
  ncfType: NcfType; series?: string;
  rangeStart: number; rangeEnd: number; authorizedUntil: string; isActive?: boolean;
}): Promise<NcfSequence> {
  const supabase = requireSupabase();
  const fila = {
    company_id: input.companyId,
    branch_id: input.branchId ?? null,
    ncf_type: input.ncfType,
    series: input.series ?? 'B',
    range_start: input.rangeStart,
    range_end: input.rangeEnd,
    authorized_until: input.authorizedUntil,
    is_active: input.isActive ?? true
  };

  if (input.id) {
    // next_value NO se toca al editar: es el correlativo ya consumido, y
    // moverlo hacia atrás repetiría NCF ya emitidos.
    const { data, error } = await supabase
      .from('ncf_sequences').update(fila).eq('id', input.id).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('No se pudo guardar: puede que no tenga permiso.');
    }
    return data[0];
  }

  const { data, error } = await supabase
    .from('ncf_sequences')
    .insert({ ...fila, next_value: input.rangeStart })
    .select().single();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------- Notas de crédito

/** Factura con sus líneas, para elegir qué se acredita. */
export interface InvoiceWithItems extends Invoice {
  invoice_items: InvoiceItem[];
}

export async function fetchCreditNotes(limit = 100): Promise<Invoice[]> {
  const { data, error } = await requireSupabase()
    .from('invoices').select('*')
    .not('credits_invoice_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Facturas vigentes que todavía tienen algo por acreditar. */
export async function searchCreditableInvoices(term: string): Promise<InvoiceWithItems[]> {
  let query = requireSupabase()
    .from('invoices').select('*, invoice_items(*)')
    .eq('is_annulled', false)
    .is('credits_invoice_id', null);

  if (term.trim()) {
    const t = term.trim().replace(/[%,()]/g, '');
    query = query.or(`invoice_number.ilike.%${t}%,customer_name.ilike.%${t}%,vehicle_plate.ilike.%${t}%`);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as unknown as InvoiceWithItems[];
}

export async function creditNoteInvoice(input: {
  invoiceId: string;
  lines: { invoice_item_id: string; quantity: number }[];
  reason: string;
  clientRequestId: string;
}): Promise<Invoice> {
  const { data, error } = await requireSupabase().rpc('credit_note_invoice', {
    p_invoice_id: input.invoiceId,
    p_lines: input.lines as never,
    p_reason: input.reason,
    p_client_request_id: input.clientRequestId
  });
  if (error) throw error;
  return data as Invoice;
}

// ------------------------------------------------------- Usuarios y roles

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await requireSupabase()
    .from('profiles').select('*')
    .order('is_active', { ascending: false })
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}

/**
 * Cambia rol o estado. Las barreras RESTRICTIVE de 0007 hacen el trabajo duro:
 * nadie cambia su propio rol, y para otorgar propietario hay que serlo.
 */
export async function updateProfileAccess(
  id: string, patch: { role?: Role; is_active?: boolean }
): Promise<Profile> {
  const { data, error } = await requireSupabase()
    .from('profiles').update(patch).eq('id', id).select();
  if (error) throw error;
  // RLS filtra en silencio: 0 filas significa denegado, no éxito.
  if (!data || data.length === 0) {
    throw new Error('No se pudo actualizar: su rol no alcanza para este cambio.');
  }
  return data[0];
}

export async function resetEmployeePassword(profileId: string, password: string): Promise<void> {
  const { error } = await requireSupabase().rpc('reset_employee_password', {
    p_profile_id: profileId, p_password: password
  });
  if (error) throw error;
}
