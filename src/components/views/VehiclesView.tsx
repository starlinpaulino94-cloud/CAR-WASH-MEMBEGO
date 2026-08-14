import React from 'react';
import { Car } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const VehiclesView: React.FC = () => {
  const { vehicles } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <Car className="w-5 h-5 text-brand" /> Flotilla & Vehículos Registrados
        </h2>
        <p className="text-xs text-muted">Historial por placa, modelo y categoría de vehículo</p>
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted bg-canvas/50">
              <th className="p-3">PLACA</th>
              <th className="p-3">MARCA & MODELO</th>
              <th className="p-3">COLOR</th>
              <th className="p-3">CATEGORÍA</th>
              <th className="p-3">CLIENTE PROPIETARIO</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {vehicles.map(v => (
              <tr key={v.id} className="hover:bg-surface-2/40">
                <td className="p-3 font-bold text-strong bg-canvas/60 inline-block rounded my-1 border border-line">{v.plate}</td>
                <td className="p-3 font-bold text-body">{v.make} {v.model} ({v.year || ''})</td>
                <td className="p-3 text-muted">{v.color}</td>
                <td className="p-3">
                  <span className="bg-brand-soft text-brand-hi font-bold px-2 py-0.5 rounded text-xs uppercase">
                    {v.category}
                  </span>
                </td>
                <td className="p-3 text-body">{v.customerName || 'Visitante General'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
