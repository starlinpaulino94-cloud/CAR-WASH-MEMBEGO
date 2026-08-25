import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Printer, Loader2, AlertCircle, Ban } from 'lucide-react';
import { formatCents, bpsToPercent } from '../../lib/money';
import {
  fetchInvoiceItems, fetchComprobanteExtras,
  Invoice, InvoiceItem, ComprobanteExtras
} from '../../data/billingRepository';
import { Tables } from '../../lib/database.types';
import { LogoMark } from '../common/Logo';
import { QrCode } from '../common/QrCode';

interface Props {
  invoice: Invoice | null;
  company: Tables<'companies'> | null;
  branch: Tables<'branches'> | null;
  onClose: () => void;
}

/**
 * Los cuatro tamaños en que Membego rinde el mismo comprobante: dos anchos de
 * papel térmico y dos hojas completas. El contenido no cambia, solo el lienzo.
 */
const FORMATOS = [
  { id: '58mm',  label: 'Térmica 58 mm' },
  { id: '80mm',  label: 'Térmica 80 mm' },
  { id: 'carta', label: 'Carta' },
  { id: 'a4',    label: 'A4' }
] as const;
type Formato = (typeof FORMATOS)[number]['id'];

/** Ancho del lienzo en pantalla (px) por formato. */
const ANCHO_PANTALLA: Record<Formato, number> = {
  '58mm': 220, '80mm': 300, carta: 640, a4: 640
};
/** Tamaño de página y márgenes para @page al imprimir. */
const PAGINA_IMPRESION: Record<Formato, { size: string; margin: string }> = {
  '58mm': { size: '58mm', margin: '0' },
  '80mm': { size: '80mm', margin: '0' },
  carta:  { size: 'letter', margin: '12mm' },
  a4:     { size: 'A4', margin: '12mm' }
};

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
  const [extras, setExtras] = useState<ComprobanteExtras>({ cashierName: null, vehicle: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formato, setFormato] = useState<Formato>(
    company?.thermal_printer_width === '58mm' ? '58mm' : '80mm'
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const symbol = company?.currency_symbol ?? 'RD$';
  const isCreditNote = Boolean(invoice?.credits_invoice_id);

  useEffect(() => {
    if (!invoice) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchInvoiceItems(invoice.id), fetchComprobanteExtras(invoice)])
      .then(([rows, ex]) => { if (active) { setItems(rows); setExtras(ex); } })
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

  // Al imprimir se fija el tamaño de página en la raíz: @page no puede leer una
  // variable puesta sobre un elemento suelto, así que va en documentElement.
  const handlePrint = useCallback(() => {
    const { size, margin } = PAGINA_IMPRESION[formato];
    const root = document.documentElement;
    root.style.setProperty('--print-page-size', size);
    root.style.setProperty('--print-page-margin', margin);
    window.print();
  }, [formato]);

  if (!invoice) return null;

  const isPage = formato === 'carta' || formato === 'a4';
  const anchoTicket = isPage ? 360 : ANCHO_PANTALLA[formato];

  const fecha = new Date(invoice.created_at);
  const fechaStr = fecha.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
  const horaStr = fecha.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' });

  const esRegalo = invoice.total_cents === 0;
  const vehiculoStr = extras.vehicle
    ? `${extras.vehicle.make} ${extras.vehicle.model}`.trim() +
      (extras.vehicle.year ? ` (${extras.vehicle.year})` : '')
    : null;
  const cubierto = items.some(i => i.is_membego_covered);

  // El QR codifica la referencia verificable de la operación (número, NCF, RNC
  // y total). No abre una web: es el archivo que Membego imprime como respaldo.
  const qrValue = [
    company?.trade_name ?? '',
    `Comprobante ${invoice.invoice_number}`,
    invoice.ncf ? `NCF ${invoice.ncf}` : '',
    `RNC ${company?.tax_id ?? ''}`,
    `Total ${formatCents(invoice.total_cents, symbol)}`,
    fecha.toISOString()
  ].filter(Boolean).join(' | ');

  const banda = '*'.repeat(37);
  const linea = '-'.repeat(37);
  const fila = (etiqueta: string, valor: React.ReactNode, fuerte = false) => (
    <div className="flex justify-between gap-2">
      <span>{etiqueta}</span>
      <span className={`text-right ${fuerte ? 'font-bold' : ''}`}>{valor}</span>
    </div>
  );

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
        className={`bg-slate-900 border border-slate-800 w-full ${isPage ? 'max-w-2xl' : 'max-w-md'} rounded-2xl shadow-2xl overflow-hidden flex flex-col`}
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

        {/* Selector de formato: el mismo comprobante en papel térmico u hoja. */}
        <div className="print-hide bg-slate-800/60 px-4 py-2.5 border-b border-slate-700 flex flex-wrap gap-1.5">
          {FORMATOS.map(f => (
            <button
              key={f.id}
              onClick={() => setFormato(f.id)}
              aria-pressed={formato === f.id}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                formato === f.id
                  ? 'bg-indigo-600 text-white border-transparent'
                  : 'bg-transparent text-slate-300 border-slate-600 hover:bg-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
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
              className={`print-ticket ${isPage ? 'is-page' : ''} bg-white text-slate-900 rounded shadow-md font-mono ${
                isPage ? 'text-[12px] p-8' : 'text-[11px] p-4'
              } leading-tight space-y-2`}
              style={{
                width: `${anchoTicket}px`,
                ['--ticket-width' as string]: formato === '58mm' ? '58mm' : '80mm'
              }}
            >
              {/* Banda superior + COPIA, como el comprobante de Membego. */}
              <div className="text-center space-y-0.5">
                <div className="tracking-tighter overflow-hidden whitespace-nowrap">{banda}</div>
                <div className="font-extrabold tracking-[0.3em]">COPIA</div>
                <div className="tracking-tighter overflow-hidden whitespace-nowrap">{banda}</div>
              </div>

              {esRegalo && !isCreditNote && (
                <div className="text-center space-y-0.5">
                  <div className="font-bold">COMPROBANTE DE ENTREGA</div>
                  <div className="text-[10px]">Sin valor comercial</div>
                  <div className="tracking-tighter overflow-hidden whitespace-nowrap">{banda}</div>
                </div>
              )}

              {/* Logo redondo + datos del negocio. */}
              <div className="text-center space-y-1 pb-1">
                <LogoMark className="w-12 h-12 mx-auto text-slate-900" simple mono />
                <div className="font-extrabold text-base uppercase tracking-tight">{company?.trade_name}</div>
                {branch?.name && <div className="text-[10px]">{branch.name}</div>}
                {branch?.address && <div className="text-[10px]">{branch.address}</div>}
                {branch?.phone && <div className="text-[10px]">Tel: {branch.phone}</div>}
                <div className="text-[10px]">RNC: {company?.tax_id}</div>
              </div>

              {isCreditNote && (
                <div className="text-center font-extrabold border border-slate-900 py-1">NOTA DE CRÉDITO</div>
              )}
              {invoice.is_annulled && (
                <div className="text-center font-extrabold border border-slate-900 py-1">*** ANULADA ***</div>
              )}

              {/* Datos de la operación. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-0.5">
                {fila('Fecha:', fechaStr)}
                {fila('Hora:', horaStr)}
                {extras.cashierName && fila('Empleado:', extras.cashierName)}
                {fila('Comprobante:', invoice.invoice_number, true)}
                {invoice.ncf && fila('NCF:', invoice.ncf, true)}
              </div>

              {/* Cliente. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-0.5">
                <div className="font-bold">CLIENTE</div>
                {fila('Nombre:', invoice.customer_name, true)}
                {invoice.customer_tax_id && fila('RNC/Cédula:', invoice.customer_tax_id)}
                {vehiculoStr && fila('Vehículo:', vehiculoStr)}
                {invoice.vehicle_plate && fila('Placa:', invoice.vehicle_plate, true)}
                {cubierto && fila('Membresía:', 'Cubre este servicio')}
              </div>

              {/* Servicio(s). */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-1">
                <div className="font-bold">{items.length > 1 ? 'SERVICIOS' : 'SERVICIO'}</div>
                {items.map(item => (
                  <div key={item.id} className="space-y-0.5">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{item.quantity}x {item.name}</span>
                      <span className="font-bold whitespace-nowrap">
                        {item.is_membego_covered
                          ? 'Gratis'
                          : formatCents(item.unit_price_cents * item.quantity - item.discount_cents, symbol)}
                      </span>
                    </div>
                    {item.is_membego_covered && (
                      <div className="text-[9px] font-bold pl-2">✔ Cubierto por Membego</div>
                    )}
                    {item.discount_cents > 0 && !item.is_membego_covered && (
                      <div className="text-[9px] pl-2">Desc: −{formatCents(item.discount_cents, symbol)}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Totales / pago. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              {esRegalo ? (
                <div className="space-y-0.5">{fila('Pago:', 'Regalo · sin costo', true)}</div>
              ) : (
                <div className="space-y-0.5">
                  {fila('Subtotal:', formatCents(invoice.subtotal_cents, symbol))}
                  {invoice.discount_cents > 0 &&
                    fila('Descuento:', `−${formatCents(invoice.discount_cents, symbol)}`)}
                  {fila(`ITBIS (${bpsToPercent(company?.tax_rate_bps ?? 1800)}):`,
                    formatCents(invoice.tax_cents, symbol))}
                  <div className="flex justify-between font-extrabold text-sm border-t border-b border-slate-900 py-1 my-1">
                    <span>{isCreditNote ? 'TOTAL ACREDITADO' : 'TOTAL'}</span>
                    <span>{formatCents(invoice.total_cents, symbol)}</span>
                  </div>
                  {invoice.change_cents > 0 && fila('Cambio:', formatCents(invoice.change_cents, symbol), true)}
                </div>
              )}

              {invoice.is_annulled && invoice.annulled_reason && (
                <>
                  <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
                  <div className="text-[9px]">
                    <div className="font-bold">MOTIVO DE ANULACIÓN:</div>
                    <div>{invoice.annulled_reason}</div>
                  </div>
                </>
              )}

              {/* QR de la operación. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="flex flex-col items-center gap-1 pt-1">
                <QrCode value={qrValue} size={isPage ? 132 : 104} />
                <div className="text-[9px] text-center">Escanea para consultar esta operación</div>
              </div>

              {/* Pie. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="text-center space-y-1 text-[10px]">
                {company?.header_note && <div>{company.header_note}</div>}
                <div className="font-bold">¡Gracias por tu preferencia!</div>
                {company?.footer_note && <div>{company.footer_note}</div>}
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
