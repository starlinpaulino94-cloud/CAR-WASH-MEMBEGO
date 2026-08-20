import React from 'react';
import { X, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { InlineAlert } from './DataViewShell';

/**
 * Diálogo modal para formularios de alta (servicio, producto, bahía).
 *
 * Desde el reemplazo por b0 monta sobre el Dialog de shadcn (Base UI), que trae
 * el foco, el Escape y el clic fuera resueltos y auditados. La API pública no
 * cambió: las vistas siguen montándolo condicionalmente y pasándole onClose.
 * El cierre sigue bloqueado mientras hay una operación en curso —el open es
 * fijo y el onOpenChange lo ignora si busy—, para no perder un alta a medias.
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
}> = ({ title, submitLabel, busy = false, error, onSubmit, onClose, onDismissError, wide = false, children }) => (
  <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent
      showCloseButton={false}
      className={`flex ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[90vh] flex-col gap-0 overflow-hidden p-0`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <DialogTitle className="font-bold text-strong text-sm">{title}</DialogTitle>
        <Button
          type="button" variant="ghost" size="icon-sm" aria-label="Cerrar" disabled={busy}
          onClick={() => { if (!busy) onClose(); }}
        >
          <X />
        </Button>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); if (!busy) onSubmit(); }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="space-y-4 overflow-y-auto p-5">
          {error && <InlineAlert tone="error" onDismiss={onDismissError}>{error}</InlineAlert>}
          {children}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-muted/50 px-5 py-3.5">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (!busy) onClose(); }}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <><Loader2 className="animate-spin" /> Guardando…</> : submitLabel}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
);

/** Campo de texto etiquetado, uniforme en los formularios de alta. */
export const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}> = ({ label, children, hint, htmlFor }) => (
  <div className="space-y-1">
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-muted uppercase tracking-wide">
      {label}
    </label>
    {children}
    {hint && <p className="text-sm text-faint">{hint}</p>}
  </div>
);

/**
 * La clase de campo de shadcn (ver src/components/ui/input.tsx), sin altura
 * fija porque aquí también viste <select> y <textarea>.
 */
export const textInputClass =
  'w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
