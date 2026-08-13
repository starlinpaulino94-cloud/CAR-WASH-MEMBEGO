import React, { useState } from 'react';
import { DollarSign, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ExpensesView: React.FC = () => {
  const { expenses, addExpense, company } = useApp();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number>(500);

  const handleAdd = () => {
    if (!description || amount <= 0) return;
    addExpense({
      companyId: 'comp-101',
      branchId: 'branch-1',
      category: 'quimicos_insumos',
      description,
      amount,
      paymentMethod: 'efectivo',
      expenseDate: new Date().toISOString(),
      createdBy: 'usr-2'
    });
    setDescription('');
    setAmount(0);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-brand" /> Gastos Operativos & Compras
        </h2>
        <p className="text-xs text-muted">Registro de salidas de caja para compras de jabón, agua, luz y mantenimientos</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface/80 border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th className="p-3">CONCEPTO / DESCRIPCIÓN</th>
                <th className="p-3">CATEGORÍA</th>
                <th className="p-3">MÉTODO PAGO</th>
                <th className="p-3">MONTO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {expenses.map(e => (
                <tr key={e.id} className="hover:bg-surface-2/40">
                  <td className="p-3 font-bold text-strong">{e.description}</td>
                  <td className="p-3 text-muted">{e.category}</td>
                  <td className="p-3 text-body uppercase">{e.paymentMethod}</td>
                  <td className="p-3 font-extrabold text-danger">-{company.currencySymbol} {e.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-surface border border-line rounded-2xl p-5 space-y-4 h-fit">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2">Registrar Gasto Rápido</h3>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-muted">Descripción *</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ej: Compra de toallas extra..."
                className="w-full bg-canvas border border-line rounded-lg p-2 text-strong mt-1"
              />
            </div>
            <div>
              <label className="text-muted">Monto ({company.currencySymbol}) *</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(Number(e.target.value))}
                className="w-full bg-canvas border border-line rounded-lg p-2 text-strong mt-1 font-bold"
              />
            </div>
            <button
              onClick={handleAdd}
              className="w-full py-2.5 bg-danger hover:bg-danger text-on-accent font-bold rounded-xl text-xs shadow-lg shadow-danger/30"
            >
              Registrar Gasto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
