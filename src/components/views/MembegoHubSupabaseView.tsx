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
        icon={<QrCode className="w-5 h-5 text-brand" />}
        title="Integración Membego"
        subtitle="Banco de pruebas y bitácora de sincronización"
      />

      <div role="status" className="flex items-start gap-3 p-4 bg-warning/40 border border-warning/40 rounded-xl text-xs text-warning">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-warning mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Esto no consulta a Membego.</p>
          <p className="text-warning/90 leading-relaxed">
            Las respuestas vienen de un simulador que se ejecuta en este navegador, con un
            directorio ficticio. Conectar la integración real exige el contrato de la API
            del proveedor. Lo que sí es real es la bitácora: cada intento queda registrado
            en la base de datos y no se puede alterar.
          </p>
        </div>
      </div>

      {actionError && <InlineAlert tone="error" onDismiss={() => setActionError(null)}>{actionError}</InlineAlert>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-brand" /> Banco de pruebas
          </h3>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label htmlFor="mb-query" className="font-semibold text-muted uppercase">
                Código QR o identificador de socio
              </label>
              <div className="flex gap-2">
                <input id="mb-query" type="text" value={query} disabled={running}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void run(); }}
                  className="flex-1 bg-canvas border border-line rounded-xl p-2.5 text-strong font-mono focus:outline-none focus:border-brand disabled:opacity-50" />
                <button onClick={() => void run()} disabled={running || !query.trim()}
                  className="px-4 py-2.5 bg-brand hover:bg-brand disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold rounded-xl flex items-center gap-1.5">
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cpu className="w-3.5 h-3.5" />}
                  Probar
                </button>
              </div>
            </div>

            {result !== null && (
              <div className="space-y-1">
                <span className="text-muted">Respuesta del simulador:</span>
                <pre className="text-success overflow-x-auto p-3 bg-canvas rounded-xl border border-line text-xs max-h-64">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>

        <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
            Bitácora de sincronización
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-canvas rounded-xl border border-line animate-pulse" />
              ))
            ) : logs.length === 0 ? (
              <p className="text-center py-8 text-xs text-faint italic">
                Aún no se ha registrado ningún intento de sincronización.
              </p>
            ) : logs.map(log => (
              <article key={log.id} className="p-3 bg-canvas rounded-xl border border-line text-xs space-y-1">
                <div className="flex justify-between items-center gap-2">
                  <span className="font-bold text-brand-hi uppercase">{log.action}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                    log.status === 'success'
                      ? 'bg-success/20 text-success'
                      : 'bg-danger/20 text-danger'
                  }`}>
                    {log.status.toUpperCase()}
                  </span>
                </div>
                {log.error_message && (
                  <p className="text-xs text-danger/90">{log.error_message}</p>
                )}
                <div className="text-xs text-faint flex justify-between gap-2">
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
