import React from 'react';
import { Warehouse, Car, User, Clock, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const BaysView: React.FC = () => {
  const { bays, updateBayStatus } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <Warehouse className="w-5 h-5 text-brand" /> Control de Bahías y Estaciones
        </h2>
        <p className="text-xs text-muted">Ocupación física de las estaciones de lavado y detallado</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bays.map(bay => (
          <div
            key={bay.id}
            className={`p-4 rounded-2xl border space-y-3 ${
              bay.status === 'ocupada'
                ? 'bg-brand-soft/40 border-brand/50'
                : bay.status === 'mantenimiento'
                ? 'bg-warning/40 border-warning/50'
                : 'bg-surface border-line'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-strong">{bay.name}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                bay.status === 'ocupada' ? 'bg-brand/20 text-brand-hi' :
                bay.status === 'disponible' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
              }`}>
                {bay.status}
              </span>
            </div>

            {bay.status === 'ocupada' && (
              <div className="p-3 bg-canvas rounded-xl border border-line space-y-1 text-xs">
                <div className="font-bold text-strong">Vehículo: {bay.currentVehiclePlate}</div>
                <div className="text-muted">Lavador: {bay.assignedEmployeeName || 'Asignado'}</div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => updateBayStatus(bay.id, 'disponible')}
                className="flex-1 py-1.5 bg-surface-2 hover:bg-surface-3 text-body font-bold text-xs rounded-lg"
              >
                Liberar
              </button>
              <button
                onClick={() => updateBayStatus(bay.id, 'mantenimiento')}
                className="py-1.5 px-3 bg-warning/30 text-warning font-bold text-xs rounded-lg border border-warning/30"
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
