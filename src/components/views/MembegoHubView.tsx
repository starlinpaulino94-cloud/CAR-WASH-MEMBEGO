import React, { useState } from 'react';
import { QrCode, RefreshCw, Wifi, WifiOff, ShieldCheck, CheckCircle2, AlertTriangle, Layers, Cpu } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { membegoApiService } from '../../services/membegoApi';

export const MembegoHubView: React.FC = () => {
  const { isMembegoOnline, toggleMembegoOnline, addAuditLog } = useApp();

  const [qrQuery, setQrQuery] = useState('mbg-usr-9001');
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const logs = membegoApiService.getSyncLogs();

  const runTestVerification = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await membegoApiService.verifyMembegoCustomer(qrQuery);
      setTestResult(res);
      addAuditLog('TEST_MEMBEGO_API', 'MembegoApi', `Prueba de verificación realizada para query: ${qrQuery}`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <QrCode className="w-5 h-5 text-brand" /> Membego Core API Integration Hub
          </h2>
          <p className="text-xs text-muted">Pruebas de sincronización, idempotencia y resiliencia offline</p>
        </div>

        {/* Toggle Switch */}
        <div className="flex items-center gap-3 bg-surface border border-line p-2 rounded-2xl">
          <span className="text-xs font-bold text-body">Estado Conexión:</span>
          <button
            onClick={toggleMembegoOnline}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              isMembegoOnline ? 'bg-success text-on-accent shadow-lg shadow-success/30' : 'bg-warning text-on-accent'
            }`}
          >
            {isMembegoOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isMembegoOnline ? 'API En Línea' : 'Modo Contingencia'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Bench */}
        <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-brand" /> Banco de Pruebas de Redención
          </h3>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-muted uppercase">Código QR o Membego Customer ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={qrQuery}
                  onChange={e => setQrQuery(e.target.value)}
                  className="flex-1 bg-canvas border border-line rounded-xl p-2.5 text-strong font-mono"
                />
                <button
                  onClick={runTestVerification}
                  disabled={loading}
                  className="px-4 py-2.5 bg-brand hover:bg-brand text-on-accent font-bold rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Probar'}
                </button>
              </div>
            </div>

            {testResult && (
              <div className="p-3 bg-canvas rounded-xl border border-line space-y-2 font-mono text-xs">
                <div className="text-muted">Respuesta de api.membego.com:</div>
                <pre className="text-success overflow-x-auto p-2 bg-surface rounded border border-line">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Sync Logs */}
        <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
            Bitácora de Sincronización & Idempotencia
          </h3>

          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <div className="text-center py-8 text-xs text-faint italic">No hay logs de sincronización aún</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="p-3 bg-canvas rounded-xl border border-line text-xs space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-brand-hi uppercase">{log.action}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${log.status === 'success' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                      {log.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-muted font-mono">IdempotencyKey: {log.idempotencyKey}</div>
                  <div className="text-xs text-faint">{new Date(log.timestamp).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
