import React from 'react';
import { useApp } from '../../context/AppContext';
import { OrderStatus, WorkOrder } from '../../types';
import { Car, Clock, CheckCircle2, Play, UserCheck, ShieldCheck, ChevronRight, Plus } from 'lucide-react';

export const KanbanView: React.FC = () => {
  const { workOrders, updateOrderStatus, users, company, setIsNuevaLlegadaOpen } = useApp();

  const columns: { id: OrderStatus; label: string; color: string }[] = [
    { id: 'pendiente', label: 'Llegadas / Pendientes', color: 'border-amber-500/50 bg-amber-500/5' },
    { id: 'en_espera', label: 'En Espera / Cola', color: 'border-sky-500/50 bg-sky-500/5' },
    { id: 'en_proceso', label: 'En Lavado & Secado', color: 'border-indigo-500/50 bg-indigo-500/5' },
    { id: 'control_calidad', label: 'Control de Calidad', color: 'border-purple-500/50 bg-purple-500/5' },
    { id: 'listo', label: 'Listo para Entrega', color: 'border-emerald-500/50 bg-emerald-500/5' },
    { id: 'entregado', label: 'Entregados', color: 'border-slate-700 bg-slate-900/30' }
  ];

  const washers = users.filter(u => u.role === 'operario');

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Car className="w-5 h-5 text-indigo-400" /> Tablero Kanban de Lavado Operacional
          </h2>
          <p className="text-xs text-slate-400">Progreso en tiempo real de vehículos por bahías y estaciones</p>
        </div>
        <button
          onClick={() => setIsNuevaLlegadaOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Registrar Llegada
        </button>
      </div>

      {/* Columns Container */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 overflow-x-auto pb-4 min-h-[600px]">
        {columns.map(col => {
          const ordersInCol = workOrders.filter(w => w.status === col.id);

          return (
            <div key={col.id} className={`flex flex-col rounded-2xl border ${col.color} p-3 space-y-3 min-w-[240px]`}>
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-xs text-slate-200">{col.label}</span>
                <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-extrabold text-[10px] flex items-center justify-center">
                  {ordersInCol.length}
                </span>
              </div>

              {/* Order Cards */}
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[70vh] pr-1">
                {ordersInCol.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-600 italic">Sin vehículos</div>
                ) : (
                  ordersInCol.map(order => (
                    <div
                      key={order.id}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-3.5 rounded-xl shadow-md space-y-2.5 transition-all group"
                    >
                      {/* Top plate & badge */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-black text-sm text-white tracking-wider bg-slate-950 px-2 py-0.5 rounded border border-slate-800 inline-block">
                            {order.vehiclePlate}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{order.vehicleMakeModel}</div>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded">
                          {order.orderNumber}
                        </span>
                      </div>

                      {/* Customer & Membego indicator */}
                      <div className="text-xs space-y-1">
                        <div className="text-slate-300 font-medium truncate">{order.customerName}</div>
                        {order.membegoBenefitId && (
                          <div className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" /> Beneficio Membego
                          </div>
                        )}
                      </div>

                      {/* Items */}
                      <div className="text-[11px] text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800/80">
                        {order.items.map(i => i.name).join(', ')}
                      </div>

                      {/* Washers assigned */}
                      <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60">
                        <div className="flex items-center gap-1">
                          <UserCheck className="w-3 h-3 text-indigo-400" />
                          <span>{order.assignedEmployeeNames.join(', ') || 'Sin asignar'}</span>
                        </div>
                        <span className="font-bold text-slate-300">
                          {order.total === 0 ? '$0 (Cover)' : `${company.currencySymbol} ${order.total.toLocaleString()}`}
                        </span>
                      </div>

                      {/* Status Action Buttons */}
                      <div className="pt-1 flex gap-1 justify-end">
                        {col.id === 'pendiente' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'en_espera')}
                            className="w-full py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] rounded transition-colors"
                          >
                            Mover a Espera
                          </button>
                        )}
                        {col.id === 'en_espera' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'en_proceso', 'bay-1', [washers[0]?.id || 'usr-5'])}
                            className="w-full py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] rounded transition-colors flex items-center justify-center gap-1"
                          >
                            <Play className="w-3 h-3" /> Iniciar Lavado
                          </button>
                        )}
                        {col.id === 'en_proceso' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'control_calidad')}
                            className="w-full py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] rounded transition-colors"
                          >
                            A Control Calidad
                          </button>
                        )}
                        {col.id === 'control_calidad' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'listo')}
                            className="w-full py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] rounded transition-colors flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Marcar Listo
                          </button>
                        )}
                        {col.id === 'listo' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'entregado')}
                            className="w-full py-1 bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] rounded transition-colors"
                          >
                            Confirmar Entrega
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
