import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Receipt, Search, Printer, Ban, AlertCircle, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, FileMinus
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import {
  fetchInvoicePage, fetchInvoiceTotals, annulInvoice, fetchFiscalStatus,
  Invoice, InvoiceKindFilter, FiscalStatus
} from '../../data/billingRepository';
import { TicketSupabaseModal, AnnulInvoiceDialog } from '../modals/TicketSupabaseModal';

const PAGE_SIZE = 25;

const FILTERS: { id: InvoiceKindFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'invoices', label: 'Facturas' },
  { id: 'credit_notes', label: 'Notas de crédito' },
  { id: 'annulled', label: 'Anuladas' }
];

/**
 * Historial de comprobantes sobre Supabase.
 *
 * Diferencias de fondo con la versión auditada:
 *  - Paginado y filtrado en el SERVIDOR. Antes se renderizaban todas las filas
 *    del histórico sin paginar ni virtualizar (§3.3).
 *  - Anular emite una nota de crédito B04 y revierte inventario y caja, en una
 *    sola transacción. Antes invertía un booleano y dejaba los tres registros
 *    en desacuerdo permanente (C9).
 *  - La anulación exige motivo y confirmación, y está restringida por rol; RLS
 *    la aplica de todos modos aunque se llame al API directamente.
 */
