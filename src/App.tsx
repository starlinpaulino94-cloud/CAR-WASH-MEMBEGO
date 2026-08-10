import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { QueueCountProvider } from './context/QueueCountContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView, UnprovisionedView } from './components/auth/LoginView';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { ModulePage } from './components/layout/ModulePage';
import { StorageAlertBanner } from './components/layout/StorageAlertBanner';
import { NuevaLlegadaModal } from './components/modals/NuevaLlegadaModal';
import type { ViewKey } from './lib/navigation';

// Todas las vistas se cargan bajo demanda. Antes se importaban las 16 de forma
// estática y viajaban íntegras en el bundle inicial (hallazgo H5).
const lazyView = <K extends string>(loader: () => Promise<Record<string, React.ComponentType<Record<string, unknown>>>>, key: K) =>
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
const ReportsSupabaseView   = lazyView(() => import('./components/views/ReportsSupabaseView'), 'ReportsSupabaseView');
const InventoryMovesView    = lazyView(() => import('./components/views/InventoryMovementsSupabaseView'), 'InventoryMovementsSupabaseView');
const PurchasesView         = lazyView(() => import('./components/views/PurchasesSupabaseView'), 'PurchasesSupabaseView');
const SuppliersView         = lazyView(() => import('./components/views/SuppliersSupabaseView'), 'SuppliersSupabaseView');
const ClaimsView            = lazyView(() => import('./components/views/ClaimsSupabaseView'), 'ClaimsSupabaseView');
const ReceivablesView       = lazyView(() => import('./components/views/ReceivablesSupabaseView'), 'ReceivablesSupabaseView');
const FleetsView            = lazyView(() => import('./components/views/FleetsSupabaseView'), 'FleetsSupabaseView');
const ShiftsView            = lazyView(() => import('./components/views/ShiftsSupabaseView'), 'ShiftsSupabaseView');
const AttendanceView        = lazyView(() => import('./components/views/AttendanceSupabaseView'), 'AttendanceSupabaseView');
const PayrollView           = lazyView(() => import('./components/views/PayrollSupabaseView'), 'PayrollSupabaseView');
const BranchesView          = lazyView(() => import('./components/views/BranchesSupabaseView'), 'BranchesSupabaseView');
const PromotionsView        = lazyView(() => import('./components/views/PromotionsSupabaseView'), 'PromotionsSupabaseView');
const AlertsView            = lazyView(() => import('./components/views/AlertsSupabaseView'), 'AlertsSupabaseView');
const CreditNotesView       = lazyView(() => import('./components/views/CreditNotesSupabaseView'), 'CreditNotesSupabaseView');
const FiscalView            = lazyView(() => import('./components/views/FiscalSupabaseView'), 'FiscalSupabaseView');
const UsersView             = lazyView(() => import('./components/views/UsersSupabaseView'), 'UsersSupabaseView');
const AppointmentsView      = lazyView(() => import('./components/views/AppointmentsSupabaseView'), 'AppointmentsSupabaseView');
const EquipmentView         = lazyView(() => import('./components/views/EquipmentSupabaseView'), 'EquipmentSupabaseView');
const QualityView           = lazyView(() => import('./components/views/QualitySupabaseView'), 'QualitySupabaseView');
const SalesReportView       = lazyView(() => import('./components/views/SalesReportSupabaseView'), 'SalesReportSupabaseView');
const ProfitReportView      = lazyView(() => import('./components/views/ProfitReportSupabaseView'), 'ProfitReportSupabaseView');
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
const ReportsView   = lazyView(() => import('./components/views/ReportsView'), 'ReportsView');
const SettingsView  = lazyView(() => import('./components/views/SettingsView'), 'SettingsView');

const PhaseArchitectureReportModal = lazy(() =>
  import('./components/modals/PhaseArchitectureReportModal').then(m => ({ default: m.PhaseArchitectureReportModal })));

/**
 * Registro de vistas: clave de navegación → componente real y de demo.
 * La arquitectura de información (módulos/submódulos) vive en
 * lib/navigation.ts; aquí solo se resuelve QUÉ componente pinta cada clave.
 */
