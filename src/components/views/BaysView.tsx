import React from 'react';
import { Warehouse, Car, User, Clock, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const BaysView: React.FC = () => {
  const { bays, updateBayStatus } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Warehouse className="w-5 h-5 text-indigo-400" /> Control de Bahías y Estaciones
        </h2>
        <p className="text-xs text-slate-400">Ocupación física de las estaciones de lavado y detallado</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bays.map(bay => (
          <div
            key={bay.id}
            className={`p-4 rounded-2xl border space-y-3 ${
              bay.status === 'ocupada'
                ? 'bg-indigo-950/40 border-indigo-500/50'
                : bay.status === 'mantenimiento'
                ? 'bg-amber-950/40 border-amber-500/50'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white">{bay.name}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                bay.status === 'ocupada' ? 'bg-indigo-500/20 text-indigo-300' :
                bay.status === 'disponible' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {bay.status}
              </span>
            </div>

            {bay.status === 'ocupada' && (
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-xs">
                <div className="font-bold text-white">Vehículo: {bay.currentVehiclePlate}</div>
                <div className="text-slate-400">Lavador: {bay.assignedEmployeeName || 'Asignado'}</div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => updateBayStatus(bay.id, 'disponible')}
                className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-lg"
              >
                Liberar
              </button>
              <button
                onClick={() => updateBayStatus(bay.id, 'mantenimiento')}
                className="py-1.5 px-3 bg-amber-600/30 text-amber-300 font-bold text-xs rounded-lg border border-amber-500/30"
              >
                Mantenimiento
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
