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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Car className="w-5 h-5 text-indigo-400" /> Historial y Listado de Órdenes
          </h2>
          <p className="text-xs text-slate-400">Control detallado de órdenes de lavado, estados y montos</p>
        </div>
        <button
          onClick={() => setIsNuevaLlegadaOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Nueva Orden
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por placa, cliente u orden..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 font-semibold"
        >
          <option value="all">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En Proceso</option>
          <option value="listo">Listo</option>
          <option value="entregado">Entregado</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th className="p-3">ORDEN</th>
                <th className="p-3">VEHÍCULO</th>
                <th className="p-3">CLIENTE</th>
                <th className="p-3">SERVICIOS</th>
                <th className="p-3">ESTADO</th>
                <th className="p-3">TOTAL</th>
                <th className="p-3 text-right">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(order => (
                <tr key={order.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-3 font-bold text-indigo-300">{order.orderNumber}</td>
                  <td className="p-3">
                    <div className="font-bold text-white uppercase">{order.vehiclePlate}</div>
                    <div className="text-[10px] text-slate-400">{order.vehicleMakeModel} ({order.vehicleCategory.toUpperCase()})</div>
                  </td>
                  <td className="p-3">
                    <div className="text-slate-200">{order.customerName}</div>
                    {order.membegoBenefitId && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded font-bold">
                        Socio Membego
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-slate-400 max-w-xs truncate">
                    {order.items.map(i => i.name).join(', ')}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      order.status === 'pendiente' ? 'bg-amber-500/20 text-amber-300' :
                      order.status === 'en_proceso' ? 'bg-indigo-500/20 text-indigo-300' :
                      order.status === 'listo' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {order.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-slate-200">
                    {order.total === 0 ? <span className="text-emerald-400">$0 (Cover)</span> : `${company.currencySymbol} ${order.total.toLocaleString()}`}
                  </td>
                  <td className="p-3 text-right">
                    {order.status === 'pendiente' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'en_proceso')}
                        className="px-2.5 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold"
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
