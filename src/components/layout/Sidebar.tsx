import React from 'react';
import {
  LayoutDashboard,
  Car,
  Kanban,
  Warehouse,
  ShoppingBag,
  CreditCard,
  Receipt,
  Users,
  Briefcase,
  Layers,
  Package,
  DollarSign,
  QrCode,
  BarChart3,
  Settings,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, workOrders, isMembegoOnline } = useApp();
  const { phase } = useAuth();

  // El contador de la cola sale del estado local de demostración. Con la base
  // de datos conectada ese número no corresponde a nada real, así que se
  // oculta en lugar de mostrar una cifra inventada: es el mismo problema que
  // tenía la barra superior con el selector de rol.
  const activeQueueCount = phase === 'demo'
    ? workOrders.filter(w => w.status !== 'entregado' && w.status !== 'cancelado').length
    : undefined;

  const menuSections = [
    {
      title: 'Principal',
      items: [
        { id: 'dashboard', label: 'Inicio & Resumen', icon: LayoutDashboard }
      ]
    },
    {
      title: 'Operación Car Wash',
      items: [
        { id: 'orders', label: 'Órdenes de Servicio', icon: Car, badge: activeQueueCount },
        { id: 'kanban', label: 'Fila & Cola Kanban', icon: Kanban },
        { id: 'bays', label: 'Bahías y Estaciones', icon: Warehouse }
      ]
    },
    {
      title: 'Ventas & Caja',
      items: [
        { id: 'pos', label: 'Punto de Venta (POS)', icon: ShoppingBag },
        { id: 'cash', label: 'Control de Caja', icon: CreditCard },
        { id: 'invoices', label: 'Facturas & Comprobantes', icon: Receipt }
      ]
    },
    {
      title: 'Clientes & Vehículos',
      items: [
        { id: 'customers', label: 'Directorio de Clientes', icon: Users },
        { id: 'vehicles', label: 'Flotillas & Vehículos', icon: Car }
      ]
    },
    {
      title: 'Catálogo & Equipo',
      items: [
        { id: 'services', label: 'Servicios & Paquetes', icon: Layers },
        { id: 'products', label: 'Productos e Insumos', icon: Package },
        { id: 'team', label: 'Empleados & Comisiones', icon: Briefcase }
      ]
    },
    {
      title: 'Inventario & Gastos',
      items: [
        { id: 'expenses', label: 'Gastos Operativos', icon: DollarSign }
      ]
    },
    {
      title: 'Fidelización',
      items: [
        { id: 'membego', label: 'Membego API Hub', icon: QrCode, highlight: true }
      ]
    },
    {
      title: 'Analítica & Ajustes',
      items: [
        { id: 'reports', label: 'Reportes & Auditoría', icon: BarChart3 },
        { id: 'settings', label: 'Ajustes de Empresa', icon: Settings }
      ]
    }
  ];

  return (
    <aside className="w-64 bg-slate-900/90 border-r border-slate-800 flex flex-col flex-shrink-0 min-h-[calc(100vh-57px)]">
      <div className="p-3 space-y-5 overflow-y-auto flex-1">
        {menuSections.map((sec, idx) => (
          <div key={idx} className="space-y-1">
            <div className="px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
              {sec.title}
            </div>
            {sec.items.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : item.highlight
                      ? 'text-indigo-400 bg-indigo-950/40 border border-indigo-500/30 hover:bg-indigo-900/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.highlight ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${isActive ? 'bg-white text-indigo-700' : 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer Banner */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/60">
        <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isMembegoOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <div className="text-[11px] font-medium text-slate-300">
              {isMembegoOnline ? 'Membego Sync On' : 'Offline Mode'}
            </div>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">v1.0</span>
        </div>
      </div>
    </aside>
  );
};
