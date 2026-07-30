import React from 'react';
import { Settings, Building2, Printer, Database, Key, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getSupabaseConfig } from '../../lib/supabase';

export const SettingsView: React.FC = () => {
  const { company, branches, setIsSupabaseModalOpen } = useApp();
  const supabaseConfig = getSupabaseConfig();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-indigo-400" /> Configuración General de Empresa & Impresión
        </h2>
        <p className="text-xs text-slate-400">Ajustes de sucursales, moneda, ITBIS, base de datos Supabase y formato de tickets térmicos</p>
      </div>

      {/* Supabase Integration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400 font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                Base de Datos PostgreSQL Cloud (Supabase)
                {supabaseConfig.isConfigured && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                    Conectado
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">Persistencia multitenant de órdenes, clientes, facturas y sesiones en tiempo real</p>
            </div>
          </div>

          <button
            onClick={() => setIsSupabaseModalOpen(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition-colors"
          >
            <Key className="w-4 h-4" />
            {supabaseConfig.isConfigured ? 'Gestionar Credenciales Supabase' : 'Conectar Supabase Ahora'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px]">URL del Proyecto Supabase</div>
            <div className="font-mono text-emerald-400 font-semibold truncate mt-0.5">
              {supabaseConfig.url || 'No configurado (Modo almacenamiento local)'}
            </div>
          </div>
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px]">Clave Pública Anon API</div>
            <div className="font-mono text-emerald-400 font-semibold truncate mt-0.5">
              {supabaseConfig.anonKey ? '••••••••••••••••••••••••' : 'No configurado'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Datos de la Empresa</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-400">Nombre Comercial</label>
            <input type="text" value={company.tradeName} disabled className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-bold mt-1" />
          </div>
          <div>
            <label className="text-slate-400">RNC / Tax ID</label>
            <input type="text" value={company.taxId} disabled className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-bold mt-1" />
          </div>
          <div>
            <label className="text-slate-400">Moneda Operacional</label>
            <input type="text" value={`${company.currency} (${company.currencySymbol})`} disabled className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-bold mt-1" />
          </div>
          <div>
            <label className="text-slate-400">Tasa Impuesto ITBIS</label>
            <input type="text" value={`${company.taxRate}%`} disabled className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-bold mt-1" />
          </div>
          <div>
            <label className="text-slate-400">Ancho Impresora Térmica</label>
            <input type="text" value={company.thermalPrinterWidth} disabled className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-bold mt-1" />
          </div>
        </div>
      </div>
    </div>
  );
};
