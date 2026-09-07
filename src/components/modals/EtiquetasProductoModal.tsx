import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Printer, Tag } from 'lucide-react';
import { formatCents } from '../../lib/money';
import { Barcode } from '../common/Barcode';
import { Product } from '../../data/adminRepository';

/**
 * Hoja de etiquetas de un producto, para imprimir y pegar en el estante.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE IMPRIME UNA REJILLA Y NO UNA ETIQUETA
 *
 * Nadie etiqueta un producto: se etiqueta una caja de veinte. Imprimir de una en
 * una obliga a repetir el proceso veinte veces y desperdicia la hoja adhesiva,
 * que se vende en pliegos. Por eso lo que se elige es CUÁNTAS, y la hoja se
 * llena sola.
 *
 * Los tres tamaños cubren lo que se usa de verdad: la pequeña para frascos, la
 * mediana para la mayoría y la grande para cajas o cuando hace falta leer el
 * precio de lejos.
 */

interface Props {
  producto: Product | null;
  /** Símbolo de moneda de la empresa. */
  symbol: string;
  onClose: () => void;
}

const TAMANOS = [
  { id: 'pequena', label: 'Pequeña', ancho: 35, alto: 22, fuente: 5.5, barras: 34 },
  { id: 'mediana', label: 'Mediana', ancho: 50, alto: 30, fuente: 7,   barras: 42 },
  { id: 'grande',  label: 'Grande',  ancho: 70, alto: 40, fuente: 9,   barras: 50 },
] as const;
type TamanoId = (typeof TAMANOS)[number]['id'];

export const EtiquetasProductoModal: React.FC<Props> = ({ producto, symbol, onClose }) => {
  const [copias, setCopias] = useState(12);
  const [tamano, setTamano] = useState<TamanoId>('mediana');
  const [conPrecio, setConPrecio] = useState(true);
  const [conCodigo, setConCodigo] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Mismo contrato de accesibilidad que el resto de modales: foco inicial,
  // Escape, trampa de tabulación y bloqueo del scroll de fondo.
  useEffect(() => {
    if (!producto) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const f = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
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
  }, [producto, onClose]);

  // Las etiquetas van en hoja A4 con margen: es papel adhesivo normal, no
  // térmico continuo como el comprobante.
  const handlePrint = useCallback(() => {
    const root = document.documentElement;
    root.style.setProperty('--print-page-size', 'A4');
    root.style.setProperty('--print-page-margin', '8mm');
    window.print();
  }, []);

  if (!producto) return null;

  const t = TAMANOS.find(x => x.id === tamano)!;
  const total = Math.max(1, Math.min(200, copias));
  const etiquetas = Array.from({ length: total }, (_, i) => i);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Etiquetas de ${producto.name}`}
        className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="print-hide bg-slate-800 px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-white font-bold text-sm">
            <Tag className="w-4 h-4 text-indigo-400" />
            Etiquetas · {producto.name}
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

        {/* Controles */}
        <div className="print-hide bg-slate-800/60 px-4 py-3 border-b border-slate-700 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label htmlFor="etq-copias" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Cantidad
            </label>
            <input
              id="etq-copias"
              type="number"
              min={1}
              max={200}
              value={copias}
              onChange={e => setCopias(Number(e.target.value) || 1)}
              className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
            />
          </div>

          <div className="space-y-1">
            <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Tamaño</span>
            <div className="flex gap-1.5">
              {TAMANOS.map(x => (
                <button
                  key={x.id}
                  onClick={() => setTamano(x.id)}
                  aria-pressed={tamano === x.id}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    tamano === x.id
                      ? 'bg-indigo-600 text-white border-transparent'
                      : 'bg-transparent text-slate-300 border-slate-600 hover:bg-slate-700'
                  }`}
                >
                  {x.label}
                  <span className="block text-[10px] font-normal opacity-70">{x.ancho}×{x.alto} mm</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={conPrecio} onChange={e => setConPrecio(e.target.checked)} />
              Mostrar precio
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={conCodigo} onChange={e => setConCodigo(e.target.checked)} />
              Mostrar código interno
            </label>
          </div>
        </div>

        {/* Vista previa · es también lo que se imprime (print-labels) */}
        <div className="p-5 bg-slate-950 overflow-y-auto max-h-[55vh]">
          <div
            className="print-labels bg-white rounded p-2 flex flex-wrap gap-1"
            style={{ gap: '2mm' }}
          >
            {etiquetas.map(i => (
              <div
                key={i}
                className="etiqueta border border-slate-300 rounded-sm flex flex-col items-center justify-between text-slate-900 overflow-hidden"
                style={{
                  width: `${t.ancho}mm`,
                  height: `${t.alto}mm`,
                  padding: '1.2mm',
                  fontSize: `${t.fuente}pt`,
                  lineHeight: 1.15,
                }}
              >
                <div className="w-full text-center font-bold truncate" style={{ maxWidth: '100%' }}>
                  {producto.name}
                </div>

                <Barcode value={producto.barcode} alto={t.barras} className="text-slate-900 w-full" />

                <div className="w-full flex items-center justify-between gap-1" style={{ fontSize: `${t.fuente - 0.5}pt` }}>
                  <span className="truncate">{conCodigo ? producto.code : ''}</span>
                  {conPrecio && (
                    <span className="font-extrabold whitespace-nowrap">
                      {formatCents(producto.price_cents, symbol)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="print-hide bg-slate-800 p-4 border-t border-slate-700 flex justify-between items-center">
          <span className="text-xs text-slate-400">
            {total} {total === 1 ? 'etiqueta' : 'etiquetas'} · {t.ancho}×{t.alto} mm
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white text-xs font-semibold">
              Cerrar
            </button>
            <button
              onClick={handlePrint}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
            >
              <Printer className="w-4 h-4" /> Imprimir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
