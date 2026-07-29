import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
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
import { PhaseArchitectureReportModal } from './components/modals/PhaseArchitectureReportModal';

const AppContent: React.FC = () => {
  const { activeTab, isNuevaLlegadaOpen, setIsNuevaLlegadaOpen, isArchModalOpen, setIsArchModalOpen } = useApp();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      <Navbar />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 overflow-y-auto min-h-[calc(100vh-57px)]">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'orders' && <OrdersView />}
          {activeTab === 'kanban' && <KanbanView />}
          {activeTab === 'bays' && <BaysView />}
          {activeTab === 'pos' && <PosView />}
          {activeTab === 'cash' && <CashView />}
          {activeTab === 'invoices' && <InvoicesView />}
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

      {/* Global Modals */}
      <NuevaLlegadaModal
        isOpen={isNuevaLlegadaOpen}
        onClose={() => setIsNuevaLlegadaOpen(false)}
      />

      <PhaseArchitectureReportModal
        isOpen={isArchModalOpen}
        onClose={() => setIsArchModalOpen(false)}
      />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
