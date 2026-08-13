import React, { useState } from 'react';
import { Car, Search, Filter, CheckCircle2, Play, Plus, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { OrderStatus } from '../../types';

export const OrdersView: React.FC = () => {
  const { workOrders, company, updateOrderStatus, setIsNuevaLlegadaOpen } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = workOrders.filter(o => {
    const matchesSearch =
      o.vehiclePlate.toLowerCase().includes(search.toLowerCase()) ||
      o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.orderNumber.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <Car className="w-5 h-5 text-brand" /> Historial y Listado de Órdenes
          </h2>
          <p className="text-xs text-muted">Control detallado de órdenes de lavado, estados y montos</p>
        </div>
        <button
          onClick={() => setIsNuevaLlegadaOpen(true)}
          className="px-4 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Nueva Orden
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-faint" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por placa, cliente u orden..."
            className="w-full bg-surface border border-line rounded-xl pl-9 pr-4 py-2 text-xs text-strong"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-surface border border-line rounded-xl px-3 py-2 text-xs text-body font-semibold"
        >
          <option value="all">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En Proceso</option>
          <option value="listo">Listo</option>
          <option value="entregado">Entregado</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th className="p-3">ORDEN</th>
                <th className="p-3">VEHÍCULO</th>
                <th className="p-3">CLIENTE</th>
                <th className="p-3">SERVICIOS</th>
                <th className="p-3">ESTADO</th>
                <th className="p-3">TOTAL</th>
                <th className="p-3 text-right">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtered.map(order => (
                <tr key={order.id} className="hover:bg-surface-2/40 transition-colors">
                  <td className="p-3 font-bold text-brand-hi">{order.orderNumber}</td>
                  <td className="p-3">
                    <div className="font-bold text-strong uppercase">{order.vehiclePlate}</div>
                    <div className="text-xs text-muted">{order.vehicleMakeModel} ({order.vehicleCategory.toUpperCase()})</div>
                  </td>
                  <td className="p-3">
                    <div className="text-body">{order.customerName}</div>
                    {order.membegoBenefitId && (
                      <span className="text-xs bg-success/20 text-success border border-success/30 px-1.5 py-0.2 rounded font-bold">
                        Socio Membego
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-muted max-w-xs truncate">
                    {order.items.map(i => i.name).join(', ')}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      order.status === 'pendiente' ? 'bg-warning/20 text-warning' :
                      order.status === 'en_proceso' ? 'bg-brand/20 text-brand-hi' :
                      order.status === 'listo' ? 'bg-success/20 text-success' : 'bg-surface-2 text-body'
                    }`}>
                      {order.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-body">
                    {order.total === 0 ? <span className="text-success">$0 (Cover)</span> : `${company.currencySymbol} ${order.total.toLocaleString()}`}
                  </td>
                  <td className="p-3 text-right">
                    {order.status === 'pendiente' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'en_proceso')}
                        className="px-2.5 py-1 bg-brand text-on-accent rounded text-xs font-bold"
                      >
                        Iniciar
                      </button>
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
