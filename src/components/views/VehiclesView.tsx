import React from 'react';
import { Car } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const VehiclesView: React.FC = () => {
  const { vehicles } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Car className="w-5 h-5 text-indigo-400" /> Flotilla & Vehículos Registrados
        </h2>
        <p className="text-xs text-slate-400">Historial por placa, modelo y categoría de vehículo</p>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
              <th className="p-3">PLACA</th>
              <th className="p-3">MARCA & MODELO</th>
              <th className="p-3">COLOR</th>
              <th className="p-3">CATEGORÍA</th>
              <th className="p-3">CLIENTE PROPIETARIO</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {vehicles.map(v => (
              <tr key={v.id} className="hover:bg-slate-800/40">
                <td className="p-3 font-bold text-white bg-slate-950/60 inline-block rounded my-1 border border-slate-800">{v.plate}</td>
                <td className="p-3 font-bold text-slate-200">{v.make} {v.model} ({v.year || ''})</td>
                <td className="p-3 text-slate-400">{v.color}</td>
                <td className="p-3">
                  <span className="bg-indigo-950 text-indigo-300 font-bold px-2 py-0.5 rounded text-xs uppercase">
                    {v.category}
                  </span>
                </td>
                <td className="p-3 text-slate-300">{v.customerName || 'Visitante General'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
