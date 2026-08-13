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
      <div className="bg-gradient-to-r from-brand-soft/60 via-accent/40 to-surface border border-brand/30 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-brand-hi text-xs font-extrabold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-success" /> Sistema Operacional Activo • Fase 0 & 1 Creadas
          </div>
          <h2 className="text-xl font-extrabold text-strong">
            Membego Car Wash Operations Control Center
          </h2>
          <p className="text-xs text-body max-w-2xl">
            SaaS de operaciones en tiempo real para car wash pequeños y medianos. Control de llegada, cola kanban, POS, caja, comisiones e integración API con Membego Core.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsArchModalOpen(true)}
            className="px-4 py-2.5 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-all whitespace-nowrap"
          >
            📄 Ver Documento Arquitectura (Fase 0)
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface/80 border border-line p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-muted text-xs font-semibold">
            <span>Vehículos en Espera</span>
            <Clock className="w-4 h-4 text-warning" />
          </div>
          <div className="text-2xl font-black text-strong">{totalInQueue}</div>
          <div className="text-xs text-warning font-medium">Llegadas sin lavar en cola</div>
        </div>

        <div className="bg-surface/80 border border-line p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-muted text-xs font-semibold">
            <span>En Lavado / Secado</span>
            <Car className="w-4 h-4 text-brand" />
          </div>
          <div className="text-2xl font-black text-strong">{totalInProcess}</div>
          <div className="text-xs text-brand font-medium">Bahías ocupadas actualmente</div>
        </div>

        <div className="bg-surface/80 border border-line p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-muted text-xs font-semibold">
            <span>Servicios Listos / Entregados</span>
            <CheckCircle2 className="w-4 h-4 text-success" />
          </div>
          <div className="text-2xl font-black text-strong">{totalFinishedToday}</div>
          <div className="text-xs text-success font-medium">{membegoRedemptionsCount} con beneficio Membego</div>
        </div>

        <div className="bg-surface/80 border border-line p-4 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-muted text-xs font-semibold">
            <span>Ventas Facturadas Hoy</span>
            <DollarSign className="w-4 h-4 text-success" />
          </div>
          <div className="text-2xl font-black text-strong">{company.currencySymbol} {todaySales.toLocaleString()}</div>
          <div className="text-xs text-muted font-medium">Ticket promedio: {company.currencySymbol} {avgTicket.toLocaleString()}</div>
        </div>
      </div>

      {/* Quick Launchpad & Active Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Work Orders Summary */}
        <div className="lg:col-span-2 bg-surface/80 border border-line rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <h3 className="font-bold text-strong text-sm flex items-center gap-2">
                <Car className="w-4 h-4 text-brand" />
                Vehículos en Flujo de Operación
              </h3>
              <p className="text-xs text-muted">Cola activa de servicios en ejecución</p>
            </div>
            <button
              onClick={() => navigate('kanban')}
              className="text-xs text-brand hover:text-brand-hi font-semibold flex items-center gap-1"
            >
              Ver Tablero Kanban <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 px-3">ORDEN</th>
                  <th className="py-2 px-3">VEHÍCULO</th>
                  <th className="py-2 px-3">CLIENTE</th>
                  <th className="py-2 px-3">ESTADO</th>
                  <th className="py-2 px-3">TOTAL</th>
                  <th className="py-2 px-3 text-right">ACCIÓN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {workOrders.slice(0, 5).map(order => (
                  <tr key={order.id} className="hover:bg-surface-2/40 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-brand-hi">{order.orderNumber}</td>
                    <td className="py-2.5 px-3 font-bold text-strong">
                      {order.vehiclePlate}
                      <div className="text-xs text-muted font-normal">{order.vehicleMakeModel}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-body">{order.customerName}</div>
                      {order.membegoBenefitId && (
                        <span className="text-xs bg-brand/20 text-brand-hi px-1.5 py-0.2 rounded font-semibold">
                          VIP Membego
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        order.status === 'pendiente' ? 'bg-warning/20 text-warning' :
                        order.status === 'en_proceso' ? 'bg-brand/20 text-brand-hi' :
                        order.status === 'listo' ? 'bg-success/20 text-success' :
                        'bg-surface-2 text-body'
                      }`}>
                        {order.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-body">
                      {order.total === 0 ? <span className="text-success">BENEFICIO $0</span> : `${company.currencySymbol} ${order.total.toLocaleString()}`}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {order.status === 'pendiente' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'en_proceso')}
                          className="px-2.5 py-1 bg-brand hover:bg-brand text-on-accent font-semibold rounded text-xs transition-colors flex items-center gap-1 ml-auto"
                        >
                          <Play className="w-3 h-3" /> Iniciar
                        </button>
                      )}
                      {order.status === 'en_proceso' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'listo')}
                          className="px-2.5 py-1 bg-success hover:bg-success text-on-accent font-semibold rounded text-xs transition-colors flex items-center gap-1 ml-auto"
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
        <div className="bg-surface/80 border border-line rounded-2xl p-5 space-y-4">
          <div className="border-b border-line pb-3">
            <h3 className="font-bold text-strong text-sm">Accesos Rápida Operación</h3>
            <p className="text-xs text-muted">Acciones para el personal de recepción y caja</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setIsNuevaLlegadaOpen(true)}
              className="w-full p-3 bg-gradient-to-r from-brand to-accent hover:from-brand hover:to-accent text-strong font-bold rounded-xl text-xs flex items-center justify-between shadow-lg shadow-brand/20 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <Plus className="w-4 h-4" />
                <span>Registrar Nueva Llegada</span>
              </div>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => navigate('pos')}
              className="w-full p-3 bg-surface-2 hover:bg-surface-3/80 border border-line-strong text-body font-bold rounded-xl text-xs flex items-center justify-between transition-all"
            >
              <div className="flex items-center gap-2.5">
                <DollarSign className="w-4 h-4 text-success" />
                <span>Abrir Punto de Venta (POS)</span>
              </div>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => navigate('membego')}
              className="w-full p-3 bg-brand-soft/40 hover:bg-brand-soft/40 border border-brand/30 text-brand-hi font-bold rounded-xl text-xs flex items-center justify-between transition-all"
            >
              <div className="flex items-center gap-2.5">
                <QrCode className="w-4 h-4" />
                <span>Simulador Membego API</span>
              </div>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Cash session banner */}
          <div className="p-3 bg-canvas rounded-xl border border-line space-y-1">
            <div className="text-xs font-semibold text-muted">Estado de Caja Actual:</div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-success">Caja Abierta (RD$ {cashSession?.expectedCash.toLocaleString()})</span>
              <button
                onClick={() => navigate('cash')}
                className="text-xs text-brand hover:underline"
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