export const InvoicesSupabaseView: React.FC = () => {
  const { profile, company, branch } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [rows, setRows] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ issuedCents: 0, annulledCents: 0, count: 0 });
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<InvoiceKindFilter>('all');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fiscal, setFiscal] = useState<FiscalStatus>({ ready: true, types: [] });

  const [ticket, setTicket] = useState<Invoice | null>(null);
  const [toAnnul, setToAnnul] = useState<Invoice | null>(null);
  const [annulBusy, setAnnulBusy] = useState(false);
  const [annulError, setAnnulError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Clave de idempotencia de la anulación en curso. Igual que en el POS: se
   * conserva entre reintentos para que un fallo de red no acabe emitiendo dos
   * notas de crédito.
   */
  const annulRequestId = useRef<string | null>(null);

  // Búsqueda con retardo: sin esto, cada tecla dispararía una consulta al
  // servidor y un re-render de la tabla completa.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [pageData, totalsData, fisc] = await Promise.all([
        fetchInvoicePage({ branchId: branch.id, page, pageSize: PAGE_SIZE, search, kind }),
        fetchInvoiceTotals(branch.id),
        fetchFiscalStatus()
      ]);
      setRows(pageData.rows);
      setTotal(pageData.total);
      setTotals(totalsData);
      setFiscal(fisc);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
  }, [branch, page, search, kind]);

  useEffect(() => { void load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canAnnul = can(profile, 'annulInvoice');

  const handleAnnul = async (reason: string) => {
    if (!toAnnul) return;
    if (!annulRequestId.current) annulRequestId.current = crypto.randomUUID();

    setAnnulBusy(true);
    setAnnulError(null);
    try {
      const credit = await annulInvoice(toAnnul.id, reason, annulRequestId.current);
      setNotice(
        `Factura ${toAnnul.invoice_number} anulada. Nota de crédito ${credit.invoice_number}` +
        `${credit.ncf ? ` (NCF ${credit.ncf})` : ''} emitida por ${formatCents(credit.total_cents, symbol)}.`
      );
      annulRequestId.current = null;   // operación cerrada
      setToAnnul(null);
      await load();
    } catch (err) {
      // NO se limpia la clave: reintentar debe llevar la misma.
      setAnnulError(err instanceof Error ? err.message : 'No se pudo anular la factura');
    } finally {
      setAnnulBusy(false);
    }
  };

  const openAnnul = (invoice: Invoice) => {
    annulRequestId.current = null;   // nueva operación, clave nueva
    setAnnulError(null);
    setToAnnul(invoice);
  };

  const summary = useMemo(() => ([
    { label: 'Facturado (vigente)', value: formatCents(totals.issuedCents, symbol), tone: 'text-emerald-400' },
    { label: 'Anulado', value: formatCents(totals.annulledCents, symbol), tone: 'text-rose-400' },
    { label: 'Comprobantes emitidos', value: String(totals.count), tone: 'text-indigo-400' }
  ]), [totals, symbol]);

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar el historial
          </div>
          <p className="text-xs text-slate-300">{loadError}</p>
          <button onClick={() => void load()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Receipt className="w-5 h-5 text-indigo-400" /> Facturas y comprobantes
        </h2>
        <p className="text-xs text-slate-400">
          {branch?.name} · Reimpresión, NCF fiscal y anulación con nota de crédito
        </p>
      </div>

      {!fiscal.ready && (
        <div role="status" className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
          <span>
            <strong>Comprobantes sin NCF.</strong> La facturación fiscal (DGII) no está
            configurada, así que las ventas se registran como <strong>recibos internos</strong>
            {' '}sin número fiscal. El historial y la anulación funcionan igual. Si cargas
            rangos NCF, los nuevos comprobantes podrán llevar NCF.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {summary.map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
            <div className="text-xs text-slate-400">{s.label}</div>
            <div className={`text-lg font-black ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-2 p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-200">
          <FileMinus className="w-4 h-4 flex-shrink-0 text-emerald-400 mt-0.5" />
          <div className="flex-1">{notice}</div>
          <button onClick={() => setNotice(null)} className="text-emerald-400 hover:text-emerald-200 font-bold px-1" aria-label="Descartar aviso">×</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <label htmlFor="inv-search" className="sr-only">Buscar comprobante</label>
          <input
            id="inv-search"
            type="search"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Buscar por número, NCF, cliente o placa…"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => { setKind(f.id); setPage(0); }}
              aria-pressed={kind === f.id}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                kind === f.id
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Historial de comprobantes emitidos</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">COMPROBANTE</th>
                <th scope="col" className="p-3 font-semibold">FECHA</th>
                <th scope="col" className="p-3 font-semibold">CLIENTE</th>
                <th scope="col" className="p-3 font-semibold">NCF</th>
                <th scope="col" className="p-3 font-semibold text-right">TOTAL</th>
                <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} aria-hidden="true">
                    <td colSpan={6} className="p-3">
                      <div className="h-5 bg-slate-800/60 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-slate-500 italic">
                    {search || kind !== 'all'
                      ? 'Ningún comprobante coincide con el filtro.'
                      : 'Todavía no se ha emitido ningún comprobante.'}
                  </td>
                </tr>
              ) : rows.map(inv => {
                const isCredit = Boolean(inv.credits_invoice_id);
                return (
                  <tr key={inv.id} className={`hover:bg-slate-800/40 transition-colors ${inv.is_annulled ? 'opacity-60' : ''}`}>
                    <td className="p-3">
                      <div className="font-bold text-indigo-300">{inv.invoice_number}</div>
                      {isCredit && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">
                          NOTA DE CRÉDITO
                        </span>
                      )}
                      {inv.is_annulled && (
                        <span className="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded font-bold">
                          ANULADA
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-400 whitespace-nowrap">
                      {new Date(inv.created_at).toLocaleString('es-DO')}
                    </td>
                    <td className="p-3">
                      <div className="text-white font-medium">{inv.customer_name}</div>
                      {inv.vehicle_plate && (
                        <div className="text-[10px] text-slate-500">{inv.vehicle_plate}</div>
                      )}
                    </td>
                    <td className="p-3 text-slate-300 font-mono text-[11px]">
                      {inv.ncf ?? <span className="text-slate-600">Sin NCF</span>}
                    </td>
                    <td className={`p-3 font-bold text-right whitespace-nowrap ${isCredit ? 'text-amber-400' : 'text-white'}`}>
                      {isCredit ? '−' : ''}{formatCents(inv.total_cents, symbol)}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setTicket(inv)}
                          className="px-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] flex items-center gap-1 font-semibold"
                        >
                          <Printer className="w-3.5 h-3.5" /> Ticket
                        </button>
                        {!inv.is_annulled && !isCredit && (
                          <button
                            onClick={() => openAnnul(inv)}
                            disabled={!canAnnul}
                            title={canAnnul ? undefined : 'Su rol no permite anular facturas'}
                            className="px-2 py-1.5 bg-rose-600/30 text-rose-300 hover:bg-rose-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded text-[11px] flex items-center gap-1 font-semibold border border-rose-500/30"
                          >
                            <Ban className="w-3.5 h-3.5" /> Anular
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs">
          <span className="text-slate-400">
            {total === 0 ? 'Sin resultados' : (
              <>Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              aria-label="Página anterior"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-400 tabular-nums">{page + 1} / {pageCount}</span>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1 || loading}
              aria-label="Página siguiente"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
          </div>
        </div>
      </div>

      {ticket && (
        <TicketSupabaseModal
          invoice={ticket}
          company={company}
          branch={branch}
          onClose={() => setTicket(null)}
        />
      )}

      {toAnnul && (
        <AnnulInvoiceDialog
          invoice={toAnnul}
          symbol={symbol}
          busy={annulBusy}
          error={annulError}
          onConfirm={reason => void handleAnnul(reason)}
          onCancel={() => { if (!annulBusy) { setToAnnul(null); setAnnulError(null); } }}
        />
      )}
    </div>
  );
};
