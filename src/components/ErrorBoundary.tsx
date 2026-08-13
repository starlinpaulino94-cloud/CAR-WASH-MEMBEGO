import React from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { resetAppStorage } from '../lib/storage';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Frontera de error de la raíz.
 *
 * Antes, cualquier excepción no capturada —incluida la que lanzaba la hidratación
 * de localStorage durante el primer render— desmontaba la aplicación entera y
 * dejaba una pantalla en blanco irrecuperable para el usuario, en mitad de un
 * cobro y sin ninguna vía de salida que no fuese abrir las herramientas de
 * desarrollo del navegador.
 *
 * Debe envolver al AppProvider, no ir dentro: los fallos de hidratación ocurren
 * al construir el estado del proveedor.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Punto de enganche para el seguimiento de errores (Sentry o equivalente),
    // pendiente según la sección 12 de la auditoría. Hoy no hay observabilidad,
    // así que al menos queda en la consola del dispositivo.
    console.error('[ErrorBoundary] Fallo no capturado:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    resetAppStorage();
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-canvas text-strong flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-lg bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-danger/40 border-b border-danger/30 px-6 py-4 flex items-center gap-3">
            <div className="p-2 bg-danger/20 text-danger rounded-xl border border-danger/30">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-strong">La aplicación no pudo continuar</h1>
              <p className="text-xs text-muted">Se detuvo para no seguir operando en un estado incoherente</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <p className="text-sm text-body leading-relaxed">
              Ocurrió un error inesperado. Los datos guardados en este dispositivo no se han
              borrado. Intente recargar; si el problema se repite al abrir la aplicación, es
              probable que los datos locales estén dañados y haya que restablecerlos.
            </p>

            <div className="p-3 bg-canvas rounded-xl border border-line">
              <div className="text-xs font-bold text-faint uppercase tracking-wider mb-1">
                Detalle técnico
              </div>
              <code className="text-xs text-danger font-mono break-words">
                {error.name}: {error.message}
              </code>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Recargar la aplicación
              </button>
              <button
                onClick={this.handleReset}
                className="flex-1 py-2.5 px-4 bg-surface-2 hover:bg-surface-3 text-body border border-line-strong font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4 text-danger" /> Restablecer datos locales
              </button>
            </div>

            <p className="text-xs text-faint leading-relaxed">
              Restablecer aparta los datos actuales bajo un nombre de respaldo en el
              almacenamiento del navegador en lugar de eliminarlos, de modo que un técnico
              todavía pueda recuperarlos.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
