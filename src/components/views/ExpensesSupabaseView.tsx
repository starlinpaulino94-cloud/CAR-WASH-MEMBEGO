import React, { useCallback, useEffect, useState } from 'react';
import { DollarSign, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchExpensePage, createExpense, Expense, ExpenseCategory, PaymentMethod
} from '../../data/adminRepository';
import { fetchOpenCashSession, CashSession } from '../../data/billingRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice, FilterChips
} from '../common/DataViewShell';
import { ExportButton } from '../common/ExportButton';
import { expensesExport } from '../../lib/exportSpecs';

const PAGE_SIZE = 25;

type CatFilter = ExpenseCategory | 'all';
const CATEGORY_FILTERS: { id: CatFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'quimicos_insumos', label: 'Químicos e insumos' },
  { id: 'servicios_publicos', label: 'Servicios públicos' },
  { id: 'mantenimiento_equipos', label: 'Mantenimiento' },
  { id: 'nomina_extras', label: 'Nómina extra' },
  { id: 'varios', label: 'Varios' }
];

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'transferencia', label: 'Transferencia' }
];

/**
 * Gastos operativos.
 *
 * Registrar un gasto en efectivo genera su salida de caja en la MISMA
 * transacción (`create_expense`). La versión auditada tocaba ambas cosas por
 * separado y además recortaba el efectivo esperado a cero, falseando el arqueo.
 */
