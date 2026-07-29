import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView, UnprovisionedView } from './components/auth/LoginView';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { StorageAlertBanner } from './components/layout/StorageAlertBanner';
import { DashboardView } from './components/views/DashboardView';
import { OrdersView } from './components/views/OrdersView';
import { KanbanView } from './components/views/KanbanView';
import { BaysView } from './components/views/BaysView';
import { PosView } from './components/views/PosView';
import { CashView } from './components/views/CashView';
import { InvoicesView } from './components/views/InvoicesView';
import { CustomersView } from './components/views/CustomersView';
import { VehiclesView } from './components/views/VehiclesView';
import { ServicesView } from './components/views/ServicesView';
import { ProductsView } from './components/views/ProductsView';
import { TeamView } from './components/views/TeamView';
import { ExpensesView } from './components/views/ExpensesView';
import { MembegoHubView } from './components/views/MembegoHubView';
import { ReportsView } from './components/views/ReportsView';
import { SettingsView } from './components/views/SettingsView';
import { NuevaLlegadaModal } from './components/modals/NuevaLlegadaModal';

// Carga diferida: estas piezas no hacen falta para pintar la primera pantalla.
// Las vistas sobre Supabase arrastran el cliente de la base de datos, y el
// informe de arquitectura son 291 líneas de prosa estática que viajaban en el
// bundle principal (hallazgo H5 de la auditoría).
const PosSupabaseView = lazy(() =>
  import('./components/views/PosSupabaseView').then(m => ({ default: m.PosSupabaseView })));
const CashSupabaseView = lazy(() =>
  import('./components/views/CashSupabaseView').then(m => ({ default: m.CashSupabaseView })));
const InvoicesSupabaseView = lazy(() =>
  import('./components/views/InvoicesSupabaseView').then(m => ({ default: m.InvoicesSupabaseView })));
const OrdersSupabaseView = lazy(() =>
  import('./components/views/OrdersSupabaseView').then(m => ({ default: m.OrdersSupabaseView })));
const KanbanSupabaseView = lazy(() =>
  import('./components/views/KanbanSupabaseView').then(m => ({ default: m.KanbanSupabaseView })));
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

  // POS, Caja, Facturas, Órdenes y Kanban ya están migrados: con Supabase
  // conectado usan la base de datos real; sin configurar, siguen funcionando en
  // modo demostración sobre localStorage. Las demás vistas no están migradas.
  const onSupabase = phase === 'ready';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      <StorageAlertBanner />
      <DemoModeBanner />
      <Navbar />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 overflow-y-auto min-h-[calc(100vh-57px)]">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'bays' && <BaysView />}
          <Suspense fallback={<ChunkFallback />}>
            {activeTab === 'orders' && (onSupabase ? <OrdersSupabaseView /> : <OrdersView />)}
            {activeTab === 'kanban' && (onSupabase ? <KanbanSupabaseView /> : <KanbanView />)}
            {activeTab === 'pos' && (onSupabase ? <PosSupabaseView /> : <PosView />)}
            {activeTab === 'cash' && (onSupabase ? <CashSupabaseView /> : <CashView />)}
            {activeTab === 'invoices' && (onSupabase ? <InvoicesSupabaseView /> : <InvoicesView />)}
          </Suspense>
          {activeTab === 'customers' && <CustomersView />}
          {activeTab === 'vehicles' && <VehiclesView />}
          {activeTab === 'services' && <ServicesView />}
          {activeTab === 'products' && <ProductsView />}
          {activeTab === 'team' && <TeamView />}
          {activeTab === 'expenses' && <ExpensesView />}
          {activeTab === 'membego' && <MembegoHubView />}
          {activeTab === 'reports' && <ReportsView />}
          {activeTab === 'settings' && <SettingsView />}
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
      POS, Caja, Facturas, Órdenes y Kanban funcionan contra la base real al configurar Supabase.
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
      <AppContent />
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
