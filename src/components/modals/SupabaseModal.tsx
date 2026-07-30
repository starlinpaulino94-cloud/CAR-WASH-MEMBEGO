import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, AlertCircle, Copy, RefreshCw, Key, Globe, Shield, ExternalLink, Check } from 'lucide-react';
import { getSupabaseConfig, setSupabaseConfig, clearSupabaseConfig, testSupabaseConnection, SUPABASE_SQL_SCHEMA_SCRIPT, SupabaseTestResult } from '../../lib/supabase';
import { supabaseSyncService } from '../../services/supabaseSync';
import { useApp } from '../../context/AppContext';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseModal: React.FC<SupabaseModalProps> = ({ isOpen, onClose }) => {
  const { workOrders, customers, invoices, cashSession, expenses, auditLogs, addAuditLog } = useApp();

  const [urlInput, setUrlInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SupabaseTestResult | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'sql'>('config');
  const [copied, setCopied] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      const config = getSupabaseConfig();
      setUrlInput(config.url);
      setKeyInput(config.anonKey);
      if (config.isConfigured) {
        handleTest();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    setSupabaseConfig(urlInput, keyInput);
    addAuditLog('CONFIGURAR_SUPABASE', 'System', `Credenciales de Supabase actualizadas. URL: ${urlInput}`);
    handleTest();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setSyncSuccessMsg('');
    try {
      // Temporary save to test
      setSupabaseConfig(urlInput, keyInput);
      const res = await testSupabaseConnection();
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        connected: false,
        message: `Error al probar la conexión: ${err.message}`
      });
    } finally {
      setTesting(false);
    }
  };

  const handleClear = () => {
    clearSupabaseConfig();
    setUrlInput('');
    setKeyInput('');
    setTestResult(null);
    addAuditLog('LIMPIAR_SUPABASE', 'System', 'Credenciales de Supabase eliminadas.');
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA_SCRIPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSyncAllData = async () => {
    setSyncingAll(true);
    setSyncSuccessMsg('');
    try {
      let syncedCount = 0;
      for (const cust of customers) {
        if (await supabaseSyncService.syncCustomer(cust)) syncedCount++;
      }
      for (const order of workOrders) {
        if (await supabaseSyncService.syncWorkOrder(order)) syncedCount++;
      }
      for (const inv of invoices) {
        if (await supabaseSyncService.syncInvoice(inv)) syncedCount++;
      }
      for (const exp of expenses) {
        if (await supabaseSyncService.syncExpense(exp)) syncedCount++;
      }
      if (cashSession) {
        await supabaseSyncService.syncCashSession(cashSession);
      }

      setSyncSuccessMsg(`¡Sincronización masiva completada exitosamente! (${syncedCount} registros exportados a Supabase)`);
      addAuditLog('SINCRONIZACION_MASIVA_SUPABASE', 'Database', `Se sincronizaron ${syncedCount} registros a Supabase Cloud`);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Conexión Oficial Supabase Cloud
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-extrabold">
                  PostgreSQL
                </span>
              </h3>
              <p className="text-xs text-slate-400">Configura tus API keys para persistencia PostgreSQL en tiempo real</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 gap-4 text-xs font-bold">
          <button
            onClick={() => setActiveTab('config')}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'config' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500'
            }`}
          >
            <Key className="w-3.5 h-3.5" /> Credenciales y Conexión API
          </button>
          <button
            onClick={() => setActiveTab('sql')}
            className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'sql' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500'
            }`}
          >
            <Copy className="w-3.5 h-3.5" /> Script SQL de Tablas
          </button>
        </div>

        {activeTab === 'config' ? (
          <div className="space-y-4">
            {/* Status Card */}
            {testResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 ${
                  testResult.connected
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                }`}
              >
                {testResult.connected ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-bold">{testResult.message}</div>
                  {testResult.errorDetails && (
                    <div className="text-[10px] opacity-80 font-mono bg-slate-950/60 p-1.5 rounded border border-slate-800">
                      {testResult.errorDetails}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Inputs */}
            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300 flex items-center gap-1.5 uppercase text-[10px]">
                  <Globe className="w-3.5 h-3.5 text-indigo-400" /> Supabase Project URL
                </label>
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://xyzprojectid.supabase.co"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300 flex items-center gap-1.5 uppercase text-[10px]">
                  <Key className="w-3.5 h-3.5 text-amber-400" /> Supabase Anon / Public Key (apiKey)
                </label>
                <input
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={handleClear}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Limpiar Credenciales
              </button>

              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing || !urlInput || !keyInput}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5"
                >
                  {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Probar Conexión
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Guardar Conexión
                </button>
              </div>
            </div>

            {/* Mass Sync Button */}
            {testResult?.connected && (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">Sincronizar base de datos local con Supabase</div>
                    <div className="text-[10px] text-slate-400">Exporta clientes, órdenes de trabajo, facturas y gastos a Supabase PostgreSQL.</div>
                  </div>
                  <button
                    onClick={handleSyncAllData}
                    disabled={syncingAll}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5"
                  >
                    {syncingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Sincronizar Ahora
                  </button>
                </div>
                {syncSuccessMsg && (
                  <div className="text-[11px] text-emerald-400 font-bold border-t border-slate-800 pt-1.5">
                    {syncSuccessMsg}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* SQL Tab */
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Copia y pega este script en el <strong>SQL Editor</strong> de tu proyecto Supabase:</span>
              <button
                onClick={handleCopySql}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg flex items-center gap-1 text-xs"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '¡Copiado!' : 'Copiar Script SQL'}
              </button>
            </div>
            <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-[300px]">
              {SUPABASE_SQL_SCHEMA_SCRIPT}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
