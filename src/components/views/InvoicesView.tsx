import React, { useState } from 'react';
import { Receipt, Search, Printer, Ban } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Invoice } from '../../types';
import { TicketPreviewModal } from '../modals/TicketPreviewModal';

export const InvoicesView: React.FC = () => {
  const { invoices, company, annulInvoice } = useApp();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Receipt className="w-5 h-5 text-indigo-400" /> Historial de Facturas & Comprobantes
        </h2>
        <p className="text-xs text-slate-400">Reimpresión de tickets térmicos, NCF fiscal y anulaciones</p>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
              <th className="p-3">COMPROBANTE</th>
              <th className="p-3">FECHA</th>
              <th className="p-3">CLIENTE</th>
              <th className="p-3">NCF FISCAL</th>
              <th className="p-3">TOTAL</th>
              <th className="p-3 text-right">ACCIONES</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {invoices.map(inv => (
              <tr key={inv.id} className={`hover:bg-slate-800/40 ${inv.isAnulled ? 'opacity-50 line-through' : ''}`}>
                <td className="p-3 font-bold text-indigo-300">{inv.invoiceNumber}</td>
                <td className="p-3 text-slate-400">{new Date(inv.createdAt).toLocaleString()}</td>
                <td className="p-3 text-white font-medium">{inv.customerName}</td>
                <td className="p-3 text-slate-300 font-mono">{inv.ncfFiscalNumber || 'Consumidor Final'}</td>
                <td className="p-3 font-bold text-white">{company.currencySymbol} {inv.total.toLocaleString()}</td>
                <td className="p-3 text-right flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs flex items-center gap-1 font-semibold"
                  >
                    <Printer className="w-3.5 h-3.5" /> Reimprimir Ticket
                  </button>
                  {!inv.isAnulled && (
                    <button
                      onClick={() => annulInvoice(inv.id, 'Anulación solicitada por cajero')}
                      className="p-1.5 bg-rose-600/30 text-rose-300 hover:bg-rose-600 hover:text-white rounded text-xs flex items-center gap-1 font-semibold border border-rose-500/30"
                    >
                      <Ban className="w-3.5 h-3.5" /> Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TicketPreviewModal
        invoice={selectedInvoice}
        company={company}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};
