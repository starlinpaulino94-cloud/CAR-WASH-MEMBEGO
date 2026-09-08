import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Printer, Loader2, AlertCircle, Car } from 'lucide-react';
import { formatCents } from '../../lib/money';
import { fetchOrderItems, WorkOrder, WorkOrderItem } from '../../data/ordersRepository';
import { fetchPerfilComprobanteMembego, PerfilComprobanteMembego } from '../../data/adminRepository';
import { Tables } from '../../lib/database.types';
import { LogoMark } from '../common/Logo';

interface Props {
  order: WorkOrder | null;
  company: Tables<'companies'> | null;
  branch: Tables<'branches'> | null;
  /** Nombres de los lavadores asignados, para que el cliente sepa a quién dárselo. */
  lavadores: string[];
  /** Aviso a enseñar sobre la comanda (p. ej. que el lavador no se asignó). */
  aviso?: string | null;
  onClose: () => void;
}

/**
 * LA COMANDA DE LLEGADA — el papel que el cliente le entrega al lavador.
 *
 * No es una factura y no debe parecerlo. Aquí no hay NCF, no hay ITBIS y no hay
 * total a pagar: la venta todavía no ocurrió. Lo que hay es el encargo —qué
 * carro, qué servicios y quién lo lava— y un importe ESTIMADO, porque el
 * cliente pregunta cuánto va a costar y no dárselo es peor que dárselo con su
 * advertencia. La factura se emite después, cuando el lavado está hecho y el
 * cliente paga.
 *
 * Por eso el papel lo dice con todas las letras: «NO ES COMPROBANTE FISCAL».
 * Un cliente que se va con esto creyendo que ya pagó, o un inspector que lo lee
 * como una venta sin NCF, son dos problemas que se evitan con una línea.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE IMPRIME GRANDE
 *
 * La placa y el número de orden, porque son lo que se busca de un vistazo entre
 * diez papeles mojados en una tablilla; y el lavador, porque es el motivo por
 * el que este papel existe.
 */

const FORMATOS = [
  { id: '58mm', label: 'Térmica 58 mm' },
  { id: '80mm', label: 'Térmica 80 mm' }
] as const;
type Formato = (typeof FORMATOS)[number]['id'];

const ANCHO_PANTALLA: Record<Formato, number> = { '58mm': 220, '80mm': 300 };

