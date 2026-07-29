import React from 'react';
import { Layers } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ServicesView: React.FC = () => {
  const { services, company } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Layers className="w-5 h-5 text-indigo-400" /> Catálogo de Servicios & Matriz de Precios
        </h2>
        <p className="text-xs text-slate-400">Tarifas por categoría de vehículo y comisiones por lavador</p>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th className="p-3">CÓDIGO / SERVICIO</th>
                <th className="p-3">SEDÁN</th>
                <th className="p-3">SUV</th>
                <th className="p-3">PICKUP</th>
                <th className="p-3">TIEMPO EST.</th>
                <th className="p-3">COMISIÓN %</th>
                <th className="p-3">MEMBEGO INCLUIDO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {services.map(s => (
                <tr key={s.id} className="hover:bg-slate-800/40">
                  <td className="p-3">
                    <div className="font-bold text-white">{s.name}</div>
                    <div className="text-[10px] text-slate-400">{s.code} • {s.category}</div>
                  </td>
                  <td className="p-3 font-bold text-slate-200">{company.currencySymbol} {s.priceByVehicle.sedan}</td>
                  <td className="p-3 font-bold text-slate-200">{company.currencySymbol} {s.priceByVehicle.suv}</td>
                  <td className="p-3 font-bold text-slate-200">{company.currencySymbol} {s.priceByVehicle.pickup}</td>
                  <td className="p-3 text-slate-300 font-semibold">{s.estimatedMinutes} min</td>
                  <td className="p-3 font-bold text-indigo-400">{s.commissionPercent}%</td>
                  <td className="p-3">
                    {s.includedInMembego ? (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded">SÍ</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">NO</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
