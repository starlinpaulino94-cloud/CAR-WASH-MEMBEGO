import React, { useEffect, useState } from 'react';
import { FileMinus, Search, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import {
  fetchCreditNotes, searchCreditableInvoices, creditNoteInvoice,
  Invoice, InvoiceWithItems
} from '../../data/fiscalRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow, SearchBox
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Notas de crédito parciales.
 *
 * Anular era todo o nada: para corregir un renglón había que tumbar la factura
 * entera y volver a emitirla, quemando un NCF y descuadrando la caja dos veces.
 * Aquí se acreditan CANTIDADES de líneas concretas, y la factura solo se anula
 * cuando lo acreditado alcanza su total.
 *
 * Los importes los calcula el servidor: esta pantalla solo dice qué y cuánto.
 */
export const CreditNotesSupabaseView: React.FC = () => {
  const { profile, phase, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canManage = can(profile, 'annulInvoice');

  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    fetchCreditNotes()
      .then(setRows)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar las notas'))
      .finally(() => setLoading(false));
  }, [phase, nonce]);

  // --- Emitir una nota
  const [showForm, setShowForm] = useState(false);
  const [term, setTerm] = useState('');
  const [candidatas, setCandidatas] = useState<InvoiceWithItems[]>([]);
  const [elegida, setElegida] = useState<InvoiceWithItems | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState('');
  // La clave de idempotencia se fija al abrir: un reintento tras un error de red
  // debe llevar la MISMA, o emitiría dos notas.
  const [requestId, setRequestId] = useState('');

  useEffect(() => {
    if (!showForm || elegida) return;
    const id = window.setTimeout(() => {
      searchCreditableInvoices(term).then(setCandidatas).catch(() => setCandidatas([]));
    }, 350);
    return () => window.clearTimeout(id);
  }, [showForm, elegida, term]);

  const abrir = () => {
    setTerm(''); setCandidatas([]); setElegida(null);
    setCantidades({}); setMotivo('');
    setRequestId(`nc-${crypto.randomUUID()}`);
    setError(null); setShowForm(true);
  };

  const elegir = (inv: InvoiceWithItems) => {
    setElegida(inv);
    setCantidades({});
  };

  const setCantidad = (itemId: string, valor: number, max: number) =>
    setCantidades(c => ({ ...c, [itemId]: Math.max(0, Math.min(valor, max)) }));

  const lineas = elegida
    ? elegida.invoice_items
        .filter(i => !i.is_membego_covered && i.quantity - i.credited_quantity > 0)
    : [];

  // Previsualización. El importe que vale es el que calcula credit_note_invoice.
  const previsto = lineas.reduce((acc, i) => {
    const q = cantidades[i.id] ?? 0;
    if (q <= 0) return acc;
    const bruto = i.unit_price_cents * q;
    const desc = Math.round((i.discount_cents * q) / i.quantity);
    return acc + bruto - desc;
  }, 0);

  const emitir = async () => {
    if (!elegida || busy) return;
    const seleccion = Object.entries(cantidades)
      .filter(([, q]) => q > 0)
      .map(([invoice_item_id, quantity]) => ({ invoice_item_id, quantity }));
    if (seleccion.length === 0) { setError('Indique qué unidades se acreditan.'); return; }
    if (motivo.trim().length < 5) { setError('Explique el motivo (mínimo 5 caracteres).'); return; }

    setBusy(true); setError(null);
    try {
      const nota = await creditNoteInvoice({
        invoiceId: elegida.id, lines: seleccion,
        reason: motivo.trim(), clientRequestId: requestId
      });
      setShowForm(false);
      setNotice(`Nota ${nota.invoice_number} emitida por ${formatCents(nota.total_cents, symbol)}.`);
      setNonce(n => n + 1);
    } catch (err) {
      // NO se cambia requestId: un reintento debe llevar la misma clave.
      setError(err instanceof Error ? err.message : 'No se pudo emitir la nota de crédito');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<FileMinus className="w-5 h-5 text-brand" />}
          title="Notas de crédito" subtitle="Corregir un renglón sin tumbar la factura" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudieron cargar las notas de crédito" />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        icon={<FileMinus className="w-5 h-5 text-brand" />}
        title="Notas de crédito"
        subtitle="Acredita renglones concretos; la factura solo se anula si se acredita entera"
        actions={canManage ? (
          <button onClick={abrir}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl">
            <FileMinus className="w-4 h-4" /> Emitir nota
          </button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar las notas, no emitirlas.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showForm && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Notas de crédito emitidas</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">NOTA</th>
                <th scope="col" className="p-3 font-semibold">NCF</th>
                <th scope="col" className="p-3 font-semibold">CLIENTE</th>
                <th scope="col" className="p-3 font-semibold">FECHA</th>
                <th scope="col" className="p-3 font-semibold text-right">IMPORTE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? <SkeletonRows cols={5} />
                : rows.length === 0 ? (
                  <EmptyRow cols={5}>Todavía no se ha emitido ninguna nota de crédito.</EmptyRow>
                ) : rows.map(n => (
                  <tr key={n.id} className="hover:bg-surface-2/40">
                    <td className="p-3 font-bold text-strong tabular-nums">{n.invoice_number}</td>
                    <td className="p-3 text-muted tabular-nums">{n.ncf ?? '—'}</td>
                    <td className="p-3 text-muted">{n.customer_name}</td>
                    <td className="p-3 text-muted tabular-nums">{fecha(n.created_at)}</td>
                    <td className="p-3 text-right font-bold text-danger tabular-nums">
                      −{formatCents(n.total_cents, symbol)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <FormModal
          title={elegida ? `Acreditar — ${elegida.invoice_number}` : 'Emitir nota de crédito'}
          submitLabel={elegida ? `Emitir por ${formatCents(previsto, symbol)} + ITBIS` : 'Elija la factura'}
          busy={busy}
          error={error}
          onSubmit={() => { if (elegida) void emitir(); }}
          onClose={() => setShowForm(false)}
          onDismissError={() => setError(null)}
        >
          {!elegida ? (
            <>
              <Field label="Buscar factura" htmlFor="nc-search">
                <input id="nc-search" className={textInputClass} value={term} autoFocus
                  onChange={e => setTerm(e.target.value)}
                  placeholder="Número, cliente o placa…" />
              </Field>
              {candidatas.length === 0 ? (
                <p className="text-xs text-muted flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" /> Ninguna factura vigente coincide.
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-line/60">
                  {candidatas.map(inv => (
                    <li key={inv.id}>
                      <button type="button" onClick={() => elegir(inv)}
                        className="w-full text-left py-2.5 px-2 hover:bg-surface-2/60 rounded-lg">
                        <div className="flex justify-between gap-2">
                          <span className="font-bold text-strong text-sm tabular-nums">{inv.invoice_number}</span>
                          <span className="text-sm text-body tabular-nums">
                            {formatCents(inv.total_cents, symbol)}
                          </span>
                        </div>
                        <div className="text-xs text-faint">
                          {inv.customer_name} · {fecha(inv.created_at)}
                          {inv.credited_cents > 0 && ` · ya acreditado ${formatCents(inv.credited_cents, symbol)}`}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  {elegida.customer_name} · {fecha(elegida.created_at)}
                  {elegida.ncf && ` · NCF ${elegida.ncf}`}
                </p>
                <button type="button" onClick={() => setElegida(null)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body">
                  <X className="w-3 h-3" /> Cambiar
                </button>
              </div>

              {lineas.length === 0 ? (
                <p className="text-xs text-warning">
                  Esta factura ya tiene todas sus líneas acreditadas.
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {lineas.map(i => {
                    const disponible = i.quantity - i.credited_quantity;
                    return (
                      <li key={i.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-strong text-sm">{i.name}</div>
                          <div className="text-xs text-faint">
                            {formatCents(i.unit_price_cents, symbol)} c/u · quedan {disponible} de {i.quantity}
                          </div>
                        </div>
                        <input
                          aria-label={`Unidades a acreditar de ${i.name}`}
                          className="w-20 bg-canvas border border-line rounded-lg px-2 py-1.5 text-sm text-strong text-right tabular-nums"
                          inputMode="numeric"
                          value={cantidades[i.id] ?? 0}
                          onChange={e => setCantidad(i.id, Number(e.target.value) || 0, disponible)} />
                      </li>
                    );
                  })}
                </ul>
              )}

              <Field label="Motivo *" htmlFor="nc-reason">
                <input id="nc-reason" className={textInputClass} value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  placeholder="Se entregó uno de menos" />
              </Field>
              <p className="text-xs text-faint">
                El importe final lo calcula el servidor con el ITBIS de la empresa.
                Si la venta fue a crédito, lo acreditado baja primero la deuda; solo lo
                que exceda el saldo se devuelve en efectivo.
              </p>
            </>
          )}
        </FormModal>
      )}
    </div>
  );
};
