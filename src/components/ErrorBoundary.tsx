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
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-rose-950/40 border-b border-rose-500/30 px-6 py-4 flex items-center gap-3">
            <div className="p-2 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-white">La aplicación no pudo continuar</h1>
              <p className="text-xs text-slate-400">Se detuvo para no seguir operando en un estado incoherente</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <p className="text-sm text-slate-300 leading-relaxed">
              Ocurrió un error inesperado. Los datos guardados en este dispositivo no se han
              borrado. Intente recargar; si el problema se repite al abrir la aplicación, es
              probable que los datos locales estén dañados y haya que restablecerlos.
            </p>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Detalle técnico
              </div>
              <code className="text-xs text-rose-300 font-mono break-words">
                {error.name}: {error.message}
              </code>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Recargar la aplicación
              </button>
              <button
                onClick={this.handleReset}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4 text-rose-400" /> Restablecer datos locales
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
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
