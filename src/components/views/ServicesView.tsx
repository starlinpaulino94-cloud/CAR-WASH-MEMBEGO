import React from 'react';
import { Layers } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ServicesView: React.FC = () => {
  const { services, company } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <Layers className="w-5 h-5 text-brand" /> Catálogo de Servicios & Matriz de Precios
        </h2>
        <p className="text-xs text-muted">Tarifas por categoría de vehículo y comisiones por lavador</p>
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th className="p-3">CÓDIGO / SERVICIO</th>
                <th className="p-3">SEDÁN</th>
                <th className="p-3">SUV</th>
                <th className="p-3">PICKUP</th>
                <th className="p-3">TIEMPO EST.</th>
                <th className="p-3">COMISIÓN %</th>
                <th className="p-3">MEMBEGO INCLUIDO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {services.map(s => (
                <tr key={s.id} className="hover:bg-surface-2/40">
                  <td className="p-3">
                    <div className="font-bold text-strong">{s.name}</div>
                    <div className="text-xs text-muted">{s.code} • {s.category}</div>
                  </td>
                  <td className="p-3 font-bold text-body">{company.currencySymbol} {s.priceByVehicle.sedan}</td>
                  <td className="p-3 font-bold text-body">{company.currencySymbol} {s.priceByVehicle.suv}</td>
                  <td className="p-3 font-bold text-body">{company.currencySymbol} {s.priceByVehicle.pickup}</td>
                  <td className="p-3 text-body font-semibold">{s.estimatedMinutes} min</td>
                  <td className="p-3 font-bold text-brand">{s.commissionPercent}%</td>
                  <td className="p-3">
                    {s.includedInMembego ? (
                      <span className="text-xs bg-success/20 text-success font-bold px-2 py-0.5 rounded">SÍ</span>
                    ) : (
                      <span className="text-xs text-faint">NO</span>
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
