import React, { useState } from 'react';
import { Users, Search, Plus, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const CustomersView: React.FC = () => {
  const { customers, company, addCustomer } = useApp();
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  );

  const handleAdd = () => {
    if (!name) return;
    addCustomer({
      companyId: 'comp-101',
      branchId: 'branch-1',
      name,
      phone
    });
    setName('');
    setPhone('');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-400" /> Directorio de Clientes
        </h2>
        <p className="text-xs text-slate-400">Historial de visitas, consumos y vinculación con Membego VIP</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o teléfono..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white"
          />

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                  <th className="p-3">NOMBRE</th>
                  <th className="p-3">TELÉFONO</th>
                  <th className="p-3">MEMBEGO TIER</th>
                  <th className="p-3">VISITAS</th>
                  <th className="p-3">TOTAL GASTADO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-slate-800/40">
                    <td className="p-3 font-bold text-white">{c.name}</td>
                    <td className="p-3 text-slate-400">{c.phone || 'N/A'}</td>
                    <td className="p-3">
                      {c.membegoTier ? (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold">
                          {c.membegoTier}
                        </span>
                      ) : (
                        <span className="text-slate-500">Local</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-300 font-bold">{c.totalVisits}</td>
                    <td className="p-3 text-indigo-300 font-bold">{company.currencySymbol} {c.totalSpent.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 h-fit">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Registrar Nuevo Cliente</h3>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-400">Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1"
              />
            </div>
            <div>
              <label className="text-slate-400">Teléfono</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1"
              />
            </div>
            <button
              onClick={handleAdd}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30"
            >
              Guardar Cliente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
