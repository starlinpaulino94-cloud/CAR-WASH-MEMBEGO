import React, { useState } from 'react';
import { CreditCard, DollarSign, Plus, ArrowUpRight, ArrowDownLeft, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const CashView: React.FC = () => {
  const { cashSession, openCashSession, closeCashSession, company, currentUser } = useApp();

  const [initialAmountInput, setInitialAmountInput] = useState<number>(3000);
  const [countedCashInput, setCountedCashInput] = useState<number>(7300);
  const [notesInput, setNotesInput] = useState<string>('');

  const isOpen = cashSession && cashSession.status === 'open';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-400" /> Control de Caja y Arqueos
          </h2>
          <p className="text-xs text-slate-400">Apertura, movimientos en efectivo y cierre ciego por cajero</p>
        </div>
        <div className={`px-3 py-1 rounded-xl text-xs font-bold ${isOpen ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
          {isOpen ? 'Caja Abierta' : 'Caja Cerrada'}
        </div>
      </div>

      {!isOpen ? (
        /* Open Cash Box Form */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md mx-auto space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-indigo-600/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-indigo-500/30">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-base">Apertura de Caja de Turno</h3>
            <p className="text-xs text-slate-400">Ingrese el monto inicial en efectivo para cambio</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400 uppercase">Cajero Responsable</label>
              <input
                type="text"
                value={currentUser.name}
                disabled
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400 uppercase">Monto Inicial ({company.currencySymbol})</label>
              <input
                type="number"
                value={initialAmountInput}
                onChange={e => setInitialAmountInput(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              onClick={() => openCashSession(initialAmountInput, 'Apertura de turno normal')}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all"
            >
              Confirmar Abrir Caja
            </button>
          </div>
        </div>
      ) : (
        /* Active Cash Box Details & Closing Form */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Active Balance Stats */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
              Resumen de la Sesión de Caja (# {cashSession.id})
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-400"><span>Apertura por:</span><span className="font-bold text-white">{cashSession.cashierName}</span></div>
              <div className="flex justify-between text-slate-400"><span>Hora Apertura:</span><span>{new Date(cashSession.openedAt).toLocaleTimeString()}</span></div>
              <div className="flex justify-between text-slate-400"><span>Fondo Inicial:</span><span className="font-bold text-white">{company.currencySymbol} {cashSession.initialAmount.toLocaleString()}</span></div>
              
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex justify-between text-emerald-400"><span>+ Ventas Efectivo:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalCashSales.toLocaleString()}</span></div>
                <div className="flex justify-between text-indigo-400"><span>Ventas Tarjeta:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalCardSales.toLocaleString()}</span></div>
                <div className="flex justify-between text-indigo-400"><span>Ventas Transferencia:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalTransferSales.toLocaleString()}</span></div>
                <div className="flex justify-between text-purple-400"><span>Beneficios Membego:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalMembegoRedemptions.toLocaleString()}</span></div>
                <div className="flex justify-between text-rose-400"><span>- Salidas / Gastos Efectivo:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalOutflows.toLocaleString()}</span></div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center text-sm font-black text-white mt-3">
                <span>Efectivo Esperado en Caja:</span>
                <span className="text-emerald-400">{company.currencySymbol} {cashSession.expectedCash.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Close Cash Box Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
              Arqueo Ciego & Cierre de Caja
            </h3>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-400 uppercase">Efectivo Físico Contado *</label>
                <input
                  type="number"
                  value={countedCashInput}
                  onChange={e => setCountedCashInput(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-base font-bold text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Difference Calculation */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="text-xs text-slate-400 uppercase font-semibold">Diferencia Calculada (Contado vs Esperado)</div>
                <div className={`text-base font-black ${
                  countedCashInput - cashSession.expectedCash === 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {company.currencySymbol} {(countedCashInput - cashSession.expectedCash).toLocaleString()}
                  {countedCashInput - cashSession.expectedCash === 0 ? ' (Caja Cuadrada)' : ' (Descuadre de caja)'}
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-400 uppercase">Observaciones del Cierre</label>
                <textarea
                  value={notesInput}
                  onChange={e => setNotesInput(e.target.value)}
                  placeholder="Ej: Cambio entregado en billetes de RD$200..."
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                onClick={() => closeCashSession(countedCashInput, notesInput)}
                className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition-all"
              >
                Cerrar Caja de Turno
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
