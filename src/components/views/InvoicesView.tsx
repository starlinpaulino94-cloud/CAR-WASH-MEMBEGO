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
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <Receipt className="w-5 h-5 text-brand" /> Historial de Facturas & Comprobantes
        </h2>
        <p className="text-xs text-muted">Reimpresión de tickets térmicos, NCF fiscal y anulaciones</p>
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-line text-muted bg-canvas/50">
              <th className="p-3">COMPROBANTE</th>
              <th className="p-3">FECHA</th>
              <th className="p-3">CLIENTE</th>
              <th className="p-3">NCF FISCAL</th>
              <th className="p-3">TOTAL</th>
              <th className="p-3 text-right">ACCIONES</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {invoices.map(inv => (
              <tr key={inv.id} className={`hover:bg-surface-2/40 ${inv.isAnulled ? 'opacity-50 line-through' : ''}`}>
                <td className="p-3 font-bold text-brand-hi">{inv.invoiceNumber}</td>
                <td className="p-3 text-muted">{new Date(inv.createdAt).toLocaleString()}</td>
                <td className="p-3 text-strong font-medium">{inv.customerName}</td>
                <td className="p-3 text-body font-mono">{inv.ncfFiscalNumber || 'Consumidor Final'}</td>
                <td className="p-3 font-bold text-strong">{company.currencySymbol} {inv.total.toLocaleString()}</td>
                <td className="p-3 text-right flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 bg-brand hover:bg-brand text-on-accent rounded text-xs flex items-center gap-1 font-semibold"
                  >
                    <Printer className="w-3.5 h-3.5" /> Reimprimir Ticket
                  </button>
                  {!inv.isAnulled && (
                    <button
                      onClick={() => annulInvoice(inv.id, 'Anulación solicitada por cajero')}
                      className="p-1.5 bg-danger/30 text-danger hover:bg-danger hover:text-on-accent rounded text-xs flex items-center gap-1 font-semibold border border-danger/30"
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