export const ExpensesSupabaseView: React.FC = () => {
  const { company, branch, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'registerExpense');

  const [category, setCategory] = useState<CatFilter>('all');
  const q = usePagedQuery<Expense>({
    fetcher: (page, size, search) => fetchExpensePage(page, size, search, category),
    pageSize: PAGE_SIZE,
    deps: [category]
  });

  const [session, setSession] = useState<CashSession | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [formCategory, setFormCategory] = useState<ExpenseCategory>('quimicos_insumos');
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const loadSession = useCallback(async () => {
    if (!branch) return;
    try { setSession(await fetchOpenCashSession(branch.id)); } catch { /* no bloquea el listado */ }
  }, [branch]);

  useEffect(() => { void loadSession(); }, [loadSession]);

  const submit = async () => {
    if (!branch || busy) return;
    const cents = parseAmountToCents(amount);
    if (!description.trim()) { setFormError('Describa el gasto.'); return; }
    if (cents === null || cents <= 0) { setFormError('Introduzca un importe mayor que cero.'); return; }
    if (method === 'efectivo' && !session) {
      setFormError('Para un gasto en efectivo debe haber una caja abierta.');
      return;
    }

    setBusy(true); setFormError(null);
    try {
      await createExpense({
        branchId: branch.id, clientRequestId: requestId,
        description: description.trim(), amountCents: cents,
        category: formCategory, paymentMethod: method,
        supplierName: supplier.trim() || null,
        cashSessionId: method === 'efectivo' ? session?.id ?? null : null
      });
      setNotice(`Gasto registrado: ${description.trim()} (${formatCents(cents, symbol)}).`);
      setDescription(''); setAmount(''); setSupplier('');
      setRequestId(crypto.randomUUID());   // operación cerrada, clave nueva
      q.reload();
      void loadSession();
    } catch (err) {
      // La clave NO se renueva: reintentar no debe duplicar el gasto.
      setFormError(err instanceof Error ? err.message : 'No se pudo registrar el gasto');
    } finally {
      setBusy(false);
    }
  };

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar los gastos" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<DollarSign className="w-5 h-5 text-indigo-400" />}
        title="Gastos operativos"
        subtitle={session
          ? `Caja abierta · ${formatCents(session.expected_cash_cents, symbol)} en gaveta`
          : 'Sin caja abierta: solo se admiten gastos que no salgan de efectivo'}
        actions={<ExportButton {...expensesExport()} />}
      />

      {!allowed && <ReadOnlyNotice>Su rol permite consultar los gastos, pero no registrarlos.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchBox id="exp-search" label="Buscar gasto" value={q.searchInput}
              onChange={q.setSearchInput} placeholder="Buscar por concepto, proveedor o referencia…" />
          </div>
          <FilterChips options={CATEGORY_FILTERS} value={category} onChange={setCategory} />

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Gastos registrados</caption>
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                    <th scope="col" className="p-3 font-semibold">FECHA</th>
                    <th scope="col" className="p-3 font-semibold">CONCEPTO</th>
                    <th scope="col" className="p-3 font-semibold">CATEGORÍA</th>
                    <th scope="col" className="p-3 font-semibold">PAGO</th>
                    <th scope="col" className="p-3 font-semibold text-right">IMPORTE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {q.loading ? <SkeletonRows cols={5} />
                    : q.rows.length === 0 ? (
                      <EmptyRow cols={5}>
                        {q.searchInput || category !== 'all'
                          ? 'Ningún gasto coincide con el filtro.'
                          : 'Todavía no hay gastos registrados.'}
                      </EmptyRow>
                    ) : q.rows.map(e => (
                      <tr key={e.id} className="hover:bg-slate-800/40">
                        <td className="p-3 text-slate-400 whitespace-nowrap">
                          {new Date(e.expense_date).toLocaleDateString('es-DO')}
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-white">{e.description}</div>
                          {e.supplier_name && <div className="text-xs text-slate-500">{e.supplier_name}</div>}
                        </td>
                        <td className="p-3 text-slate-400">
                          {CATEGORY_FILTERS.find(c => c.id === e.category)?.label ?? e.category}
                        </td>
                        <td className="p-3 text-slate-300 uppercase text-xs">{e.payment_method}</td>
                        <td className="p-3 font-extrabold text-rose-400 text-right whitespace-nowrap">
                          −{formatCents(e.amount_cents, symbol)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
              pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 h-fit">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Registrar gasto</h3>
          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="e-desc" className="text-slate-400">Concepto *</label>
              <input id="e-desc" type="text" value={description} disabled={busy || !allowed}
                onChange={ev => setDescription(ev.target.value)}
                placeholder="Ej: compra de toallas de microfibra"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1 placeholder-slate-600 disabled:opacity-50" />
            </div>
            <div>
              <label htmlFor="e-amount" className="text-slate-400">Importe ({symbol}) *</label>
              <input id="e-amount" type="text" inputMode="decimal" value={amount} disabled={busy || !allowed}
                onChange={ev => setAmount(ev.target.value)} placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1 font-bold placeholder-slate-600 disabled:opacity-50" />
            </div>
            <div>
              <label htmlFor="e-cat" className="text-slate-400">Categoría</label>
              <select id="e-cat" value={formCategory} disabled={busy || !allowed}
                onChange={ev => setFormCategory(ev.target.value as ExpenseCategory)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1 disabled:opacity-50">
                {CATEGORY_FILTERS.filter(c => c.id !== 'all').map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-slate-400">Forma de pago</span>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                {METHODS.map(m => {
                  const blocked = m.id === 'efectivo' && !session;
                  return (
                    <button key={m.id} onClick={() => setMethod(m.id)} disabled={busy || !allowed || blocked}
                      aria-pressed={method === m.id}
                      title={blocked ? 'Requiere caja abierta' : undefined}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition-all disabled:opacity-30 ${
                        method === m.id
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label htmlFor="e-sup" className="text-slate-400">Proveedor</label>
              <input id="e-sup" type="text" value={supplier} disabled={busy || !allowed}
                onChange={ev => setSupplier(ev.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1 disabled:opacity-50" />
            </div>

            {formError && <InlineAlert tone="error">{formError}</InlineAlert>}

            <button onClick={() => void submit()} disabled={busy || !allowed}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Registrar gasto
            </button>

            <p className="text-xs text-slate-500">
              Un gasto en efectivo descuenta la gaveta en la misma operación: o se registran
              las dos cosas o ninguna.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
