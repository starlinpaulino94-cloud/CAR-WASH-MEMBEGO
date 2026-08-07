import React from 'react';
import { Briefcase, DollarSign } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const TeamView: React.FC = () => {
  const { users, commissions, company } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-indigo-400" /> Empleados & Comisiones de Lavadores
        </h2>
        <p className="text-xs text-slate-400">Listado de personal, roles y cálculo automático de comisiones por orden</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User list */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Personal del Car Wash</h3>
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                <div>
                  <div className="font-bold text-white">{u.name}</div>
                  <div className="text-slate-400">{u.email} • Tel: {u.phone}</div>
                </div>
                <div className="text-right">
                  <span className="bg-indigo-950 text-indigo-300 font-bold px-2 py-0.5 rounded text-xs uppercase">
                    {u.role}
                  </span>
                  {u.commissionRate && (
                    <div className="text-xs text-emerald-400 font-bold mt-1">
                      Comisión: {u.commissionRate}%
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Commissions entries */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Registro de Comisiones Ganadas</h3>
          <div className="space-y-2">
            {commissions.map(c => (
              <div key={c.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                <div>
                  <div className="font-bold text-white">{c.employeeName}</div>
                  <div className="text-slate-400">{c.serviceName} ({c.commissionPercent}%)</div>
                </div>
                <div className="text-right font-extrabold text-emerald-400">
                  +{company.currencySymbol} {c.commissionAmount.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
