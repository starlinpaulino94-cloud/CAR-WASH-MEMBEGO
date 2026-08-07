import React, { useCallback, useEffect, useState } from 'react';
import { X, Trash2, Loader2, FlaskConical } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import {
  fetchServiceRecipes, addRecipeLine, deleteRecipeLine, fetchRecipeCost,
  fetchProductPage, ServiceRecipe, Product, VehicleCategory
} from '../../data/adminRepository';
import { InlineAlert } from '../common/DataViewShell';
import { Field, textInputClass } from '../common/FormModal';

const CATEGORIES: { id: VehicleCategory | ''; label: string }[] = [
  { id: '', label: 'Todas las categorías' },
  { id: 'sedan', label: 'Sedán' }, { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep' }, { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' }, { id: 'truck', label: 'Camión' },
  { id: 'motorcycle', label: 'Motor' }, { id: 'special', label: 'Especial' }
];

/**
 * Receta de insumos de un servicio.
 *
 * Define qué consume cada lavado (en la unidad del producto, admite fracciones:
 * 0.12 galones) y con qué variante por categoría. Al ENTREGAR una orden, el
 * servidor descuenta el consumo y registra su costo exacto: de aquí sale el
 * margen real por servicio.
 */
export const RecipeModal: React.FC<{
  serviceId: string;
  serviceName: string;
  onClose: () => void;
}> = ({ serviceId, serviceName, onClose }) => {
  const { company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [lines, setLines] = useState<ServiceRecipe[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [category, setCategory] = useState<VehicleCategory | ''>('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [ls, c] = await Promise.all([
        fetchServiceRecipes(serviceId),
        fetchRecipeCost(serviceId)
      ]);
      setLines(ls); setCost(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la receta');
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void reload();
    fetchProductPage(0, 200, '', false).then(r => setProducts(r.rows)).catch(() => setProducts([]));
  }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async () => {
    if (busy) return;
    const value = Number(qty);
    if (!productId) { setError('Elija el insumo.'); return; }
    if (!Number.isFinite(value) || value <= 0) { setError('La cantidad debe ser mayor que cero (admite decimales).'); return; }
    if (!company) return;
    setBusy(true); setError(null);
    try {
      await addRecipeLine({
        companyId: company.id, serviceId, productId,
        vehicleCategory: category === '' ? null : category,
        quantity: value
      });
      setProductId(''); setCategory(''); setQty('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el renglón');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteRecipeLine(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el renglón');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Receta de ${serviceName}`}
        className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="font-bold text-white text-sm flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-purple-400" /> Receta — {serviceName}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

          <p className="text-sm text-slate-400">
            Lo que consume cada ejecución, en la unidad del insumo (admite fracciones:
            <span className="font-mono"> 0.12</span> galones). Al entregar la orden se descuenta
            y su costo queda registrado para el margen real.
          </p>

          {loading ? (
            <div className="h-24 bg-slate-800/60 rounded-xl animate-pulse" />
          ) : lines.length === 0 ? (
            <p className="text-sm text-slate-500 italic p-4 text-center bg-slate-950/50 rounded-xl">
              Este servicio aún no tiene receta: no descuenta insumos al entregarse.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-xs">
                    <th className="py-2 pr-3 font-semibold">INSUMO</th>
                    <th className="py-2 pr-3 font-semibold">CATEGORÍA</th>
                    <th className="py-2 pr-3 font-semibold text-right">CANTIDAD</th>
                    <th className="py-2 pr-3 font-semibold text-right">COSTO</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {lines.map(l => (
                    <tr key={l.id}>
                      <td className="py-2 pr-3">
                        <div className="font-bold text-white">{l.products?.name}</div>
                        <div className="text-xs text-slate-500">{l.products?.code}</div>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {l.vehicle_category
                          ? CATEGORIES.find(c => c.id === l.vehicle_category)?.label ?? l.vehicle_category
                          : <span className="text-slate-500">Todas</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">
                        {l.quantity} {l.products?.unit}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                        {formatCents(Math.round(l.quantity * (l.products?.cost_cents ?? 0)), symbol)}
                      </td>
                      <td className="py-2 text-right">
                        <button onClick={() => void remove(l.id)} aria-label="Quitar renglón"
                          className="p-1.5 text-slate-500 hover:text-rose-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cost !== null && lines.length > 0 && (
            <p className="text-sm text-slate-300 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
              Costo estimado por ejecución (receta genérica):{' '}
              <strong className="text-purple-300 tabular-nums">{formatCents(cost, symbol)}</strong>
            </p>
          )}

          <div className="border-t border-slate-800 pt-4 space-y-3">
            <span className="text-sm font-semibold text-slate-400 uppercase">Agregar insumo</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Insumo *" htmlFor="rec-prod">
                <select id="rec-prod" className={textInputClass} value={productId}
                  onChange={e => setProductId(e.target.value)}>
                  <option value="">— Elegir —</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                  ))}
                </select>
              </Field>
              <Field label="Categoría" htmlFor="rec-cat">
                <select id="rec-cat" className={textInputClass} value={category}
                  onChange={e => setCategory(e.target.value as VehicleCategory | '')}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Cantidad *" htmlFor="rec-qty" hint="En la unidad del insumo.">
                <input id="rec-qty" type="text" inputMode="decimal" className={textInputClass}
                  value={qty} onChange={e => setQty(e.target.value)} placeholder="0.12" />
              </Field>
            </div>
            <button onClick={() => void add()} disabled={busy}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Agregar a la receta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
