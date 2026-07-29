import React, { useCallback, useEffect, useState } from 'react';
import { QrCode, Loader2, Cpu, FlaskConical, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { membegoApiService } from '../../services/membegoApi';
import { fetchMembegoLogs, recordMembegoLog, MembegoSyncLog } from '../../data/adminRepository';
import { ViewHeader, ErrorState, InlineAlert } from '../common/DataViewShell';

/**
 * Banco de pruebas de la integración Membego.
 *
 * Aquí hay que ser explícito: **no existe una API de Membego**. Lo que responde
 * es el simulador en el cliente (`services/membegoApi.ts`), con un directorio
 * ficticio. Migrar la integración de verdad exige antes el contrato real del
 * proveedor, que no tenemos.
 *
 * Lo que sí es real y se migró: la bitácora de intentos, que antes vivía en
 * memoria y se perdía al refrescar (§7.6). Ahora se persiste en una tabla de
 * solo inserción, con el actor y la hora puestos por el servidor, de modo que
 * el día que exista la API el registro de diagnóstico ya está en su sitio.
 */
export const MembegoHubSupabaseView: React.FC = () => {
  const { company, branch } = useAuth();

  const [query, setQuery] = useState('mbg-usr-9001');
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<MembegoSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setLogs(await fetchMembegoLogs()); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cargar la bitácora'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    if (!company || running) return;
    setRunning(true); setResult(null); setActionError(null);
    try {
      const response = await membegoApiService.verifyMembegoCustomer(query);
      setResult(response);
      // El intento se registra pase lo que pase: una bitácora que solo guarda
      // los éxitos no sirve para diagnosticar nada.
      await recordMembegoLog({
        companyId: company.id, branchId: branch?.id ?? null,
        action: 'validate_qr',
        status: response.success ? 'success' : 'failed',
        request: { query },
        response: JSON.parse(JSON.stringify(response)),
        errorMessage: response.success ? null : response.message
      });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'La prueba falló');
    } finally {
      setRunning(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => void load()} title="No se pudo cargar la bitácora" />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        icon={<QrCode className="w-5 h-5 text-indigo-400" />}
        title="Integración Membego"
        subtitle="Banco de pruebas y bitácora de sincronización"
      />

      <div role="status" className="flex items-start gap-3 p-4 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-100">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Esto no consulta a Membego.</p>
          <p className="text-amber-200/90 leading-relaxed">
            Las respuestas vienen de un simulador que se ejecuta en este navegador, con un
            directorio ficticio. Conectar la integración real exige el contrato de la API
            del proveedor. Lo que sí es real es la bitácora: cada intento queda registrado
            en la base de datos y no se puede alterar.
          </p>
        </div>
      </div>

      {actionError && <InlineAlert tone="error" onDismiss={() => setActionError(null)}>{actionError}</InlineAlert>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-indigo-400" /> Banco de pruebas
          </h3>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label htmlFor="mb-query" className="font-semibold text-slate-400 uppercase">
                Código QR o identificador de socio
              </label>
              <div className="flex gap-2">
                <input id="mb-query" type="text" value={query} disabled={running}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void run(); }}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
                <button onClick={() => void run()} disabled={running || !query.trim()}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl flex items-center gap-1.5">
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cpu className="w-3.5 h-3.5" />}
                  Probar
                </button>
              </div>
            </div>

            {result !== null && (
              <div className="space-y-1">
                <span className="text-slate-400">Respuesta del simulador:</span>
                <pre className="text-emerald-400 overflow-x-auto p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] max-h-64">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
            Bitácora de sincronización
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-950 rounded-xl border border-slate-800 animate-pulse" />
              ))
            ) : logs.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-500 italic">
                Aún no se ha registrado ningún intento de sincronización.
              </p>
            ) : logs.map(log => (
              <article key={log.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
                <div className="flex justify-between items-center gap-2">
                  <span className="font-bold text-indigo-300 uppercase">{log.action}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    log.status === 'success'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {log.status.toUpperCase()}
                  </span>
                </div>
                {log.error_message && (
                  <p className="text-[11px] text-rose-300/90">{log.error_message}</p>
                )}
                <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                  <span>{new Date(log.occurred_at).toLocaleString('es-DO')}</span>
                  {log.idempotency_key && <span className="font-mono truncate">{log.idempotency_key}</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
