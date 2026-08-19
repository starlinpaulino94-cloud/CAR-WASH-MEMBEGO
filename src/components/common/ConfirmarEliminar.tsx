import React, { useState } from 'react';
import { AlertTriangle, Loader2, Archive, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { ErrorBorrado } from '../../data/adminRepository';

/**
 * Confirmar un borrado, y ofrecer archivar cuando la base se niega.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS DOS «NO» SE CUENTAN DISTINTO
 *
 * La base rechaza un borrado por dos motivos que no se parecen en nada, y
 * enseñarlos igual dejaría al usuario sin saber qué hacer:
 *
 *   · Tiene historia (un cliente con facturas). Aquí SÍ hay salida: archivarlo.
 *     El diálogo la ofrece en el sitio, sin cerrarse y sin obligar a buscar otro
 *     botón — el usuario ya dijo lo que quería, que es que deje de estorbar.
 *   · El rol no alcanza. Aquí no hay nada que ofrecer, y fingir que sí sería
 *     peor. Se dice y se cierra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL BOTÓN NO ES EL DE SIEMPRE
 *
 * Es rojo y dice «Eliminar», no «Aceptar». Un diálogo de confirmación cuyo botón
 * dice «Aceptar» se acepta sin leerlo; uno que nombra la acción destructiva se
 * lee. Y el nombre de lo que se va a borrar va en el texto, no solo en el
 * título: es la última oportunidad de darse cuenta de que es otra fila.
 */

interface Props {
  /** Qué se va a borrar, con su nombre. Aparece en el texto, no solo arriba. */
  nombre: string;
  /** «el cliente», «el servicio»… Va delante del nombre. */
  queEs: string;
  onEliminar: () => Promise<void>;
  /** Si se puede archivar, la salida cuando el borrado se niega por historia. */
  onArchivar?: () => Promise<void>;
  onCerrar: () => void;
  /** Se llama cuando algo salió bien, para que la vista recargue. */
  onHecho: () => void;
}

export const ConfirmarEliminar: React.FC<Props> = ({
  nombre, queEs, onEliminar, onArchivar, onCerrar, onHecho
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** true cuando el borrado se negó por historia y archivar es la salida. */
  const [ofrecerArchivar, setOfrecerArchivar] = useState(false);

  const intentarBorrar = async () => {
    setBusy(true);
    setError(null);
    try {
      await onEliminar();
      onHecho();
      onCerrar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo eliminar.';
      setError(msg);
      // Solo se ofrece archivar si de verdad es la salida: con un «su rol no lo
      // permite», archivar tampoco va a funcionar y ofrecerlo sería una tomadura
      // de pelo.
      setOfrecerArchivar(
        e instanceof ErrorBorrado && e.motivo === 'con_historia' && onArchivar !== undefined
      );
    } finally {
      setBusy(false);
    }
  };

  const archivar = async () => {
    if (!onArchivar) return;
    setBusy(true);
    setError(null);
    try {
      await onArchivar();
      onHecho();
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar.');
      setOfrecerArchivar(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onCerrar(); }}>
      <DialogContent showCloseButton={false} className="flex max-w-md flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <DialogTitle className="font-bold text-strong text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            Eliminar {queEs}
          </DialogTitle>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar" disabled={busy}
            onClick={() => { if (!busy) onCerrar(); }}>
            <X />
          </Button>
        </div>

        <div className="p-5 space-y-3">
          {!error && (
            <>
              <p className="text-sm text-body">
                Se va a eliminar {queEs} <strong className="text-strong">{nombre}</strong>.
                Esto no se puede deshacer.
              </p>
              <p className="text-xs text-faint">
                Si tiene facturas, órdenes o movimientos, la base lo va a impedir y le
                ofrecerá archivarlo.
              </p>
            </>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm text-warning">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-muted/50 px-5 py-3.5">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (!busy) onCerrar(); }}>
            {error ? 'Cerrar' : 'Cancelar'}
          </Button>

          {ofrecerArchivar && (
            <Button type="button" disabled={busy} onClick={() => void archivar()}>
              {busy ? <Loader2 className="animate-spin" /> : <Archive />}
              Archivar
            </Button>
          )}

          {!error && (
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void intentarBorrar()}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Eliminar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
