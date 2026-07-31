import React from 'react';
import { Settings, Building2, Printer } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const SettingsView: React.FC = () => {
  const { company, branches } = useApp();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-indigo-400" /> Configuración General de Empresa & Impresión
        </h2>
        <p className="text-xs text-slate-400">Ajustes de sucursales, moneda, ITBIS y formato de tickets térmicos</p>
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
