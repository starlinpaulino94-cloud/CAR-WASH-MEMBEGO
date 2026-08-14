import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Printer, Loader2, AlertCircle, Ban } from 'lucide-react';
import { formatCents, bpsToPercent } from '../../lib/money';
import { fetchInvoiceItems, Invoice, InvoiceItem } from '../../data/billingRepository';
import { Tables } from '../../lib/database.types';
import { LogoMark } from '../common/Logo';

interface Props {
  invoice: Invoice | null;
  company: Tables<'companies'> | null;
  branch: Tables<'branches'> | null;
  onClose: () => void;
}

/**
 * Comprobante térmico.
 *
 * Las líneas se leen de `invoice_items`, no de un objeto en memoria: una
 * reimpresión debe reflejar lo que quedó registrado, no lo que el navegador
 * recordara de la venta.
 *
 * El contenedor lleva la clase `print-ticket`, sobre la que actúan las reglas
 * de impresión de index.css. Sin ellas, window.print() imprimía la aplicación
 * entera.
 */
export const TicketSupabaseModal: React.FC<Props> = ({ invoice, company, branch, onClose }) => {
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const symbol = company?.currency_symbol ?? 'RD$';
  const isCreditNote = Boolean(invoice?.credits_invoice_id);

  useEffect(() => {
    if (!invoice) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchInvoiceItems(invoice.id)
      .then(rows => { if (active) setItems(rows); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'No se pudo cargar el detalle'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [invoice]);

  // Accesibilidad de diálogo: foco inicial, cierre con Escape y bloqueo del
  // scroll de fondo. Los modales auditados no tenían nada de esto (§3.7).
  useEffect(() => {
    if (!invoice) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [invoice, onClose]);

  const handlePrint = useCallback(() => { window.print(); }, []);

  if (!invoice) return null;

  const width = company?.thermal_printer_width === '58mm' ? '58mm' : '80mm';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Comprobante ${invoice.invoice_number}`}
        className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="print-hide bg-slate-800 px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-white font-bold text-sm">
            <Printer className="w-4 h-4 text-indigo-400" />
            {isCreditNote ? 'Nota de crédito' : 'Comprobante'}
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 bg-slate-950 flex justify-center overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="py-10 flex items-center gap-2 text-xs text-slate-400" aria-busy="true">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando detalle…
            </div>
          ) : error ? (
            <div role="alert" className="py-8 flex items-start gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          ) : (
            <div
              className="print-ticket bg-white text-slate-900 p-4 rounded shadow-md font-mono text-[11px] leading-tight space-y-3"
              style={{
                width: width === '58mm' ? '200px' : '280px',
                ['--ticket-width' as string]: width
              }}
            >
              <div className="text-center space-y-1 pb-2 border-b border-dashed border-slate-400">
                {/* El símbolo en un solo tono: la térmica no tiene tinta de
                    color y un degradado sale como una mancha gris. Va pequeño
                    porque el papel es caro y el comprobante empieza abajo. */}
                <LogoMark className="w-8 h-8 mx-auto text-slate-900" simple mono />
                <div className="font-extrabold text-sm uppercase tracking-tight">{company?.trade_name}</div>
                <div className="text-[10px]">{company?.legal_name}</div>
                <div className="text-[10px]">RNC: {company?.tax_id}</div>
                {branch?.address && <div className="text-[10px]">{branch.address}</div>}
                {branch?.phone && <div className="text-[10px]">Tel: {branch.phone}</div>}
              </div>

              {isCreditNote && (
                <div className="text-center font-extrabold text-[11px] border border-slate-900 py-1">
                  NOTA DE CRÉDITO
                </div>
              )}
              {invoice.is_annulled && (
                <div className="text-center font-extrabold text-[11px] border border-slate-900 py-1">
                  *** ANULADA ***
                </div>
              )}

              <div className="space-y-0.5 text-[10px] pb-2 border-b border-dashed border-slate-400">
                <div className="flex justify-between font-bold">
                  <span>COMPROBANTE</span><span>{invoice.invoice_number}</span>
                </div>
                {invoice.ncf && (
                  <div className="flex justify-between font-bold">
                    <span>NCF</span><span>{invoice.ncf}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>FECHA</span>
                  <span>{new Date(invoice.created_at).toLocaleString('es-DO')}</span>
                </div>
              </div>

              <div className="space-y-0.5 text-[10px] pb-2 border-b border-dashed border-slate-400">
                <div className="flex justify-between">
                  <span>CLIENTE</span>
                  <span className="font-bold truncate max-w-[130px]">{invoice.customer_name}</span>
                </div>
                {invoice.customer_tax_id && (
                  <div className="flex justify-between"><span>RNC/CÉDULA</span><span>{invoice.customer_tax_id}</span></div>
                )}
                {invoice.vehicle_plate && (
                  <div className="flex justify-between"><span>PLACA</span><span className="font-bold">{invoice.vehicle_plate}</span></div>
                )}
              </div>

              <div className="space-y-1.5 pb-2 border-b border-dashed border-slate-400">
                <div className="font-bold flex justify-between border-b border-slate-300 pb-1">
                  <span>CANT / DESCRIPCIÓN</span><span>IMPORTE</span>
                </div>
                {items.map(item => (
                  <div key={item.id} className="space-y-0.5">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{item.quantity}x {item.name}</span>
                      <span className="font-bold whitespace-nowrap">
                        {item.is_membego_covered
                          ? formatCents(0, symbol)
                          : formatCents(item.unit_price_cents * item.quantity - item.discount_cents, symbol)}
                      </span>
                    </div>
                    {item.is_membego_covered && (
                      <div className="text-[9px] font-bold pl-2">✔ CUBIERTO POR MEMBEGO</div>
                    )}
                    {item.discount_cents > 0 && !item.is_membego_covered && (
                      <div className="text-[9px] pl-2">
                        Desc: −{formatCents(item.discount_cents, symbol)}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span>SUBTOTAL</span><span>{formatCents(invoice.subtotal_cents, symbol)}</span></div>
                {invoice.discount_cents > 0 && (
                  <div className="flex justify-between font-semibold">
                    <span>DESCUENTO</span><span>−{formatCents(invoice.discount_cents, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>ITBIS ({bpsToPercent(company?.tax_rate_bps ?? 1800)})</span>
                  <span>{formatCents(invoice.tax_cents, symbol)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-sm border-t border-b border-slate-900 py-1 my-1">
                  <span>{isCreditNote ? 'TOTAL ACREDITADO' : 'TOTAL'}</span>
                  <span>{formatCents(invoice.total_cents, symbol)}</span>
                </div>
                {invoice.change_cents > 0 && (
                  <div className="flex justify-between font-bold">
                    <span>CAMBIO</span><span>{formatCents(invoice.change_cents, symbol)}</span>
                  </div>
                )}
              </div>

              {invoice.is_annulled && invoice.annulled_reason && (
                <div className="text-[9px] pt-1 border-t border-dashed border-slate-400">
                  <div className="font-bold">MOTIVO DE ANULACIÓN:</div>
                  <div>{invoice.annulled_reason}</div>
                </div>
              )}

              <div className="text-center space-y-1 text-[9px] pt-1">
                <div>{company?.header_note}</div>
                <div className="font-semibold">{company?.footer_note}</div>
              </div>
            </div>
          )}
        </div>

        <div className="print-hide bg-slate-800 p-4 border-t border-slate-700 flex justify-between items-center">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white text-xs font-semibold">
            Cerrar
          </button>
          <button
            onClick={handlePrint}
            disabled={loading || Boolean(error)}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
          >
            <Printer className="w-4 h-4" /> Imprimir
          </button>
        </div>
      </div>
    </div>
  );
};

interface AnnulProps {
  invoice: Invoice;
  symbol: string;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Confirmación de anulación.
 *
 * La versión auditada anulaba al primer clic, sin confirmación y con el motivo
 * codificado a "Anulación solicitada por cajero" (§19-M). Aquí el motivo es
 * obligatorio, se explica lo que va a ocurrir, y la acción exige un paso
 * deliberado.
 */
export const AnnulInvoiceDialog: React.FC<AnnulProps> = ({
  invoice, symbol, busy, error, onConfirm, onCancel
}) => {
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const valid = reason.trim().length >= 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar anulación"
        className="bg-slate-900 border border-rose-500/40 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="bg-rose-950/50 px-5 py-4 border-b border-rose-500/30 flex items-center gap-3">
          <div className="p-2 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30">
            <Ban className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-white text-sm">Anular {invoice.invoice_number}</h2>
            <p className="text-xs text-slate-400">{formatCents(invoice.total_cents, symbol)}</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-slate-300 leading-relaxed space-y-2">
            <p>Al confirmar, el sistema hará todo esto en una sola operación:</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Emitir una <strong className="text-slate-200">nota de crédito B04</strong> con su NCF</li>
              <li>Devolver los productos al inventario</li>
              <li>Registrar la salida de efectivo en la caja abierta</li>
              <li>Dejar la orden de trabajo pendiente de cobro</li>
            </ul>
            <p className="text-[11px] text-slate-500">
              La factura original no se borra: queda marcada como anulada, con su motivo y autor.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="annul-reason" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Motivo de la anulación *
            </label>
            <textarea
              id="annul-reason"
              ref={ref}
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={busy}
              placeholder="Ej: cobro duplicado al cliente; servicio no prestado…"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 disabled:opacity-50"
            />
            {reason.length > 0 && !valid && (
              <p className="text-[11px] text-amber-400">Describa el motivo con al menos 5 caracteres.</p>
            )}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              disabled={busy}
              className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(reason.trim())}
              disabled={!valid || busy}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Anular y emitir nota
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
