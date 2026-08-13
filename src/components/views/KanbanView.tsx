import React from 'react';
import { useApp } from '../../context/AppContext';
import { OrderStatus, WorkOrder } from '../../types';
import { Car, Clock, CheckCircle2, Play, UserCheck, ShieldCheck, ChevronRight, Plus } from 'lucide-react';

export const KanbanView: React.FC = () => {
  const { workOrders, updateOrderStatus, users, company, setIsNuevaLlegadaOpen } = useApp();

  const columns: { id: OrderStatus; label: string; color: string }[] = [
    { id: 'pendiente', label: 'Llegadas / Pendientes', color: 'border-warning/50 bg-warning/5' },
    { id: 'en_espera', label: 'En Espera / Cola', color: 'border-info/50 bg-info/5' },
    { id: 'en_proceso', label: 'En Lavado & Secado', color: 'border-brand/50 bg-brand/5' },
    { id: 'control_calidad', label: 'Control de Calidad', color: 'border-accent/50 bg-brand/5' },
    { id: 'listo', label: 'Listo para Entrega', color: 'border-success/50 bg-success/5' },
    { id: 'entregado', label: 'Entregados', color: 'border-line-strong bg-surface/30' }
  ];

  const washers = users.filter(u => u.role === 'operario');

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <Car className="w-5 h-5 text-brand" /> Tablero Kanban de Lavado Operacional
          </h2>
          <p className="text-xs text-muted">Progreso en tiempo real de vehículos por bahías y estaciones</p>
        </div>
        <button
          onClick={() => setIsNuevaLlegadaOpen(true)}
          className="px-4 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-all flex items-center gap-2 self-start sm:self-auto"
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
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <span className="font-bold text-xs text-body">{col.label}</span>
                <span className="w-5 h-5 rounded-full bg-surface-2 text-body font-extrabold text-xs flex items-center justify-center">
                  {ordersInCol.length}
                </span>
              </div>

              {/* Order Cards */}
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[70vh] pr-1">
                {ordersInCol.length === 0 ? (
                  <div className="text-center py-8 text-xs text-faint italic">Sin vehículos</div>
                ) : (
                  ordersInCol.map(order => (
                    <div
                      key={order.id}
                      className="bg-surface border border-line hover:border-line-strong p-3.5 rounded-xl shadow-md space-y-2.5 transition-all group"
                    >
                      {/* Top plate & badge */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-black text-sm text-strong tracking-wider bg-canvas px-2 py-0.5 rounded border border-line inline-block">
                            {order.vehiclePlate}
                          </div>
                          <div className="text-xs text-muted mt-0.5">{order.vehicleMakeModel}</div>
                        </div>
                        <span className="text-xs font-bold text-brand-hi bg-brand-soft/60 px-1.5 py-0.5 rounded">
                          {order.orderNumber}
                        </span>
                      </div>

                      {/* Customer & Membego indicator */}
                      <div className="text-xs space-y-1">
                        <div className="text-body font-medium truncate">{order.customerName}</div>
                        {order.membegoBenefitId && (
                          <div className="text-xs bg-success/20 text-success border border-success/30 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-success" /> Beneficio Membego
                          </div>
                        )}
                      </div>

                      {/* Items */}
                      <div className="text-xs text-muted bg-canvas/50 p-2 rounded border border-line/80">
                        {order.items.map(i => i.name).join(', ')}
                      </div>

                      {/* Washers assigned */}
                      <div className="text-xs text-muted flex items-center justify-between pt-1 border-t border-line/60">
                        <div className="flex items-center gap-1">
                          <UserCheck className="w-3 h-3 text-brand" />
                          <span>{order.assignedEmployeeNames.join(', ') || 'Sin asignar'}</span>
                        </div>
                        <span className="font-bold text-body">
                          {order.total === 0 ? '$0 (Cover)' : `${company.currencySymbol} ${order.total.toLocaleString()}`}
                        </span>
                      </div>

                      {/* Status Action Buttons */}
                      <div className="pt-1 flex gap-1 justify-end">
                        {col.id === 'pendiente' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'en_espera')}
                            className="w-full py-1 bg-info hover:bg-info text-on-accent font-bold text-xs rounded transition-colors"
                          >
                            Mover a Espera
                          </button>
                        )}
                        {col.id === 'en_espera' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'en_proceso', 'bay-1', [washers[0]?.id || 'usr-5'])}
                            className="w-full py-1 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded transition-colors flex items-center justify-center gap-1"
                          >
                            <Play className="w-3 h-3" /> Iniciar Lavado
                          </button>
                        )}
                        {col.id === 'en_proceso' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'control_calidad')}
                            className="w-full py-1 bg-brand hover:bg-brand text-strong font-bold text-xs rounded transition-colors"
                          >
                            A Control Calidad
                          </button>
                        )}
                        {col.id === 'control_calidad' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'listo')}
                            className="w-full py-1 bg-success hover:bg-success text-on-accent font-bold text-xs rounded transition-colors flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Marcar Listo
                          </button>
                        )}
                        {col.id === 'listo' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'entregado')}
                            className="w-full py-1 bg-surface-3 hover:bg-surface-3 text-strong font-bold text-xs rounded transition-colors"
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
