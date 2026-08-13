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
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-brand" /> Control de Caja y Arqueos
          </h2>
          <p className="text-xs text-muted">Apertura, movimientos en efectivo y cierre ciego por cajero</p>
        </div>
        <div className={`px-3 py-1 rounded-xl text-xs font-bold ${isOpen ? 'bg-success/20 text-success border border-success/30' : 'bg-danger/20 text-danger border border-danger/30'}`}>
          {isOpen ? 'Caja Abierta' : 'Caja Cerrada'}
        </div>
      </div>

      {!isOpen ? (
        /* Open Cash Box Form */
        <div className="bg-surface border border-line rounded-2xl p-6 max-w-md mx-auto space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-brand/20 text-brand rounded-2xl flex items-center justify-center mx-auto mb-2 border border-brand/30">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-strong text-base">Apertura de Caja de Turno</h3>
            <p className="text-xs text-muted">Ingrese el monto inicial en efectivo para cambio</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted uppercase">Cajero Responsable</label>
              <input
                type="text"
                value={currentUser.name}
                disabled
                className="w-full bg-canvas border border-line rounded-xl p-3 text-xs text-muted font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted uppercase">Monto Inicial ({company.currencySymbol})</label>
              <input
                type="number"
                value={initialAmountInput}
                onChange={e => setInitialAmountInput(Number(e.target.value))}
                className="w-full bg-canvas border border-line rounded-xl p-3 text-sm font-bold text-strong focus:outline-none focus:border-brand"
              />
            </div>

            <button
              onClick={() => openCashSession(initialAmountInput, 'Apertura de turno normal')}
              className="w-full py-3 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-all"
            >
              Confirmar Abrir Caja
            </button>
          </div>
        </div>
      ) : (
        /* Active Cash Box Details & Closing Form */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Active Balance Stats */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
              Resumen de la Sesión de Caja (# {cashSession.id})
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-muted"><span>Apertura por:</span><span className="font-bold text-strong">{cashSession.cashierName}</span></div>
              <div className="flex justify-between text-muted"><span>Hora Apertura:</span><span>{new Date(cashSession.openedAt).toLocaleTimeString()}</span></div>
              <div className="flex justify-between text-muted"><span>Fondo Inicial:</span><span className="font-bold text-strong">{company.currencySymbol} {cashSession.initialAmount.toLocaleString()}</span></div>
              
              <div className="pt-2 border-t border-line space-y-1.5">
                <div className="flex justify-between text-success"><span>+ Ventas Efectivo:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalCashSales.toLocaleString()}</span></div>
                <div className="flex justify-between text-brand"><span>Ventas Tarjeta:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalCardSales.toLocaleString()}</span></div>
                <div className="flex justify-between text-brand"><span>Ventas Transferencia:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalTransferSales.toLocaleString()}</span></div>
                <div className="flex justify-between text-accent"><span>Beneficios Membego:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalMembegoRedemptions.toLocaleString()}</span></div>
                <div className="flex justify-between text-danger"><span>- Salidas / Gastos Efectivo:</span><span className="font-bold">{company.currencySymbol} {cashSession.totalOutflows.toLocaleString()}</span></div>
              </div>

              <div className="p-3 bg-canvas rounded-xl border border-line flex justify-between items-center text-sm font-black text-strong mt-3">
                <span>Efectivo Esperado en Caja:</span>
                <span className="text-success">{company.currencySymbol} {cashSession.expectedCash.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Close Cash Box Form */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
              Arqueo Ciego & Cierre de Caja
            </h3>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-muted uppercase">Efectivo Físico Contado *</label>
                <input
                  type="number"
                  value={countedCashInput}
                  onChange={e => setCountedCashInput(Number(e.target.value))}
                  className="w-full bg-canvas border border-line rounded-xl p-3 text-base font-bold text-strong focus:outline-none focus:border-brand"
                />
              </div>

              {/* Difference Calculation */}
              <div className="p-3 bg-canvas rounded-xl border border-line space-y-1">
                <div className="text-xs text-muted uppercase font-semibold">Diferencia Calculada (Contado vs Esperado)</div>
                <div className={`text-base font-black ${
                  countedCashInput - cashSession.expectedCash === 0 ? 'text-success' : 'text-danger'
                }`}>
                  {company.currencySymbol} {(countedCashInput - cashSession.expectedCash).toLocaleString()}
                  {countedCashInput - cashSession.expectedCash === 0 ? ' (Caja Cuadrada)' : ' (Descuadre de caja)'}
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-muted uppercase">Observaciones del Cierre</label>
                <textarea
                  value={notesInput}
                  onChange={e => setNotesInput(e.target.value)}
                  placeholder="Ej: Cambio entregado en billetes de RD$200..."
                  rows={2}
                  className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-strong focus:outline-none focus:border-brand"
                />
              </div>

              <button
                onClick={() => closeCashSession(countedCashInput, notesInput)}
                className="w-full py-3 bg-danger hover:bg-danger text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-danger/30 transition-all"
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
