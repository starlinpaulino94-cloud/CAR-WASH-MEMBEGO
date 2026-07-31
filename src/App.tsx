import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { QueueCountProvider } from './context/QueueCountContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView, UnprovisionedView } from './components/auth/LoginView';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { StorageAlertBanner } from './components/layout/StorageAlertBanner';
import { NuevaLlegadaModal } from './components/modals/NuevaLlegadaModal';

// Todas las vistas se cargan bajo demanda. Antes se importaban las 16 de forma
// estática y viajaban íntegras en el bundle inicial (hallazgo H5).
const lazyView = <K extends string>(loader: () => Promise<Record<string, React.ComponentType>>, key: K) =>
  lazy(() => loader().then(m => ({ default: m[key] })));

// --- Vistas migradas a Supabase
const DashboardSupabaseView = lazyView(() => import('./components/views/DashboardSupabaseView'), 'DashboardSupabaseView');
const OrdersSupabaseView    = lazyView(() => import('./components/views/OrdersSupabaseView'), 'OrdersSupabaseView');
const KanbanSupabaseView    = lazyView(() => import('./components/views/KanbanSupabaseView'), 'KanbanSupabaseView');
const BaysSupabaseView      = lazyView(() => import('./components/views/BaysSupabaseView'), 'BaysSupabaseView');
const PosSupabaseView       = lazyView(() => import('./components/views/PosSupabaseView'), 'PosSupabaseView');
const CashSupabaseView      = lazyView(() => import('./components/views/CashSupabaseView'), 'CashSupabaseView');
const InvoicesSupabaseView  = lazyView(() => import('./components/views/InvoicesSupabaseView'), 'InvoicesSupabaseView');
const CustomersSupabaseView = lazyView(() => import('./components/views/CustomersSupabaseView'), 'CustomersSupabaseView');
const VehiclesSupabaseView  = lazyView(() => import('./components/views/VehiclesSupabaseView'), 'VehiclesSupabaseView');
const ServicesSupabaseView  = lazyView(() => import('./components/views/ServicesSupabaseView'), 'ServicesSupabaseView');
const ProductsSupabaseView  = lazyView(() => import('./components/views/ProductsSupabaseView'), 'ProductsSupabaseView');
const TeamSupabaseView      = lazyView(() => import('./components/views/TeamSupabaseView'), 'TeamSupabaseView');
const ExpensesSupabaseView  = lazyView(() => import('./components/views/ExpensesSupabaseView'), 'ExpensesSupabaseView');
const MembegoHubSupabaseView= lazyView(() => import('./components/views/MembegoHubSupabaseView'), 'MembegoHubSupabaseView');
const ReportsSupabaseView   = lazyView(() => import('./components/views/ReportsSupabaseView'), 'ReportsSupabaseView');
const SettingsSupabaseView  = lazyView(() => import('./components/views/SettingsSupabaseView'), 'SettingsSupabaseView');

// --- Vistas de demostración (sin base de datos conectada)
const DashboardView = lazyView(() => import('./components/views/DashboardView'), 'DashboardView');
const OrdersView    = lazyView(() => import('./components/views/OrdersView'), 'OrdersView');
const KanbanView    = lazyView(() => import('./components/views/KanbanView'), 'KanbanView');
const BaysView      = lazyView(() => import('./components/views/BaysView'), 'BaysView');
const PosView       = lazyView(() => import('./components/views/PosView'), 'PosView');
const CashView      = lazyView(() => import('./components/views/CashView'), 'CashView');
const InvoicesView  = lazyView(() => import('./components/views/InvoicesView'), 'InvoicesView');
const CustomersView = lazyView(() => import('./components/views/CustomersView'), 'CustomersView');
const VehiclesView  = lazyView(() => import('./components/views/VehiclesView'), 'VehiclesView');
const ServicesView  = lazyView(() => import('./components/views/ServicesView'), 'ServicesView');
const ProductsView  = lazyView(() => import('./components/views/ProductsView'), 'ProductsView');
const TeamView      = lazyView(() => import('./components/views/TeamView'), 'TeamView');
const ExpensesView  = lazyView(() => import('./components/views/ExpensesView'), 'ExpensesView');
const MembegoHubView= lazyView(() => import('./components/views/MembegoHubView'), 'MembegoHubView');
const ReportsView   = lazyView(() => import('./components/views/ReportsView'), 'ReportsView');
const SettingsView  = lazyView(() => import('./components/views/SettingsView'), 'SettingsView');

const PhaseArchitectureReportModal = lazy(() =>
  import('./components/modals/PhaseArchitectureReportModal').then(m => ({ default: m.PhaseArchitectureReportModal })));