export const ComandaOrdenModal: React.FC<Props> = ({
  order, company, branch, lavadores, aviso, onClose
}) => {
  const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [perfil, setPerfil] = useState<PerfilComprobanteMembego | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formato, setFormato] = useState<Formato>(
    company?.thermal_printer_width === '58mm' ? '58mm' : '80mm'
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const symbol = company?.currency_symbol ?? 'RD$';

  useEffect(() => {
    if (!order) return;
    let activo = true;
    setLoading(true);
    setError(null);
    fetchOrderItems(order.id)
      .then(rows => { if (activo) setItems(rows); })
      .catch(err => { if (activo) setError(err instanceof Error ? err.message : 'No se pudo cargar el detalle'); })
      .finally(() => { if (activo) setLoading(false); });
    // El perfil de Membego es opcional: sin él se imprime con la marca local.
    fetchPerfilComprobanteMembego()
      .then(p => { if (activo) setPerfil(p); })
      .catch(() => { if (activo) setPerfil(null); });
    return () => { activo = false; };
  }, [order]);

  useEffect(() => {
    if (!order) return;
    const previo = document.activeElement as HTMLElement | null;
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
      previo?.focus();
    };
  }, [order, onClose]);

  const handlePrint = useCallback(() => {
    const root = document.documentElement;
    root.style.setProperty('--print-page-size', formato);
    root.style.setProperty('--print-page-margin', '0');
    window.print();
  }, [formato]);

  if (!order) return null;

  const fecha = new Date(order.arrival_at);
  const fechaStr = fecha.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
  const horaStr = fecha.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' });

  const negocioNombre = perfil?.nombre ?? company?.trade_name ?? '';
  const negocioDireccion = perfil?.direccion
    ? [perfil.direccion, perfil.ciudad].filter(Boolean).join(', ')
    : branch?.address ?? null;
  const negocioTelefono = perfil?.telefono ?? branch?.phone ?? null;

  const linea = '-'.repeat(37);
  const banda = '*'.repeat(37);
  const fila = (etiqueta: string, valor: React.ReactNode, fuerte = false) => (
    <div className="flex justify-between gap-2">
      <span>{etiqueta}</span>
      <span className={`text-right ${fuerte ? 'font-bold' : ''}`}>{valor}</span>
    </div>
  );

  const estimado = items.reduce(
    (acc, i) => acc + i.unit_price_cents * i.quantity - i.discount_cents, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Comanda de la orden ${order.order_number}`}
        className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="print-hide bg-slate-800 px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-white font-bold text-sm">
            <Car className="w-4 h-4 text-indigo-400" />
            Comanda · {order.order_number}
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

        {aviso && (
          <div role="alert" className="print-hide bg-amber-950/50 border-b border-amber-500/40 px-4 py-2.5 flex items-start gap-2 text-xs text-amber-200">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{aviso}</span>
          </div>
        )}

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
              className="print-ticket bg-white text-slate-900 rounded shadow-md font-mono text-[11px] p-4 leading-tight space-y-2"
              style={{
                width: `${ANCHO_PANTALLA[formato]}px`,
                ['--ticket-width' as string]: formato
              }}
            >
              {/* Logo y negocio, como en el comprobante. */}
              <div className="text-center space-y-1 pb-1">
                {perfil?.logoUrl ? (
                  <img src={perfil.logoUrl} alt="" className="mx-auto max-h-14 object-contain grayscale" />
                ) : (
                  <LogoMark className="w-12 h-12 mx-auto text-slate-900" simple mono />
                )}
                <div className="font-extrabold text-base uppercase tracking-tight">{negocioNombre}</div>
                {branch?.name && <div className="text-[10px]">{branch.name}</div>}
                {negocioDireccion && <div className="text-[10px]">{negocioDireccion}</div>}
                {negocioTelefono && <div className="text-[10px]">Tel: {negocioTelefono}</div>}
              </div>

              <div className="text-center space-y-0.5">
                <div className="tracking-tighter overflow-hidden whitespace-nowrap">{banda}</div>
                <div className="font-extrabold tracking-[0.2em]">ORDEN DE LAVADO</div>
                {/* La línea que evita que este papel se confunda con una venta. */}
                <div className="text-[9px] font-bold">NO ES COMPROBANTE FISCAL</div>
                <div className="tracking-tighter overflow-hidden whitespace-nowrap">{banda}</div>
              </div>

              {/* El número, en grande: es lo que se canta para entregar el carro. */}
              <div className="text-center py-1">
                <div className="text-[9px] uppercase tracking-widest">Orden</div>
                <div className="font-extrabold text-lg tracking-tight">{order.order_number}</div>
              </div>

              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-0.5">
                {fila('Fecha:', fechaStr)}
                {fila('Hora de llegada:', horaStr)}
                {order.priority !== 'normal' && fila('Prioridad:', order.priority.toUpperCase(), true)}
              </div>

              {/* Cliente y carro. La placa grande: es como se identifica el carro
                  en el patio, no por el nombre del dueño. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-0.5">
                <div className="font-bold">CLIENTE Y VEHÍCULO</div>
                {fila('Nombre:', order.customer_name, true)}
                {order.customer_phone && fila('Teléfono:', order.customer_phone)}
                {order.vehicle_make_model.trim() && fila('Vehículo:', order.vehicle_make_model)}
                {order.vehicle_color && fila('Color:', order.vehicle_color)}
              </div>
              <div className="text-center py-1 border border-slate-900">
                <div className="text-[9px] uppercase tracking-widest">Placa</div>
                <div className="font-extrabold text-lg tracking-widest">{order.vehicle_plate}</div>
              </div>

              {/* El lavador: la razón de ser de este papel. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-0.5">
                <div className="font-bold">LAVADOR ASIGNADO</div>
                {lavadores.length > 0 ? (
                  lavadores.map(n => <div key={n} className="font-extrabold text-sm">{n}</div>)
                ) : (
                  <div className="italic">Por asignar en el tablero</div>
                )}
              </div>

              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-1">
                <div className="font-bold">{items.length > 1 ? 'SERVICIOS' : 'SERVICIO'}</div>
                {items.map(item => (
                  <div key={item.id} className="flex justify-between gap-2">
                    <span className="truncate">{item.quantity}x {item.name}</span>
                    <span className="whitespace-nowrap">
                      {formatCents(item.unit_price_cents * item.quantity - item.discount_cents, symbol)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Estimado, NO total. El cliente pregunta cuánto va a costar y
                  hay que decírselo, pero con su advertencia: el importe
                  definitivo lo fija la factura al cobrar. */}
              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="space-y-0.5">
                <div className="flex justify-between font-bold">
                  <span>ESTIMADO</span>
                  <span>{formatCents(estimado, symbol)}</span>
                </div>
                <div className="text-[9px]">
                  Importe estimado, sin impuestos. El total se factura al entregar el vehículo.
                </div>
              </div>

              {order.notes && (
                <>
                  <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
                  <div className="text-[10px]">
                    <div className="font-bold">OBSERVACIONES:</div>
                    <div>{order.notes}</div>
                  </div>
                </>
              )}

              <div className="text-slate-500 overflow-hidden whitespace-nowrap">{linea}</div>
              <div className="text-center space-y-1 text-[10px]">
                <div className="font-bold">Entregue este papel al lavador</div>
                <div>para que inicie el lavado de su vehículo.</div>
                <div className="pt-2">Conserve su copia para retirar el vehículo.</div>
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
            <Printer className="w-4 h-4" /> Imprimir comanda
          </button>
        </div>
      </div>
    </div>
  );
};
