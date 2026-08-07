import React from 'react';
import { BarChart3, ShieldCheck, FileText } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ReportsView: React.FC = () => {
  const { auditLogs, invoices, company, workOrders } = useApp();

  const totalSales = invoices.reduce((acc, i) => acc + (i.isAnulled ? 0 : i.total), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-400" /> Reportes & Audit Trail Inalterable
        </h2>
        <p className="text-xs text-slate-400">Auditoría detallada de acciones sensibles y métricas operacionales</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="text-xs text-slate-400">Total Ingresos Facturados</div>
          <div className="text-xl font-black text-emerald-400">{company.currencySymbol} {totalSales.toLocaleString()}</div>
        </div>
        <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="text-xs text-slate-400">Órdenes Atendidas</div>
          <div className="text-xl font-black text-indigo-400">{workOrders.length} órdenes</div>
        </div>
        <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-1">
          <div className="text-xs text-slate-400">Acciones Auditadas</div>
          <div className="text-xl font-black text-amber-400">{auditLogs.length} eventos</div>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm">Bitácora de Auditoría del Sistema</h3>
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {auditLogs.map(log => (
            <div key={log.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
              <div className="flex justify-between font-bold">
                <span className="text-indigo-400">{log.action}</span>
                <span className="text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
              </div>
              <div className="text-slate-300">{log.details}</div>
              <div className="text-xs text-slate-500">Usuario: {log.userName} ({log.userRole})</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
