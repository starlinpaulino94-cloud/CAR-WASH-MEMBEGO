import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { HandCoins, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents, centsToInput } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchOpenCashSession } from '../../data/billingRepository';
import { fetchCustomerPage } from '../../data/adminRepository';
import {
  fetchReceivablePage, fetchCreditCustomers, fetchAging,
  setCustomerCredit, collectReceivable,
  ReceivableRow, Customer, Aging, PaymentMethod
} from '../../data/creditRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow, InlineAlert, ReadOnlyNotice, FilterChips, StatCard, HelpNote
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { ExportButton } from '../common/ExportButton';
import { receivablesExport } from '../../lib/exportSpecs';

const PAGE_SIZE = 25;

type Filter = 'pending' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Con saldo' },
  { id: 'all', label: 'Todas' }
];

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'pago_movil', label: 'Pago móvil' }
];

/** Días de atraso (negativo = aún no vence). */
const daysLate = (dueOn: string): number => {
  const due = new Date(`${dueOn}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
};

/**
 * Cuentas por cobrar.
 *
 * Lo que se fía no es un ingreso: es una promesa. Esta pantalla enseña las
 * promesas pendientes ordenadas por lo más vencido, permite cobrar abonos
 * —que sí entran a la caja— y administra a quién se le fía y hasta cuánto.
 *
 * El cupo y la mora los decide la base: aquí solo se muestran y se piden.
 */
export const ReceivablesSupabaseView: React.FC = () => {
  const { profile, phase, company, branch } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canCollect = ['propietario', 'administrador', 'supervisor', 'cajero', 'contador', 'superadmin']
    .includes(profile?.role ?? '');
  const canAuthorize = ['propietario', 'administrador', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const [filter, setFilter] = useState<Filter>('pending');
  const q = usePagedQuery<ReceivableRow>({
    fetcher: (page, size, search) => fetchReceivablePage(page, size, search, filter === 'pending'),
    pageSize: PAGE_SIZE,
    deps: [filter],
    enabled: phase === 'ready'
  });

  const [aging, setAging] = useState<Aging | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Un cobro cambia a la vez el listado, la vejez de saldos y los cupos: este
  // contador los vuelve a pedir todos con una sola llamada.
  const [refresh, setRefresh] = useState(0);
  const reloadAll = () => { setRefresh(n => n + 1); q.reload(); };

  // La vejez de saldos es un reporte gerencial: al cajero se le niega y no es
  // un fallo, así que se ignora en silencio.
  useEffect(() => {
    if (phase !== 'ready' || !canAuthorize) return;
    fetchAging().then(setAging).catch(() => setAging(null));
  }, [phase, canAuthorize, refresh]);

  // --- Cobrar un abono
  const [paying, setPaying] = useState<ReceivableRow | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [reference, setReference] = useState('');

  const openPay = (r: ReceivableRow) => {
    setPaying(r);
    setAmount(centsToInput(r.total_cents - r.paid_cents));
    setMethod('efectivo'); setReference(''); setError(null);
  };

  const submitPay = async () => {
    if (!paying || busy) return;
    const cents = parseAmountToCents(amount);
    if (cents === null || cents <= 0) { setError('Indique un importe válido mayor que cero.'); return; }

    setBusy(true); setError(null);
    try {
      // El efectivo exige caja abierta: si no la hay, la base lo rechaza, pero
      // avisar aquí ahorra un viaje y da un mensaje entendible.
      let sessionId: string | null = null;
      if (method === 'efectivo') {
        if (!branch) { setError('No hay sucursal activa para registrar el efectivo.'); return; }
        const session = await fetchOpenCashSession(branch.id);
        if (!session) { setError('Abra la caja antes de cobrar en efectivo.'); return; }
        sessionId = session.id;
      }

      const result = await collectReceivable({
        receivableId: paying.id, amountCents: cents, method,
        reference: reference.trim() || null, cashSessionId: sessionId
      });
      setPaying(null);
      setNotice(result.status === 'pagada'
        ? `Cuenta de ${paying.customer_name} saldada por completo.`
        : `Abono registrado. Saldo: ${formatCents(result.total_cents - result.paid_cents, symbol)}.`);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el cobro');
    } finally {
      setBusy(false);
    }
  };

  // --- Autorizar crédito
  const [showCredit, setShowCredit] = useState(false);
  const [creditCustomers, setCreditCustomers] = useState<Customer[]>([]);
  const [creditTarget, setCreditTarget] = useState<Customer | null>(null);
  const [limitInput, setLimitInput] = useState('');
  const [termsInput, setTermsInput] = useState('15');
  // Buscador para autorizar a un cliente que todavía no opera a crédito.
  const [pickTerm, setPickTerm] = useState('');
  const [picks, setPicks] = useState<Customer[]>([]);

  useEffect(() => {
    if (phase !== 'ready' || !canAuthorize) return;
    fetchCreditCustomers().then(setCreditCustomers).catch(() => setCreditCustomers([]));
  }, [phase, canAuthorize, refresh]);

  useEffect(() => {
    if (!showCredit || creditTarget) return;
    const id = window.setTimeout(() => {
      fetchCustomerPage(0, 15, pickTerm).then(r => setPicks(r.rows)).catch(() => setPicks([]));
    }, 350);
    return () => window.clearTimeout(id);
  }, [showCredit, creditTarget, pickTerm]);

  const openCredit = (c: Customer) => {
    setCreditTarget(c);
    setLimitInput(c.credit_limit_cents > 0 ? centsToInput(c.credit_limit_cents) : '');
    setTermsInput(String(c.credit_terms_days || 15));
    setError(null); setShowCredit(true);
  };

  const openCreditPicker = () => {
    setCreditTarget(null); setPickTerm(''); setPicks([]);
    setError(null); setShowCredit(true);
  };

  const submitCredit = async (enabled: boolean) => {
    if (!creditTarget || busy) return;
    const cents = parseAmountToCents(limitInput);
    const days = Number(termsInput);
    if (enabled && (cents === null || cents <= 0)) { setError('Indique el cupo autorizado.'); return; }
    if (enabled && (!Number.isInteger(days) || days < 0 || days > 365)) {
      setError('El plazo debe ser un número entero de 0 a 365 días.'); return;
    }

    setBusy(true); setError(null);
    try {
      await setCustomerCredit({
        customerId: creditTarget.id, enabled,
        limitCents: cents ?? 0, termsDays: days
      });
      setShowCredit(false);
      setNotice(enabled
        ? `${creditTarget.name}: cupo de ${formatCents(cents ?? 0, symbol)} a ${days} días.`
        : `${creditTarget.name} ya no opera a crédito.`);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el crédito');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Por cobrar" subtitle="Crédito de clientes y cuentas pendientes" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) {
    return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar las cuentas por cobrar" />;
  }

  const cols = canCollect ? 6 : 5;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Por cobrar"
        subtitle="Lo fiado no es ingreso hasta que se cobra"
        actions={<ExportButton {...receivablesExport()} />}
      />

      {!canCollect && <ReadOnlyNotice>Su rol permite consultar las cuentas, no cobrarlas.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !paying && !showCredit && (
        <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>
      )}

      {aging && (
        <section aria-label="Vejez de saldos" className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Corriente" value={formatCents(aging.totals.corriente, symbol)}
            hint="Aún no vence" />
          <StatCard label="1 a 30 días" value={formatCents(aging.totals.d1_30, symbol)}
            tone="text-warning" hint="Vencido" />
          <StatCard label="31 a 60 días" value={formatCents(aging.totals.d31_60, symbol)}
            tone="text-warning" hint="Vencido" />
          <StatCard label="61 a 90 días" value={formatCents(aging.totals.d61_90, symbol)}
            tone="text-danger" hint="Vencido" />
          <StatCard label="Más de 90 días" value={formatCents(aging.totals.d90_mas, symbol)}
            tone="text-danger" hint="Cobro dudoso" />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <SearchBox id="rec-search" label="Buscar cuenta" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por cliente…" />

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Cuentas por cobrar</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">CLIENTE</th>
                <th scope="col" className="p-3 font-semibold">FACTURA</th>
                <th scope="col" className="p-3 font-semibold">VENCE</th>
                <th scope="col" className="p-3 font-semibold text-right">SALDO</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canCollect && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {q.loading ? <SkeletonRows cols={cols} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={cols}>
                    {q.searchInput ? 'Ninguna cuenta coincide.' : 'No hay cuentas por cobrar.'}
                  </EmptyRow>
                ) : q.rows.map(r => {
                  const balance = r.total_cents - r.paid_cents;
                  const late = daysLate(r.due_on);
                  const overdue = r.status === 'pendiente' && late > 0;
                  return (
                    <tr key={r.id} className="hover:bg-surface-2/40">
                      <td className="p-3 font-bold text-strong">{r.customer_name}</td>
                      <td className="p-3 text-muted">{r.invoice_number}</td>
                      <td className="p-3">
                        <div className={overdue ? 'text-danger font-bold' : 'text-muted'}>{r.due_on}</div>
                        {r.status === 'pendiente' && (
                          <div className="text-xs text-faint">
                            {late > 0 ? `${late} día(s) de atraso` : `faltan ${-late} día(s)`}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="font-bold text-strong">{formatCents(balance, symbol)}</div>
                        {r.paid_cents > 0 && (
                          <div className="text-xs text-faint">
                            abonado {formatCents(r.paid_cents, symbol)} de {formatCents(r.total_cents, symbol)}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        {r.status === 'pagada'
                          ? <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">Saldada</span>
                          : r.status === 'anulada'
                            ? <span className="bg-surface-3/50 text-muted font-bold px-2 py-0.5 rounded text-xs">Anulada</span>
                            : overdue
                              ? <span className="bg-danger/20 text-danger font-bold px-2 py-0.5 rounded text-xs">Vencida</span>
                              : <span className="bg-warning/20 text-warning font-bold px-2 py-0.5 rounded text-xs">Pendiente</span>}
                      </td>
                      {canCollect && (
                        <td className="p-3 text-right">
                          {r.status === 'pendiente' && (
                            <button onClick={() => openPay(r)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-success hover:bg-success text-on-accent font-bold text-xs rounded-lg">
                              <HandCoins className="w-3.5 h-3.5" /> Cobrar
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {/* ------------------------------------------------- Cupos autorizados */}
      {canAuthorize && (
        <section aria-label="Clientes con crédito"
          className="bg-surface/80 border border-line rounded-2xl p-5 space-y-4">
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-brand" />
              <h2 className="text-base font-bold text-strong">Clientes con crédito</h2>
            </div>
            <button onClick={openCreditPicker}
              className="px-3 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl">
              Autorizar crédito
            </button>
          </header>
          <HelpNote summary="Cómo funciona el cupo">
            Solo se cambia aquí: ningún otro camino puede tocarlo. Un cliente con
            facturas vencidas queda bloqueado hasta que se ponga al día.
          </HelpNote>
          {creditCustomers.length === 0 ? (
            <p className="text-xs text-muted">
              Todavía no hay clientes autorizados a comprar a crédito.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {creditCustomers.map(c => (
                <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-strong text-sm">{c.name}</div>
                    <div className="text-xs text-faint">
                      Cupo {formatCents(c.credit_limit_cents, symbol)} · {c.credit_terms_days} días de plazo
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => openCredit(c)}
                    >
                    Ajustar cupo
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {paying && (
        <FormModal
          title={`Cobrar — ${paying.customer_name}`}
          submitLabel="Registrar cobro"
          busy={busy}
          error={error}
          onSubmit={() => void submitPay()}
          onClose={() => setPaying(null)}
          onDismissError={() => setError(null)}
        >
          <p className="text-xs text-muted">
            Factura {paying.invoice_number} · saldo{' '}
            <strong className="text-strong">
              {formatCents(paying.total_cents - paying.paid_cents, symbol)}
            </strong>
          </p>
          <Field label="Importe a cobrar" htmlFor="rec-amount">
            <input id="rec-amount" className={textInputClass} value={amount} autoFocus
              inputMode="decimal" onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Forma de pago" htmlFor="rec-method">
            <select id="rec-method" className={textInputClass} value={method}
              onChange={e => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Referencia" htmlFor="rec-ref">
            <input id="rec-ref" className={textInputClass} value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="Nº de transferencia, voucher…" />
          </Field>
          {method === 'efectivo' && (
            <p className="text-xs text-faint">
              El efectivo entra a la caja abierta de la sucursal.
            </p>
          )}
        </FormModal>
      )}

      {showCredit && !creditTarget && (
        <FormModal
          title="Autorizar crédito"
          submitLabel="Cerrar"
          busy={false}
          error={error}
          onSubmit={() => setShowCredit(false)}
          onClose={() => setShowCredit(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Buscar cliente" htmlFor="cred-pick">
            <input id="cred-pick" className={textInputClass} value={pickTerm} autoFocus
              onChange={e => setPickTerm(e.target.value)}
              placeholder="Nombre, teléfono o RNC…" />
          </Field>
          {picks.length === 0 ? (
            <p className="text-xs text-muted">Ningún cliente coincide.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-line/60">
              {picks.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => openCredit(c)}
                    className="w-full text-left py-2.5 px-2 hover:bg-surface-2/60 rounded-lg">
                    <div className="font-bold text-strong text-sm">{c.name}</div>
                    <div className="text-xs text-faint">
                      {c.phone ?? 'sin teléfono'}
                      {c.credit_enabled
                        ? ` · cupo ${formatCents(c.credit_limit_cents, symbol)}`
                        : ' · sin crédito'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormModal>
      )}

      {showCredit && creditTarget && (
        <FormModal
          title={`Crédito — ${creditTarget.name}`}
          submitLabel="Guardar cupo"
          busy={busy}
          error={error}
          onSubmit={() => void submitCredit(true)}
          onClose={() => setShowCredit(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Cupo autorizado" htmlFor="cred-limit">
            <input id="cred-limit" className={textInputClass} value={limitInput} autoFocus
              inputMode="decimal" onChange={e => setLimitInput(e.target.value)} />
          </Field>
          <Field label="Plazo en días" htmlFor="cred-terms">
            <input id="cred-terms" className={textInputClass} value={termsInput}
              inputMode="numeric" onChange={e => setTermsInput(e.target.value)} />
          </Field>
          <p className="text-xs text-faint">
            El cupo no puede quedar por debajo de lo que el cliente ya debe, y el
            crédito no se retira con saldo pendiente.
          </p>
          <Button variant="secondary" size="sm" className="w-full" type="button" onClick={() => void submitCredit(false)} disabled={busy}
            >
            Retirar el crédito a este cliente
          </Button>
        </FormModal>
      )}
    </div>
  );
};
