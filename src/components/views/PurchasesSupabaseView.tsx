import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Plus, Trash2, HandCoins } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchPurchasePage, fetchActiveSuppliers, registerPurchase, paySupplier,
  fetchProductPage, Purchase, Supplier, Product, PaymentMethod, PurchaseItemInput
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice, FilterChips
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const PAGE_SIZE = 25;

type Filter = 'all' | 'pending';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'pending', label: 'Por pagar' }
];

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'tarjeta', label: 'Tarjeta' }
];

interface DraftItem { productId: string; qty: string; cost: string }

/**
 * Compras a proveedores.
 *
 * Registrar una compra ENTRA el inventario (queda en el kardex como «compra»)
 * y actualiza el último costo. Al contado nace saldada; a crédito abre una
 * cuenta por pagar con vencimiento, que se liquida con abonos.
 */
export const PurchasesSupabaseView: React.FC = () => {
  const { profile, phase, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canManage = ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const [filter, setFilter] = useState<Filter>('all');
  const q = usePagedQuery<Purchase>({
    fetcher: (page, size, search) => fetchPurchasePage(page, size, search, filter),
    pageSize: PAGE_SIZE,
    deps: [filter],
    enabled: phase === 'ready'
  });

  // --- Nueva compra
  const [showCreate, setShowCreate] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [isCredit, setIsCredit] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transferencia');
  const [items, setItems] = useState<DraftItem[]>([{ productId: '', qty: '1', cost: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!showCreate || phase !== 'ready') return;
    fetchActiveSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
    // Catálogo acotado para el selector (los primeros 200 por nombre).
    fetchProductPage(0, 200, '', false).then(r => setProducts(r.rows)).catch(() => setProducts([]));
  }, [showCreate, phase]);

  const openCreate = () => {
    setSupplierId(''); setInvoiceRef(''); setIsCredit(false); setDueDate('');
    setMethod('transferencia'); setItems([{ productId: '', qty: '1', cost: '' }]);
    setError(null); setShowCreate(true);
  };

  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setItems(list => list.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const totalDraft = items.reduce((sum, it) => {
    const qty = Number(it.qty); const cost = parseAmountToCents(it.cost) ?? 0;
    return sum + (Number.isInteger(qty) && qty > 0 ? qty * cost : 0);
  }, 0);

  const submitCreate = async () => {
    if (busy) return;
    if (!supplierId) { setError('Elija el proveedor.'); return; }
    const parsed: PurchaseItemInput[] = [];
    for (const it of items) {
      if (!it.productId) continue;
      const qty = Number(it.qty);
      const cost = parseAmountToCents(it.cost);
      if (!Number.isInteger(qty) || qty <= 0) { setError('Cada renglón necesita cantidad entera mayor que cero.'); return; }
      if (cost === null || cost < 0) { setError('Cada renglón necesita un costo válido.'); return; }
      parsed.push({ productId: it.productId, quantity: qty, unitCostCents: cost });
    }
    if (parsed.length === 0) { setError('La compra necesita al menos un renglón con producto.'); return; }
    if (isCredit && !dueDate) { setError('Una compra a crédito necesita fecha de vencimiento.'); return; }

    setBusy(true); setError(null);
    try {
      await registerPurchase({
        supplierId, items: parsed, isCredit,
        dueDate: isCredit ? dueDate : null,
        paymentMethod: isCredit ? 'credito' : method,
        invoiceRef: invoiceRef.trim() || undefined
      });
      setShowCreate(false);
      setNotice('Compra registrada: el inventario entró y quedó en el kardex.');
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la compra');
    } finally {
      setBusy(false);
    }
  };

  // --- Abono
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('transferencia');
  const [payRef, setPayRef] = useState('');

  const submitPay = async () => {
    if (!paying || busy) return;
    const cents = parseAmountToCents(payAmount);
    if (cents === null || cents <= 0) { setError('Indique el monto del abono.'); return; }
    setBusy(true); setError(null);
    try {
      await paySupplier({
        purchaseId: paying.id, amountCents: cents,
        paymentMethod: payMethod, reference: payRef.trim() || undefined
      });
      setPaying(null);
      setNotice('Abono registrado.');
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el abono');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Compras" subtitle="Compras a proveedores y cuentas por pagar" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar las compras" />;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Compras"
        subtitle="Cada compra entra el inventario; el crédito queda como cuenta por pagar"
        actions={canManage ? (
          <Button size="sm" onClick={openCreate}
            >
            <Plus className="w-4 h-4" /> Nueva compra
          </Button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar las compras, no registrarlas.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showCreate && !paying && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBox id="pur-search" label="Buscar por proveedor" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por proveedor…" />
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <caption className="sr-only">Compras a proveedores</caption>
            <TableHeader>
              <TableRow className="border-b border-line text-muted bg-canvas/50">
                <TableHead scope="col" className="p-3 font-semibold">FECHA</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">PROVEEDOR</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">TOTAL</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">SALDO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">VENCE</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">ESTADO</TableHead>
                {canManage && <TableHead scope="col" className="p-3 font-semibold text-right">ACCIONES</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.loading ? <SkeletonRows cols={canManage ? 7 : 6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={canManage ? 7 : 6}>
                    {q.searchInput || filter === 'pending'
                      ? 'Ninguna compra coincide con el filtro.'
                      : 'Todavía no hay compras registradas.'}
                  </EmptyRow>
                ) : q.rows.map(p => {
                  const saldo = p.total_cents - p.paid_cents;
                  const overdue = saldo > 0 && p.due_date !== null && p.due_date < today;
                  return (
                    <TableRow key={p.id} className="hover:bg-surface-2/40">
                      <TableCell className="p-3 text-muted whitespace-nowrap">
                        {new Date(p.purchase_date + 'T00:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}
                      </TableCell>
                      <TableCell className="p-3">
                        <div className="font-bold text-strong">{p.suppliers?.name ?? '—'}</div>
                        {p.invoice_ref && <div className="text-xs text-faint">{p.invoice_ref}</div>}
                      </TableCell>
                      <TableCell className="p-3 text-right font-bold text-strong whitespace-nowrap">
                        {formatCents(p.total_cents, symbol)}
                      </TableCell>
                      <TableCell className={`p-3 text-right font-extrabold whitespace-nowrap ${
                        saldo > 0 ? 'text-warning' : 'text-success'
                      }`}>
                        {formatCents(saldo, symbol)}
                      </TableCell>
                      <TableCell className="p-3 text-muted whitespace-nowrap">
                        {p.due_date
                          ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })
                          : '—'}
                      </TableCell>
                      <TableCell className="p-3">
                        {saldo === 0 ? (
                          <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">Pagada</span>
                        ) : overdue ? (
                          <span className="bg-danger/20 text-danger font-bold px-2 py-0.5 rounded text-xs">Vencida</span>
                        ) : (
                          <span className="bg-warning/20 text-warning font-bold px-2 py-0.5 rounded text-xs">Por pagar</span>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="p-3 text-right">
                          {saldo > 0 && (
                            <button
                              onClick={() => { setPaying(p); setPayAmount(''); setPayRef(''); setError(null); }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body">
                              <HandCoins className="w-3.5 h-3.5" /> Abonar
                            </button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {showCreate && (
        <FormModal
          title="Nueva compra"
          submitLabel={`Registrar compra · ${formatCents(totalDraft, symbol)}`}
          busy={busy}
          error={error}
          onSubmit={() => void submitCreate()}
          onClose={() => setShowCreate(false)}
          onDismissError={() => setError(null)}
          wide
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Proveedor *" htmlFor="pur-sup">
              <select id="pur-sup" className={textInputClass} value={supplierId}
                onChange={e => setSupplierId(e.target.value)}>
                <option value="">— Elegir —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Nº factura del proveedor" htmlFor="pur-ref">
              <input id="pur-ref" className={textInputClass} value={invoiceRef}
                onChange={e => setInvoiceRef(e.target.value)} placeholder="FT-0001" />
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-semibold text-muted uppercase">Renglones</span>
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select aria-label={`Producto del renglón ${i + 1}`} className={`${textInputClass} flex-1`}
                  value={it.productId} onChange={e => setItem(i, { productId: e.target.value })}>
                  <option value="">— Producto —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                </select>
                <input aria-label={`Cantidad del renglón ${i + 1}`} type="number" min={1}
                  className={`${textInputClass} w-20`} value={it.qty}
                  onChange={e => setItem(i, { qty: e.target.value })} />
                <input aria-label={`Costo unitario del renglón ${i + 1}`} type="text" inputMode="decimal"
                  className={`${textInputClass} w-28`} value={it.cost} placeholder="Costo"
                  onChange={e => setItem(i, { cost: e.target.value })} />
                <button type="button" aria-label={`Quitar renglón ${i + 1}`}
                  onClick={() => setItems(list => list.length > 1 ? list.filter((_, idx) => idx !== i) : list)}
                  className="p-2 text-faint hover:text-danger">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button type="button"
              onClick={() => setItems(list => [...list, { productId: '', qty: '1', cost: '' }])}
              className="text-xs font-bold text-brand hover:text-brand-hi">
              + Añadir renglón
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm text-body cursor-pointer">
              <input type="checkbox" checked={isCredit} className="accent-brand"
                onChange={e => setIsCredit(e.target.checked)} />
              A crédito (cuenta por pagar)
            </label>
            {isCredit ? (
              <Field label="Vence *" htmlFor="pur-due">
                <input id="pur-due" type="date" className={textInputClass} value={dueDate}
                  onChange={e => setDueDate(e.target.value)} min={today} />
              </Field>
            ) : (
              <Field label="Método de pago" htmlFor="pur-method">
                <select id="pur-method" className={textInputClass} value={method}
                  onChange={e => setMethod(e.target.value as PaymentMethod)}>
                  {METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
            )}
          </div>
        </FormModal>
      )}

      {paying && (
        <FormModal
          title={`Abonar — ${paying.suppliers?.name ?? 'compra'}`}
          submitLabel="Registrar abono"
          busy={busy}
          error={error}
          onSubmit={() => void submitPay()}
          onClose={() => setPaying(null)}
          onDismissError={() => setError(null)}
        >
          <p className="text-sm text-muted">
            Saldo pendiente:{' '}
            <strong className="text-warning tabular-nums">
              {formatCents(paying.total_cents - paying.paid_cents, symbol)}
            </strong>
            {paying.due_date && <> · vence el {new Date(paying.due_date + 'T00:00:00').toLocaleDateString('es-DO')}</>}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Monto del abono (${symbol}) *`} htmlFor="pay-amount">
              <input id="pay-amount" type="text" inputMode="decimal" autoFocus
                className={textInputClass} value={payAmount}
                onChange={e => setPayAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Método" htmlFor="pay-method">
              <select id="pay-method" className={textInputClass} value={payMethod}
                onChange={e => setPayMethod(e.target.value as PaymentMethod)}>
                {METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Referencia" htmlFor="pay-ref">
            <input id="pay-ref" className={textInputClass} value={payRef}
              onChange={e => setPayRef(e.target.value)} placeholder="Nº transferencia, cheque…" />
          </Field>
        </FormModal>
      )}
    </div>
  );
};
