import React from 'react';
import {
  Car,
  Clock,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  Plus,
  QrCode,
  ShieldCheck,
  Building2,
  ArrowRight,
  AlertTriangle,
  Play
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useNavigation } from '../../context/NavigationContext';

export const DashboardView: React.FC = () => {
  const {
    workOrders,
    company,
    invoices,
    cashSession,
    setIsNuevaLlegadaOpen,
    setIsArchModalOpen,
    updateOrderStatus
  } = useApp();
  const { navigate } = useNavigation();

  const totalInQueue = workOrders.filter(w => w.status === 'pendiente' || w.status === 'en_espera').length;
  const totalInProcess = workOrders.filter(w => w.status === 'en_proceso' || w.status === 'asignada').length;
  const totalFinishedToday = workOrders.filter(w => w.status === 'listo' || w.status === 'entregado').length;

  const todaySales = invoices.reduce((acc, inv) => acc + (inv.isAnulled ? 0 : inv.total), 0);
  const avgTicket = invoices.length > 0 ? Math.round(todaySales / invoices.length) : 0;
  const membegoRedemptionsCount = workOrders.filter(w => Boolean(w.membegoBenefitId)).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Banner Strategy Phase 0 Shortcut */}
      <div className="bg-gradient-to-r from-indigo-900/60 via-purple-900/40 to-slate-900 border border-indigo-500/30 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-300 text-xs font-extrabold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Sistema Operacional Activo • Fase 0 & 1 Creadas
          </div>
          <h2 className="text-xl font-extrabold text-white">
            Membego Car Wash Operations Control Center
          </h2>
          <p className="text-xs text-slate-300 max-w-2xl">
            SaaS de operaciones en tiempo real para car wash pequeños y medianos. Control de llegada, cola kanban, POS, caja, comisiones e integración API con Membego Core.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsArchModalOpen(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all whitespace-nowrap"
          >
            📄 Ver Documento Arquitectura (Fase 0)
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold">
            <span>Vehículos en Espera</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white">{totalInQueue}</div>
          <div className="text-xs text-amber-400 font-medium">Llegadas sin lavar en cola</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold">
            <span>En Lavado / Secado</span>
            <Car className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-white">{totalInProcess}</div>
          <div className="text-xs text-indigo-400 font-medium">Bahías ocupadas actualmente</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold">
            <span>Servicios Listos / Entregados</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white">{totalFinishedToday}</div>
          <div className="text-xs text-emerald-400 font-medium">{membegoRedemptionsCount} con beneficio Membego</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold">
            <span>Ventas Facturadas Hoy</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white">{company.currencySymbol} {todaySales.toLocaleString()}</div>
          <div className="text-xs text-slate-400 font-medium">Ticket promedio: {company.currencySymbol} {avgTicket.toLocaleString()}</div>
        </div>
      </div>

      {/* Quick Launchpad & Active Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Work Orders Summary */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Car className="w-4 h-4 text-indigo-400" />
                Vehículos en Flujo de Operación
              </h3>
              <p className="text-xs text-slate-400">Cola activa de servicios en ejecución</p>
            </div>
            <button
              onClick={() => navigate('kanban')}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
            >
              Ver Tablero Kanban <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-3">ORDEN</th>
                  <th className="py-2 px-3">VEHÍCULO</th>
                  <th className="py-2 px-3">CLIENTE</th>
                  <th className="py-2 px-3">ESTADO</th>
                  <th className="py-2 px-3">TOTAL</th>
                  <th className="py-2 px-3 text-right">ACCIÓN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {workOrders.slice(0, 5).map(order => (
                  <tr key={order.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-indigo-300">{order.orderNumber}</td>
                    <td className="py-2.5 px-3 font-bold text-white">
                      {order.vehiclePlate}
                      <div className="text-xs text-slate-400 font-normal">{order.vehicleMakeModel}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-200">{order.customerName}</div>
                      {order.membegoBenefitId && (
                        <span className="text-xs bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-semibold">
                          VIP Membego
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        order.status === 'pendiente' ? 'bg-amber-500/20 text-amber-300' :
                        order.status === 'en_proceso' ? 'bg-indigo-500/20 text-indigo-300' :
                        order.status === 'listo' ? 'bg-emerald-500/20 text-emerald-300' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {order.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-200">
                      {order.total === 0 ? <span className="text-emerald-400">BENEFICIO $0</span> : `${company.currencySymbol} ${order.total.toLocaleString()}`}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {order.status === 'pendiente' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'en_proceso')}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs transition-colors flex items-center gap-1 ml-auto"
                        >
                          <Play className="w-3 h-3" /> Iniciar
                        </button>
                      )}
                      {order.status === 'en_proceso' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'listo')}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-xs transition-colors flex items-center gap-1 ml-auto"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Marcar Listo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Launch Panel */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-bold text-white text-sm">Accesos Rápida Operación</h3>
            <p className="text-xs text-slate-400">Acciones para el personal de recepción y caja</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setIsNuevaLlegadaOpen(true)}
              className="w-full p-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl text-xs flex items-center justify-between shadow-lg shadow-indigo-600/20 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <Plus className="w-4 h-4" />
                <span>Registrar Nueva Llegada</span>
              </div>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => navigate('pos')}
              className="w-full p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-200 font-bold rounded-xl text-xs flex items-center justify-between transition-all"
            >
              <div className="flex items-center gap-2.5">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Abrir Punto de Venta (POS)</span>
              </div>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => navigate('membego')}
              className="w-full p-3 bg-indigo-950/40 hover:bg-indigo-900/40 border border-indigo-500/30 text-indigo-300 font-bold rounded-xl text-xs flex items-center justify-between transition-all"
            >
              <div className="flex items-center gap-2.5">
                <QrCode className="w-4 h-4" />
                <span>Simulador Membego API</span>
              </div>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Cash session banner */}
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
            <div className="text-xs font-semibold text-slate-400">Estado de Caja Actual:</div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400">Caja Abierta (RD$ {cashSession?.expectedCash.toLocaleString()})</span>
              <button
                onClick={() => navigate('cash')}
                className="text-xs text-indigo-400 hover:underline"
              >
                Arqueo / Cierre
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