const VIEW_REGISTRY: Record<ViewKey, { ready: React.ReactElement; demo: React.ReactElement }> = {
  dashboard: { ready: <DashboardSupabaseView />, demo: <DashboardView /> },
  orders:    { ready: <OrdersSupabaseView />,    demo: <OrdersView /> },
  kanban:    { ready: <KanbanSupabaseView />,    demo: <KanbanView /> },
  bays:      { ready: <BaysSupabaseView />,      demo: <BaysView /> },
  quality:   { ready: <QualityView />,           demo: <QualityView /> },
  equipment: { ready: <EquipmentView />,         demo: <EquipmentView /> },
  appointments: { ready: <AppointmentsView />,   demo: <AppointmentsView /> },
  claims:    { ready: <ClaimsView />,            demo: <ClaimsView /> },
  receivables: { ready: <ReceivablesView />,     demo: <ReceivablesView /> },
  fleets:    { ready: <FleetsView />,            demo: <FleetsView /> },
  shifts:    { ready: <ShiftsView />,            demo: <ShiftsView /> },
  attendance: { ready: <AttendanceView />,       demo: <AttendanceView /> },
  payroll:   { ready: <PayrollView />,           demo: <PayrollView /> },
  branches:  { ready: <BranchesView />,          demo: <BranchesView /> },
  promotions: { ready: <PromotionsView />,       demo: <PromotionsView /> },
  alerts:    { ready: <AlertsView />,            demo: <AlertsView /> },
  'credit-notes': { ready: <CreditNotesView />,  demo: <CreditNotesView /> },
  fiscal:    { ready: <FiscalView />,            demo: <FiscalView /> },
  users:     { ready: <UsersView />,             demo: <UsersView /> },
  pos:       { ready: <PosSupabaseView />,       demo: <PosView /> },
  services:  { ready: <ServicesSupabaseView />,  demo: <ServicesView /> },
  invoices:  { ready: <InvoicesSupabaseView />,  demo: <InvoicesView /> },
  cash:      { ready: <CashSupabaseView />,      demo: <CashView /> },
  expenses:  { ready: <ExpensesSupabaseView />,  demo: <ExpensesView /> },
  customers: { ready: <CustomersSupabaseView />, demo: <CustomersView /> },
  vehicles:  { ready: <VehiclesSupabaseView />,  demo: <VehiclesView /> },
  products:  { ready: <ProductsSupabaseView />,  demo: <ProductsView /> },
  'inventory-moves': { ready: <InventoryMovesView />, demo: <InventoryMovesView /> },
  purchases: { ready: <PurchasesView />, demo: <PurchasesView /> },
  suppliers: { ready: <SuppliersView />, demo: <SuppliersView /> },
  team:      { ready: <TeamSupabaseView />,      demo: <TeamView /> },
  reports:   { ready: <ReportsSupabaseView />,   demo: <ReportsView /> },
  'report-sales':  { ready: <SalesReportView />,  demo: <SalesReportView /> },
  'report-margin': { ready: <ProfitReportView />, demo: <ProfitReportView /> },
  'settings-empresa':   { ready: <SettingsSupabaseView seccion="empresa" />,   demo: <SettingsView /> },
  'settings-impresion': { ready: <SettingsSupabaseView seccion="impresion" />, demo: <SettingsView /> },
  'settings-membego':   { ready: <SettingsSupabaseView seccion="membego" />,   demo: <SettingsView /> }
};

/** Marcador mientras llega un fragmento cargado bajo demanda. */
const ChunkFallback: React.FC = () => (
  <div className="p-6 max-w-7xl mx-auto space-y-4" aria-busy="true">
    <div className="h-8 w-56 bg-slate-800/60 rounded-lg animate-pulse" />
    <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
  </div>
);

/** Resuelve el submódulo activo a su vista (real o demo). */
const ActiveView: React.FC = () => {
  const { sub } = useNavigation();
  const { phase } = useAuth();
  if (!sub.view) return null; // los "pronto" los pinta ModulePage
  const entry = VIEW_REGISTRY[sub.view];
  return phase === 'ready' ? entry.ready : entry.demo;
};

const AppContent: React.FC = () => {
  const { isNuevaLlegadaOpen, setIsNuevaLlegadaOpen, isArchModalOpen, setIsArchModalOpen } = useApp();

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      <StorageAlertBanner />
      <DemoModeBanner />
      <Navbar />

      {/* min-h-0 permite que la barra lateral y el contenido tengan CADA UNO su
          propio scroll, en vez de arrastrarse juntos con el scroll de la página. */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />

        <main className="flex-1 min-h-0">
          <ModulePage>
            <Suspense fallback={<ChunkFallback />}>
              <ActiveView />
            </Suspense>
          </ModulePage>
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
    <div role="status" className="bg-indigo-950/60 border-b border-indigo-500/40 px-4 py-2 text-center text-xs text-indigo-200">
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
          <p className="text-sm text-slate-500">Cargando…</p>
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
        <NavigationProvider>
          <AppContent />
        </NavigationProvider>
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
