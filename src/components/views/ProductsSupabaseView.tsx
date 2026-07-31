import React, { useState } from 'react';
import { Package, Loader2, Check, X, Pencil, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchProductPage, updateProduct, Product } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice, FilterChips
} from '../common/DataViewShell';

const PAGE_SIZE = 25;

type StockFilter = 'all' | 'low';
const STOCK_FILTERS: { id: StockFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'low', label: 'Bajo stock' }
];

/**
 * Inventario.
 *
 * El stock se ajusta aquí a mano; las ventas lo descuentan y las anulaciones lo
 * devuelven, ambas desde el servidor. Se admite existencia negativa a
 * propósito: bloquear una venta en el mostrador por un descuadre de inventario
 * es peor que dejarlo visible en rojo para que alguien lo corrija.
 */
export const ProductsSupabaseView: React.FC = () => {
  const { company, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const editable = can(profile, 'manageCatalog');

  const [lowOnly, setLowOnly] = useState<StockFilter>('all');
  const q = usePagedQuery<Product>({
    fetcher: (page, size, search) => fetchProductPage(page, size, search, lowOnly === 'low'),
    pageSize: PAGE_SIZE,
    deps: [lowOnly]
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const commit = async (product: Product) => {
    if (busy) return;
    const value = Number(draft);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      setActionError('La existencia debe ser un número entero.');
      return;
    }
    setBusy(true); setActionError(null);
    try {
      await updateProduct(product.id, { stock: value });
      setEditing(null);
      q.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo ajustar la existencia');
    } finally {
      setBusy(false);
    }
  };

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar el inventario" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Package className="w-5 h-5 text-indigo-400" />}
        title="Productos e insumos"
        subtitle="Existencias, costo y precio de venta"
      />

      {!editable && <ReadOnlyNotice>Su rol permite consultar el inventario, pero no ajustarlo.</ReadOnlyNotice>}
      {actionError && <InlineAlert tone="error" onDismiss={() => setActionError(null)}>{actionError}</InlineAlert>}

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBox id="prod-search" label="Buscar producto" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por nombre, código o categoría…" />
        <FilterChips options={STOCK_FILTERS} value={lowOnly} onChange={setLowOnly} />
      </div>

      {lowOnly === 'low' && (
        <InlineAlert tone="warning">
          El filtro de bajo stock se aplica sobre la página mostrada, porque compara dos
          columnas entre sí. Recorra las páginas para ver todos los casos.
        </InlineAlert>
      )}

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Inventario de productos</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">PRODUCTO</th>
                <th scope="col" className="p-3 font-semibold">CATEGORÍA</th>
                <th scope="col" className="p-3 font-semibold text-right">COSTO</th>
                <th scope="col" className="p-3 font-semibold text-right">PRECIO</th>
                <th scope="col" className="p-3 font-semibold text-right">EXISTENCIA</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {q.loading ? <SkeletonRows cols={6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={6}>
                    {q.searchInput || lowOnly === 'low'
                      ? 'Ningún producto coincide con el filtro.'
                      : 'Todavía no hay productos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(p => {
                  const low = p.stock <= p.min_stock;
                  const isEditing = editing === p.id;
                  return (
                    <tr key={p.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-bold text-white">{p.name}</div>
                        <div className="text-[10px] text-slate-500">{p.code}</div>
                      </td>
                      <td className="p-3 text-slate-400">{p.category || '—'}</td>
                      <td className="p-3 text-slate-300 text-right whitespace-nowrap">
                        {formatCents(p.cost_cents, symbol)}
                      </td>
                      <td className="p-3 font-bold text-indigo-300 text-right whitespace-nowrap">
                        {p.is_for_sale ? formatCents(p.price_cents, symbol) : 'Uso interno'}
                      </td>
                      <td className="p-3 text-right">
                        {isEditing ? (
                          <span className="flex items-center gap-1 justify-end">
                            <input autoFocus type="number" value={draft} disabled={busy}
                              onChange={e => setDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void commit(p);
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              aria-label={`Existencia de ${p.name}`}
                              className="w-20 bg-slate-950 border border-indigo-500 rounded p-1 text-right text-white" />
                            <button onClick={() => void commit(p)} disabled={busy} aria-label="Guardar"
                              className="p-1 text-emerald-400">
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setEditing(null)} disabled={busy} aria-label="Cancelar"
                              className="p-1 text-slate-500"><X className="w-3.5 h-3.5" /></button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { if (editable) { setEditing(p.id); setDraft(String(p.stock)); } }}
                            disabled={!editable}
                            aria-label={`Existencia de ${p.name}`}
                            className={`px-2 py-1 rounded font-extrabold tabular-nums ${
                              p.stock < 0 ? 'text-rose-400' : 'text-white'
                            } ${editable ? 'hover:bg-slate-800' : 'cursor-default'}`}
                          >
                            {p.stock} {p.unit}
                            {editable && <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />}
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        {p.stock < 0 ? (
                          <span className="bg-rose-500/20 text-rose-400 font-bold px-2 py-0.5 rounded text-[10px] inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Negativo
                          </span>
                        ) : low ? (
                          <span className="bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded text-[10px]">
                            Bajo (mín. {p.min_stock})
                          </span>
                        ) : (
                          <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-[10px]">
                            Normal
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>
    </div>
  );
};
