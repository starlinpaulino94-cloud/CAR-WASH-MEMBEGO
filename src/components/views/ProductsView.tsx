import React from 'react';
import { Package } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ProductsView: React.FC = () => {
  const { products, company } = useApp();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Package className="w-5 h-5 text-indigo-400" /> Inventario de Productos e Insumos
        </h2>
        <p className="text-xs text-slate-400">Control de stock de aromatizantes, toallas, productos de venta y químicos</p>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
              <th className="p-3">PRODUCTO</th>
              <th className="p-3">CATEGORÍA</th>
              <th className="p-3">COSTO</th>
              <th className="p-3">PRECIO VENTA</th>
              <th className="p-3">EXISTENCIA</th>
              <th className="p-3">ESTADO STOCK</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-slate-800/40">
                <td className="p-3 font-bold text-white">{p.name}</td>
                <td className="p-3 text-slate-400">{p.category}</td>
                <td className="p-3 text-slate-300">{company.currencySymbol} {p.cost}</td>
                <td className="p-3 font-bold text-indigo-300">{p.isForSale ? `${company.currencySymbol} ${p.price}` : 'Uso Interno'}</td>
                <td className="p-3 font-extrabold text-white">{p.stock} {p.unit}</td>
                <td className="p-3">
                  {p.stock <= p.minStock ? (
                    <span className="bg-rose-500/20 text-rose-400 font-bold px-2 py-0.5 rounded text-[10px]">
                      Bajo Stock
                    </span>
                  ) : (
                    <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-[10px]">
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
