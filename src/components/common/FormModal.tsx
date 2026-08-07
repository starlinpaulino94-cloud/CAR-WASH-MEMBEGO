import React, { useEffect, useId, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { InlineAlert } from './DataViewShell';

/**
 * Diálogo modal para formularios de alta (servicio, producto, bahía).
 *
 * Accesible: role="dialog", aria-modal, cierre con Escape y foco llevado al
 * panel al abrir. El botón de guardar y el cierre se bloquean mientras hay una
 * operación en curso, para no lanzar dos altas por doble clic.
 */
export const FormModal: React.FC<{
  title: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: () => void;
  onClose: () => void;
  onDismissError?: () => void;
  /** Diálogo ancho para formularios con renglones (compras, recetas). */
  wide?: boolean;
  children: React.ReactNode;
}> = ({ title, submitLabel, busy = false, error, onSubmit, onClose, onDismissError, wide = false, children }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col focus:outline-none`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 id={titleId} className="font-bold text-white text-sm">{title}</h2>
          <button
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            aria-label="Cerrar"
            className="p-1 text-slate-400 hover:text-white disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); if (!busy) onSubmit(); }}
          className="flex flex-col min-h-0"
        >
          <div className="p-5 space-y-4 overflow-y-auto">
            {error && <InlineAlert tone="error" onDismiss={onDismissError}>{error}</InlineAlert>}
            {children}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3.5">
            <button
              type="button"
              onClick={() => { if (!busy) onClose(); }}
              disabled={busy}
              className="px-4 py-2 text-sm font-bold text-slate-300 hover:text-white disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold text-sm rounded-xl flex items-center gap-2"
            >
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</> : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/** Campo de texto etiquetado, uniforme en los formularios de alta. */
export const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}> = ({ label, children, hint, htmlFor }) => (
  <div className="space-y-1">
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-400 uppercase tracking-wide">
      {label}
    </label>
    {children}
    {hint && <p className="text-sm text-slate-500">{hint}</p>}
  </div>
);

export const textInputClass =
  'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500';
