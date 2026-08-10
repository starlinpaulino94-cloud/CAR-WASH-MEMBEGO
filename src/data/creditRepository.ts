import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';
import { PagedResult } from '../hooks/usePagedQuery';

/**
 * Crédito de clientes y cuentas por cobrar.
 *
 * Fiar deja saldo, no ingreso: la parte a crédito de una venta abre una cuenta
 * por cobrar y NO entra a la caja. Aquí solo se lee y se llaman los RPC; toda
 * la regla (cupo, mora, vencimiento) vive en la base.
 */

export type Receivable = Tables<'receivables'>;
export type ReceivablePayment = Tables<'receivable_payments'>;
export type Customer = Tables<'customers'>;
export type PaymentMethod = Enums['payment_method'];

/** Lo que devuelve customer_credit_status(). */
export interface CreditStatus {
  customer_id: string;
  credit_enabled: boolean;
  limit_cents: number;
  terms_days: number;
  balance_cents: number;
  overdue_cents: number;
  oldest_due: string | null;
  available_cents: number;
  blocked: boolean;
}

/** Un tramo de la vejez de saldos. */
export interface AgingBucket {
  corriente: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_mas: number;
  total: number;
}

export interface Aging {
  as_of: string;
  totals: AgingBucket & { vencido: number };
  by_customer: (AgingBucket & { customer_id: string; customer_name: string })[];
}

/** Cuenta por cobrar con el nombre del cliente y el número de factura ya resueltos. */
export interface ReceivableRow extends Receivable {
  customer_name: string;
  invoice_number: string;
}

interface JoinedRow extends Receivable {
  customers: { name: string } | null;
  invoices: { invoice_number: string } | null;
}

const flatten = (r: JoinedRow): ReceivableRow => ({
  ...r,
  customer_name: r.customers?.name ?? '—',
  invoice_number: r.invoices?.invoice_number ?? '—'
});

export async function fetchReceivablePage(
  page: number, pageSize: number, search: string, onlyOpen: boolean
): Promise<PagedResult<ReceivableRow>> {
  let query = requireSupabase()
    .from('receivables')
    .select('*, customers(name), invoices(invoice_number)', { count: 'exact' });

  if (onlyOpen) query = query.eq('status', 'pendiente');
  if (search.trim()) {
    const t = search.trim().replace(/[%,()]/g, '');
    query = query.ilike('customers.name', `%${t}%`);
  }

  // Lo más vencido primero: es el orden en que hay que llamar por teléfono.
  const { data, error, count } = await query
    .order('due_on', { ascending: true })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []).map(r => flatten(r as unknown as JoinedRow)), total: count ?? 0 };
}

export async function fetchReceivablePayments(receivableId: string): Promise<ReceivablePayment[]> {
  const { data, error } = await requireSupabase()
    .from('receivable_payments').select('*')
    .eq('receivable_id', receivableId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

/** Clientes con crédito autorizado, para la pestaña de cupos. */
export async function fetchCreditCustomers(): Promise<Customer[]> {
  const { data, error } = await requireSupabase()
    .from('customers').select('*')
    .eq('credit_enabled', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchCreditStatus(customerId: string): Promise<CreditStatus> {
  const { data, error } = await requireSupabase()
    .rpc('customer_credit_status', { p_customer_id: customerId });
  if (error) throw error;
  return data as unknown as CreditStatus;
}

export async function fetchAging(asOf?: string): Promise<Aging> {
  const { data, error } = await requireSupabase()
    .rpc('receivables_aging', asOf ? { p_as_of: asOf } : {});
  if (error) throw error;
  return data as unknown as Aging;
}

export async function setCustomerCredit(input: {
  customerId: string; enabled: boolean; limitCents?: number; termsDays?: number;
}): Promise<Customer> {
  const { data, error } = await requireSupabase().rpc('set_customer_credit', {
    p_customer_id: input.customerId,
    p_enabled: input.enabled,
    p_limit_cents: input.limitCents ?? 0,
    p_terms_days: input.termsDays ?? 0
  });
  if (error) throw error;
  return data as Customer;
}

export async function collectReceivable(input: {
  receivableId: string; amountCents: number; method?: PaymentMethod;
  reference?: string | null; cashSessionId?: string | null;
}): Promise<Receivable> {
  const { data, error } = await requireSupabase().rpc('collect_receivable', {
    p_receivable_id: input.receivableId,
    p_amount_cents: input.amountCents,
    p_payment_method: input.method ?? 'efectivo',
    p_reference: input.reference ?? null,
    p_cash_session_id: input.cashSessionId ?? null
  });
  if (error) throw error;
  return data as Receivable;
}
