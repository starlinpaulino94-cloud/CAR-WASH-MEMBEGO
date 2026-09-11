import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Panel lateral de detalle: el drill-down de un KPI o de una fila.
 *
 * Cada vista maquetaba su propio panel; este es uno solo, con foco atrapado y
 * Escape como los modales. Se abre desde la derecha para no perder de vista la
 * tabla que lo originó: el número de arriba y los registros que lo forman se
 * miran juntos.
 */
export const PanelDetalle: React.FC<{
  abierto: boolean;
  titulo: string;
  subtitulo?: string;
  onCerrar: () => void;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}> = ({ abierto, titulo, subtitulo, onCerrar, acciones, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previo?.focus(); };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-canvas/70 backdrop-blur-sm" onClick={onCerrar} aria-hidden="true" />
      <div ref={ref} tabIndex={-1}
        className="relative bg-surface border-l border-line w-full max-w-2xl h-full shadow-2xl flex flex-col outline-none">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-strong truncate">{titulo}</h2>
            {subtitulo && <p className="text-xs text-muted mt-0.5">{subtitulo}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {acciones}
            <Button variant="ghost" size="icon-sm" onClick={onCerrar} aria-label="Cerrar">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
};
