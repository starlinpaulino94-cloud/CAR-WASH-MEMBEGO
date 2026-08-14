import React, { useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { Invoice, Company } from '../../types';

interface Props {
  invoice: Invoice | null;
  company: Company;
  isOpen: boolean;
  onClose: () => void;
}

export const TicketPreviewModal: React.FC<Props> = ({ invoice, company, isOpen, onClose }) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-800 px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <Printer className="w-4 h-4 text-indigo-400" /> Previsualización de Comprobante / Ticket
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Ticket Container */}
        <div className="p-6 bg-slate-950 flex justify-center overflow-y-auto max-h-[60vh]">
          <div
            ref={printRef}
            className="w-[280px] bg-white text-slate-900 p-4 rounded shadow-md font-mono text-[11px] leading-tight space-y-3"
            style={{ width: company.thermalPrinterWidth === '58mm' ? '200px' : '280px' }}
          >
            {/* Header / Company Branding */}
            <div className="text-center space-y-1 pb-2 border-b border-dashed border-slate-300">
              <div className="font-extrabold text-sm uppercase tracking-tight">{company.tradeName}</div>
              <div className="text-[10px] text-slate-600">{company.legalName}</div>
              <div className="text-[10px]">RNC / RFT: {company.taxId}</div>
              <div className="text-[10px]">Santo Domingo, Rep. Dom.</div>
            </div>

            {/* Ticket Info */}
            <div className="space-y-0.5 text-[10px] pb-2 border-b border-dashed border-slate-300">
              <div className="flex justify-between font-bold">
                <span>COMPROBANTE #:</span>
                <span>{invoice.invoiceNumber}</span>
              </div>
              {invoice.ncfFiscalNumber && (
                <div className="flex justify-between font-bold text-indigo-700">
                  <span>NCF FISCAL:</span>
                  <span>{invoice.ncfFiscalNumber}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>FECHA:</span>
                <span>{new Date(invoice.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>CAJERO:</span>
                <span>{invoice.cashierName}</span>
              </div>
            </div>

            {/* Customer & Vehicle Info */}
            <div className="space-y-0.5 text-[10px] pb-2 border-b border-dashed border-slate-300">
              <div className="flex justify-between">
                <span>CLIENTE:</span>
                <span className="font-bold truncate max-w-[130px]">{invoice.customerName}</span>
              </div>
              {invoice.customerTaxId && (
                <div className="flex justify-between">
                  <span>RNC/CEDULA:</span>
                  <span>{invoice.customerTaxId}</span>
                </div>
              )}
              {invoice.vehiclePlate && (
                <div className="flex justify-between">
                  <span>PLACA VEHICULO:</span>
                  <span className="font-bold bg-slate-100 px-1 rounded">{invoice.vehiclePlate}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="space-y-1.5 pb-2 border-b border-dashed border-slate-300">
              <div className="font-bold flex justify-between border-b border-slate-200 pb-1">
                <span>CANT / DESCRIPCION</span>
                <span>IMPORTE</span>
              </div>
              {invoice.items.map(item => (
                <div key={item.id} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span className="truncate max-w-[180px]">{item.quantity}x {item.name}</span>
                    <span className="font-bold">
                      {item.isMembegoCovered ? '$0.00' : `RD$ ${item.total.toLocaleString()}`}
                    </span>
                  </div>
                  {item.isMembegoCovered && (
                    <div className="text-[9px] text-emerald-700 font-bold pl-2">
                      ✔ CUBIERTO POR MEMBEGO (100% OFF)
                    </div>
                  )}
                  {item.discount > 0 && !item.isMembegoCovered && (
                    <div className="text-[9px] text-slate-500 pl-2">
                      Desc: -RD$ {item.discount.toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between text-slate-600">
                <span>SUBTOTAL:</span>
                <span>RD$ {invoice.subtotal.toLocaleString()}</span>
              </div>
              {invoice.discount > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>DESCUENTO:</span>
                  <span>-RD$ {invoice.discount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>ITBIS / TAX ({company.taxRate}%):</span>
                <span>RD$ {invoice.tax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-extrabold text-sm border-t border-b border-slate-900 py-1 my-1">
                <span>TOTAL A PAGAR:</span>
                <span>RD$ {invoice.total.toLocaleString()}</span>
              </div>
            </div>

            {/* Payments */}
            <div className="space-y-0.5 text-[10px] pb-2 border-b border-dashed border-slate-300">
              {invoice.payments.map((p, idx) => (
                <div key={idx} className="flex justify-between uppercase">
                  <span>PAGO ({p.method.replace('_', ' ')}):</span>
                  <span>RD$ {p.amount.toLocaleString()}</span>
                </div>
              ))}
              {invoice.changeAmount > 0 && (
                <div className="flex justify-between font-bold text-slate-700">
                  <span>CAMBIO:</span>
                  <span>RD$ {invoice.changeAmount.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-center space-y-1 text-[9px] text-slate-600 pt-1">
              <div>{company.headerNote}</div>
              <div className="font-semibold">{company.footerNote}</div>
              <div className="text-[8px] text-slate-400 pt-1">Software: Membego Car Wash Operations • v1.0.4</div>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="bg-slate-800 p-4 border-t border-slate-700 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-white text-xs font-semibold"
          >
            Cerrar
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
          >
            <Printer className="w-4 h-4" /> Imprimir Ticket Termico
          </button>
        </div>
      </div>
    </div>
  );
};
