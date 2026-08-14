import React, { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { QueueCountProvider } from './context/QueueCountContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView, UnprovisionedView } from './components/auth/LoginView';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { ModulePage } from './components/layout/ModulePage';
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
const AppearanceSettingsView = lazyView(() => import('./components/views/AppearanceSettingsView'), 'AppearanceSettingsView');

// --- Vistas de demostración (sin base de datos conectada)

const PhaseArchitectureReportModal = lazy(() =>
  import('./components/modals/PhaseArchitectureReportModal').then(m => ({ default: m.PhaseArchitectureReportModal })));

/**
 * Registro de vistas: clave de navegación → componente real y de demo.
 * La arquitectura de información (módulos/submódulos) vive en
 * lib/navigation.ts; aquí solo se resuelve QUÉ componente pinta cada clave.
 */
const VIEW_REGISTRY: Record<ViewKey, React.ReactElement> = {
  dashboard: <DashboardSupabaseView />,
  orders: <OrdersSupabaseView />,
  kanban: <KanbanSupabaseView />,
  bays: <BaysSupabaseView />,
  quality: <QualityView />,
  equipment: <EquipmentView />,
  appointments: <AppointmentsView />,
  claims: <ClaimsView />,
  receivables: <ReceivablesView />,
  fleets: <FleetsView />,
  shifts: <ShiftsView />,
  attendance: <AttendanceView />,
  payroll: <PayrollView />,
  branches: <BranchesView />,
  promotions: <PromotionsView />,
  alerts: <AlertsView />,
  'credit-notes': <CreditNotesView />,
  fiscal: <FiscalView />,
  users: <UsersView />,
  pos: <PosSupabaseView />,
  services: <ServicesSupabaseView />,
  invoices: <InvoicesSupabaseView />,
  cash: <CashSupabaseView />,
  expenses: <ExpensesSupabaseView />,
  customers: <CustomersSupabaseView />,
  vehicles: <VehiclesSupabaseView />,
  products: <ProductsSupabaseView />,
  'inventory-moves': <InventoryMovesView />,
  purchases: <PurchasesView />,
  suppliers: <SuppliersView />,
  team: <TeamSupabaseView />,
  reports: <ReportsSupabaseView />,
  'report-sales': <SalesReportView />,
  'report-margin': <ProfitReportView />,
  'settings-empresa': <SettingsSupabaseView seccion="empresa" />,
  'settings-apariencia': <AppearanceSettingsView />,
  'settings-impresion': <SettingsSupabaseView seccion="impresion" />,
  'settings-membego': <SettingsSupabaseView seccion="membego" />,
};

/** Marcador mientras llega un fragmento cargado bajo demanda. */
const ChunkFallback: React.FC = () => (
  <div className="p-6 max-w-7xl mx-auto space-y-4" aria-busy="true">
    <div className="h-8 w-56 bg-surface-2/60 rounded-lg animate-pulse" />
    <div className="h-64 bg-surface border border-line rounded-2xl animate-pulse" />
  </div>
);

/** Resuelve el submódulo activo a su vista (real o demo). */
const ActiveView: React.FC = () => {
  const { sub } = useNavigation();
  const { phase } = useAuth();
  if (!sub.view) return null; // los "pronto" los pinta ModulePage
  return VIEW_REGISTRY[sub.view];
};

const AppContent: React.FC = () => {
  return (
    <div className="h-screen overflow-hidden bg-canvas text-strong flex flex-col font-sans selection:bg-brand selection:text-on-accent">
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

    </div>
  );
};

/** Decide qué mostrar según el estado de la sesión. */
const AuthGate: React.FC = () => {
  const { phase } = useAuth();

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center" aria-busy="true">
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand to-accent mx-auto animate-pulse" />
          <p className="text-sm text-faint">Cargando…</p>
        </div>
      </div>
    );
  }

  // Sin base de datos el sistema NO funciona, y lo dice en vez de fingir.
  //
  // Antes había un «modo demostración» que arrancaba con datos inventados en el
  // navegador. Parecía inofensivo y no lo era: un operador podía pasar el día
  // cobrando contra datos falsos —el aviso de arriba se ignora en cuanto la
  // pantalla siguiente se ve normal— y al cerrar el navegador no quedaba nada.
  // En un sistema de caja, una interfaz que responde sin guardar es peor que
  // una que no abre.
  if (phase === 'unconfigured') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-danger/20 border border-danger/40 mx-auto flex items-center justify-center">
            <span className="text-danger text-2xl font-black">!</span>
          </div>
          <h1 className="text-xl font-bold text-strong">Sin base de datos</h1>
          <p className="text-sm text-body">
            El sistema no está conectado a Supabase, así que no puede registrar
            nada. No se abre en modo de prueba a propósito: cobrar contra datos
            que no se guardan es peor que no poder cobrar.
          </p>
          <p className="text-xs text-faint">
            Configure <code className="text-muted">VITE_SUPABASE_URL</code> y{' '}
            <code className="text-muted">VITE_SUPABASE_ANON_KEY</code> y vuelva a
            cargar.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'signed_out') return <LoginView />;
  if (phase === 'unprovisioned') return <UnprovisionedView />;

  return (
    <QueueCountProvider>
        <NavigationProvider>
          <AppContent />
        </NavigationProvider>
    </QueueCountProvider>
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
