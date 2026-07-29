import React, { useCallback, useEffect, useState } from 'react';
import { Warehouse, Loader2, Wrench, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchAllBays, setBayStatus, Bay, BayStatus } from '../../data/adminRepository';
import { ViewHeader, ErrorState, InlineAlert } from '../common/DataViewShell';

const TONE: Record<BayStatus, string> = {
  disponible:    'bg-slate-900 border-slate-800',
  ocupada:       'bg-indigo-950/40 border-indigo-500/50',
  mantenimiento: 'bg-amber-950/40 border-amber-500/50',
  limpieza:      'bg-sky-950/40 border-sky-500/50'
};

const BADGE: Record<BayStatus, string> = {
  disponible:    'bg-emerald-500/20 text-emerald-400',
  ocupada:       'bg-indigo-500/20 text-indigo-300',
  mantenimiento: 'bg-amber-500/20 text-amber-300',
  limpieza:      'bg-sky-500/20 text-sky-300'
};

/**
 * Estaciones de lavado.
 *
 * La ocupación ya no se toca a mano: la escribe el flujo de órdenes
 * (`advance_work_order`). Aquí solo se marca una bahía fuera de servicio o se
 * devuelve al trabajo, y una bahía ocupada no se puede liberar por aquí —
 * eso significaría abandonar un vehículo dentro sin cerrar su orden.
 */
export const BaysSupabaseView: React.FC = () => {
  const { branch } = useAuth();
  const [bays, setBays] = useState<Bay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true); setError(null);
    try { setBays(await fetchAllBays(branch.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar las bahías'); }
    finally { setLoading(false); }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const change = async (bay: Bay, status: BayStatus) => {
    setBusyId(bay.id); setActionError(null);
    try { await setBayStatus(bay.id, status); await load(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'No se pudo cambiar el estado'); }
    finally { setBusyId(null); }
  };

  if (error) return <ErrorState message={error} onRetry={() => void load()} title="No se pudieron cargar las bahías" />;

  const free = bays.filter(b => b.status === 'disponible').length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Warehouse className="w-5 h-5 text-indigo-400" />}
        title="Bahías y estaciones"
        subtitle={loading ? branch?.name : `${branch?.name} · ${free} de ${bays.length} libres`}
      />

      {actionError && <InlineAlert tone="error" onDismiss={() => setActionError(null)}>{actionError}</InlineAlert>}

      <InlineAlert tone="warning">
        La ocupación la gestiona el tablero de operación al iniciar y terminar cada lavado.
        Desde aquí solo se marca una bahía fuera de servicio.
      </InlineAlert>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : bays.length === 0 ? (
        <p className="text-center py-12 text-sm text-slate-500 italic">
          Esta sucursal no tiene bahías registradas.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bays.map(bay => {
            const busy = busyId === bay.id;
            const occupied = bay.status === 'ocupada';
            return (
              <article key={bay.id} className={`p-4 rounded-2xl border space-y-3 ${TONE[bay.status]}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-sm text-white">{bay.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${BADGE[bay.status]}`}>
                    {bay.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 uppercase">{bay.type}</p>

                {occupied && (
                  <p className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300">
                    Hay un vehículo en servicio. Se liberará al moverlo en el tablero.
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  {bay.status === 'mantenimiento' ? (
                    <button onClick={() => void change(bay, 'disponible')} disabled={busy}
                      className="flex-1 py-1.5 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white font-bold text-xs rounded-lg border border-emerald-500/30 disabled:opacity-50 flex items-center justify-center gap-1.5">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Volver al servicio
                    </button>
                  ) : (
                    <button onClick={() => void change(bay, 'mantenimiento')} disabled={busy || occupied}
                      title={occupied ? 'Hay un vehículo dentro' : undefined}
                      className="flex-1 py-1.5 bg-amber-600/30 hover:bg-amber-600 text-amber-300 hover:text-white font-bold text-xs rounded-lg border border-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                      Fuera de servicio
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
