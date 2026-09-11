import React, { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, MinusCircle, Stethoscope } from 'lucide-react';
import {
  diagnosticarMembego, DiagnosticoMembego as Informe, PasoDiagnostico
} from '../../data/membegoRepository';

/**
 * «Por qué falla Membego», contestado en la propia pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * Cuando el mostrador ve «no se pudo consultar Membego», la causa puede ser una
 * variable sin poner, dos proyectos de Supabase distintos, una sesión vencida,
 * un rol sin permiso, una migración sin aplicar o una credencial rechazada.
 * Todas se ven igual: un aviso amarillo. Este botón las separa y dice cuál es.
 *
 * Lo pulsa el que tiene el problema, no el que tiene el cargo: dos de las
 * comprobaciones dependen de quién llama, así que el diagnóstico del dueño no
 * sirve para explicar el fallo del cajero.
 */

const ICONO: Record<PasoDiagnostico['estado'], React.ReactNode> = {
  ok: <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />,
  falla: <XCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />,
  aviso: <XCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />,
  omitido: <MinusCircle className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
};

interface Props {
  /**
   * El cliente abierto en la pantalla, si lo hay. Con él se prueba además la
   * llamada real a Membego — la única que reproduce el fallo del mostrador.
   */
  membegoCustomerId?: string | null;
  /** `compacto` para la caja (cabe al lado del cliente); suelto para Ajustes. */
  compacto?: boolean;
}

export const DiagnosticoMembego: React.FC<Props> = ({ membegoCustomerId, compacto = false }) => {
  const [informe, setInforme] = useState<Informe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);

  const correr = async () => {
    if (corriendo) return;
    setCorriendo(true);
    setError(null);
    try {
      setInforme(await diagnosticarMembego(membegoCustomerId));
    } catch (e) {
      setInforme(null);
      setError(e instanceof Error ? e.message : 'No se pudo diagnosticar.');
    } finally {
      setCorriendo(false);
    }
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={correr} disabled={corriendo}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 font-bold text-strong disabled:opacity-50 hover:bg-surface-3 transition-colors ${
          compacto ? 'px-2.5 py-1 text-xs' : 'px-3 py-2 text-sm'
        }`}>
        {corriendo
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Stethoscope className="w-3.5 h-3.5" />}
        {corriendo ? 'Comprobando…' : 'Diagnosticar Membego'}
      </button>

      {error && <p className="text-xs text-danger">{error}</p>}

      {informe && (
        <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2">
          {/* El resumen va primero y en una sola frase: es lo que se lee en voz
              alta por teléfono cuando el cajero llama al dueño. */}
          <p className={`text-xs font-bold ${informe.ok ? 'text-success' : 'text-danger'}`}>
            {informe.resumen}
          </p>

          <ul className="space-y-1.5">
            {informe.pasos.map(p => (
              <li key={p.clave} className="flex items-start gap-2">
                {ICONO[p.estado]}
                <div className="min-w-0">
                  <p className="text-xs font-bold text-strong">{p.titulo}</p>
                  <p className="text-xs text-muted break-words">{p.detalle}</p>
                  {/* El arreglo solo aparece cuando hay algo que arreglar.
                      Repetir instrucciones bajo los pasos en verde convertiría
                      el informe en un muro que nadie lee. */}
                  {p.arreglo && p.estado === 'falla' && (
                    <p className="text-xs text-warning mt-0.5 break-words">{p.arreglo}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-muted">API de Membego: {informe.apiMembego}</p>
        </div>
      )}
    </div>
  );
};
