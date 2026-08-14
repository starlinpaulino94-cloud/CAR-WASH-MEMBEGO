import React from 'react';
import { Settings, Building2, Printer } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const SettingsView: React.FC = () => {
  const { company, branches } = useApp();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <Settings className="w-5 h-5 text-brand" /> Configuración General de Empresa & Impresión
        </h2>
        <p className="text-xs text-muted">Ajustes de sucursales, moneda, ITBIS y formato de tickets térmicos</p>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2">Datos de la Empresa</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-muted">Nombre Comercial</label>
            <input type="text" value={company.tradeName} disabled className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong font-bold mt-1" />
          </div>
          <div>
            <label className="text-muted">RNC / Tax ID</label>
            <input type="text" value={company.taxId} disabled className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong font-bold mt-1" />
          </div>
          <div>
            <label className="text-muted">Moneda Operacional</label>
            <input type="text" value={`${company.currency} (${company.currencySymbol})`} disabled className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong font-bold mt-1" />
          </div>
          <div>
            <label className="text-muted">Tasa Impuesto ITBIS</label>
            <input type="text" value={`${company.taxRate}%`} disabled className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong font-bold mt-1" />
          </div>
          <div>
            <label className="text-muted">Ancho Impresora Térmica</label>
            <input type="text" value={company.thermalPrinterWidth} disabled className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong font-bold mt-1" />
          </div>
        </div>
      </div>
    </div>
  );
};