/** Marcador mientras llega un fragmento cargado bajo demanda. */
const ChunkFallback: React.FC = () => (
  <div className="p-6 max-w-7xl mx-auto space-y-4" aria-busy="true">
    <div className="h-8 w-56 bg-slate-800/60 rounded-lg animate-pulse" />
    <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
  </div>
);

const AppContent: React.FC = () => {
  const { activeTab, isNuevaLlegadaOpen, setIsNuevaLlegadaOpen, isArchModalOpen, setIsArchModalOpen } = useApp();
  const { phase } = useAuth();

  // Las 16 vistas están migradas: con Supabase conectado usan la base de datos
  // real; sin configurar, la aplicación sigue funcionando en modo demostración
  // sobre localStorage, que es lo que permite enseñarla sin desplegar nada.
  const onSupabase = phase === 'ready';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      <StorageAlertBanner />
      <DemoModeBanner />
      <Navbar />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 overflow-y-auto min-h-[calc(100vh-57px)]">
          <Suspense fallback={<ChunkFallback />}>
            {activeTab === 'dashboard' && (onSupabase ? <DashboardSupabaseView /> : <DashboardView />)}
            {activeTab === 'orders'    && (onSupabase ? <OrdersSupabaseView />    : <OrdersView />)}
            {activeTab === 'kanban'    && (onSupabase ? <KanbanSupabaseView />    : <KanbanView />)}
            {activeTab === 'bays'      && (onSupabase ? <BaysSupabaseView />      : <BaysView />)}
            {activeTab === 'pos'       && (onSupabase ? <PosSupabaseView />       : <PosView />)}
            {activeTab === 'cash'      && (onSupabase ? <CashSupabaseView />      : <CashView />)}
            {activeTab === 'invoices'  && (onSupabase ? <InvoicesSupabaseView />  : <InvoicesView />)}
            {activeTab === 'customers' && (onSupabase ? <CustomersSupabaseView /> : <CustomersView />)}
            {activeTab === 'vehicles'  && (onSupabase ? <VehiclesSupabaseView />  : <VehiclesView />)}
            {activeTab === 'services'  && (onSupabase ? <ServicesSupabaseView />  : <ServicesView />)}
            {activeTab === 'products'  && (onSupabase ? <ProductsSupabaseView />  : <ProductsView />)}
            {activeTab === 'team'      && (onSupabase ? <TeamSupabaseView />      : <TeamView />)}
            {activeTab === 'expenses'  && (onSupabase ? <ExpensesSupabaseView />  : <ExpensesView />)}
            {activeTab === 'membego'   && (onSupabase ? <MembegoHubSupabaseView />: <MembegoHubView />)}
            {activeTab === 'reports'   && (onSupabase ? <ReportsSupabaseView />   : <ReportsView />)}
            {activeTab === 'settings'  && (onSupabase ? <SettingsSupabaseView />  : <SettingsView />)}
          </Suspense>
        </main>
      </div>

      <NuevaLlegadaModal isOpen={isNuevaLlegadaOpen} onClose={() => setIsNuevaLlegadaOpen(false)} />
      {isArchModalOpen && (
        <Suspense fallback={null}>
          <PhaseArchitectureReportModal isOpen onClose={() => setIsArchModalOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};

/**
 * Aviso permanente cuando la aplicación corre sin base de datos.
 *
 * Existe porque en modo demostración los datos viven solo en este navegador y
 * pueden perderse: decirlo es más honesto que dejar que un operador crea que
 * está registrando ventas reales.
 */
const DemoModeBanner: React.FC = () => {
  const { phase } = useAuth();
  if (phase !== 'demo') return null;
  return (
    <div role="status" className="bg-indigo-950/60 border-b border-indigo-500/40 px-4 py-2 text-center text-[11px] text-indigo-200">
      <strong className="font-bold">Modo demostración.</strong>{' '}
      Sin base de datos conectada: los datos se guardan solo en este navegador y pueden perderse.
      Configure Supabase para trabajar contra la base de datos real.
    </div>
  );
};

/** Decide qué mostrar según el estado de la sesión. */
const AuthGate: React.FC = () => {
  const { phase } = useAuth();

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center" aria-busy="true">
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 mx-auto animate-pulse" />
          <p className="text-xs text-slate-500">Cargando…</p>
        </div>
      </div>
    );
  }

  if (phase === 'signed_out') return <LoginView />;
  if (phase === 'unprovisioned') return <UnprovisionedView />;

  // 'demo' y 'ready' comparten la misma aplicación; cada vista decide su origen
  // de datos.
  return (
    <AppProvider>
      <QueueCountProvider>
        <AppContent />
      </QueueCountProvider>
    </AppProvider>
  );
};

export default function App() {
  // ErrorBoundary envuelve a los proveedores, no al revés: los fallos de
  // hidratación ocurren al construir su estado y una frontera interior no
  // llegaría a capturarlos.
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ErrorBoundary>
  );
}
