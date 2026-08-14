import React from 'react';
import { Package } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ProductsView: React.FC = () => {
  const { products, company } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-bold text-strong flex items-center gap-2">
          <Package className="w-5 h-5 text-brand" /> Inventario de Productos e Insumos
        </h2>
        <p className="text-xs text-muted">Control de stock de aromatizantes, toallas, productos de venta y químicos</p>
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted bg-canvas/50">
              <th className="p-3">PRODUCTO</th>
              <th className="p-3">CATEGORÍA</th>
              <th className="p-3">COSTO</th>
              <th className="p-3">PRECIO VENTA</th>
              <th className="p-3">EXISTENCIA</th>
              <th className="p-3">ESTADO STOCK</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-surface-2/40">
                <td className="p-3 font-bold text-strong">{p.name}</td>
                <td className="p-3 text-muted">{p.category}</td>
                <td className="p-3 text-body">{company.currencySymbol} {p.cost}</td>
                <td className="p-3 font-bold text-brand-hi">{p.isForSale ? `${company.currencySymbol} ${p.price}` : 'Uso Interno'}</td>
                <td className="p-3 font-extrabold text-strong">{p.stock} {p.unit}</td>
                <td className="p-3">
                  {p.stock <= p.minStock ? (
                    <span className="bg-danger/20 text-danger font-bold px-2 py-0.5 rounded text-xs">
                      Bajo Stock
                    </span>
                  ) : (
                    <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">
                      Normal
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
