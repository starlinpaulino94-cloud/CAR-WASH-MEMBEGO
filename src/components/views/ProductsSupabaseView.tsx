import React, { useState } from 'react';
import { Package, Pencil, AlertTriangle, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchProductPage, adjustStock, createProduct, Product } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice, FilterChips
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { ExportButton } from '../common/ExportButton';
import { ImportButton } from '../common/ImportModal';
import { productsExport } from '../../lib/exportSpecs';

const PAGE_SIZE = 25;

const emptyProductForm = {
  name: '', code: '', category: '', cost: '', price: '',
  stock: '0', minStock: '0', unit: 'Unidad', forSale: true
};

type StockFilter = 'all' | 'low';
const STOCK_FILTERS: { id: StockFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'low', label: 'Bajo stock' }
];

/**
 * Inventario.
 *
 * La existencia NO se edita a mano: desde 0019 todo cambio es un MOVIMIENTO
 * (venta, devolución, ajuste, consumo…). El botón de la existencia abre el
 * ajuste con motivo obligatorio, que el servidor registra en el kardex y en la
 * bitácora. Se admite existencia negativa a propósito: bloquear una venta en
 * el mostrador por un descuadre es peor que dejarlo visible en rojo.
 */
export const ProductsSupabaseView: React.FC = () => {
  const { company, branch, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const editable = can(profile, 'manageCatalog');

  const [lowOnly, setLowOnly] = useState<StockFilter>('all');
  const q = usePagedQuery<Product>({
    fetcher: (page, size, search) => fetchProductPage(page, size, search, lowOnly === 'low'),
    pageSize: PAGE_SIZE,
    deps: [lowOnly]
  });

  // Ajuste de existencia: modal con cantidad nueva y motivo (obligatorio).
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyProductForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openCreate = () => { setForm(emptyProductForm); setCreateError(null); setShowCreate(true); };

  const submitCreate = async () => {
    if (!company) return;
    if (!form.name.trim() || !form.code.trim()) { setCreateError('El nombre y el código son obligatorios.'); return; }
    const stock = Number(form.stock);
    const minStock = Number(form.minStock);
    if (!Number.isInteger(stock)) { setCreateError('La existencia debe ser un número entero.'); return; }
    if (!Number.isInteger(minStock) || minStock < 0) { setCreateError('El mínimo debe ser un entero no negativo.'); return; }

    setCreateBusy(true); setCreateError(null);
    try {
      await createProduct({
        companyId: company.id, branchId: branch?.id ?? null,
        code: form.code, name: form.name, category: form.category,
        costCents: parseAmountToCents(form.cost) ?? 0,
        priceCents: parseAmountToCents(form.price) ?? 0,
        stock, minStock, unit: form.unit, isForSale: form.forSale
      });
      setShowCreate(false); setForm(emptyProductForm);
      q.reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo crear el producto');
    } finally {
      setCreateBusy(false);
    }
  };

  const openAdjust = (product: Product) => {
    setAdjusting(product);
    setAdjustQty(String(product.stock));
    setAdjustReason('');
    setActionError(null);
  };

  const submitAdjust = async () => {
    if (!adjusting || busy) return;
    const value = Number(adjustQty);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      setActionError('La existencia debe ser un número entero.');
      return;
    }
    if (adjustReason.trim().length < 5) {
      setActionError('Explique el motivo del ajuste (mínimo 5 caracteres).');
      return;
    }
    setBusy(true); setActionError(null);
    try {
      await adjustStock(adjusting.id, value, adjustReason.trim());
      setAdjusting(null);
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
        actions={
          <>
            <ExportButton {...productsExport()} />
            {can(profile, 'importData') && (
              <ImportButton entity="productos" onImported={q.reload} />
            )}
            {editable && (
              <button onClick={openCreate}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
                <Plus className="w-4 h-4" /> Nuevo producto
              </button>
            )}
          </>
        }
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
                  return (
                    <tr key={p.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-bold text-white">{p.name}</div>
                        <div className="text-xs text-slate-500">{p.code}</div>
                      </td>
                      <td className="p-3 text-slate-400">{p.category || '—'}</td>
                      <td className="p-3 text-slate-300 text-right whitespace-nowrap">
                        {formatCents(p.cost_cents, symbol)}
                      </td>
                      <td className="p-3 font-bold text-indigo-300 text-right whitespace-nowrap">
                        {p.is_for_sale ? formatCents(p.price_cents, symbol) : 'Uso interno'}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => { if (editable) openAdjust(p); }}
                          disabled={!editable}
                          aria-label={`Existencia de ${p.name}`}
                          title={editable ? 'Ajustar existencia (queda en el kardex)' : undefined}
                          className={`px-2 py-1 rounded font-extrabold tabular-nums ${
                            p.stock < 0 ? 'text-rose-400' : 'text-white'
                          } ${editable ? 'hover:bg-slate-800' : 'cursor-default'}`}
                        >
                          {p.stock} {p.unit}
                          {editable && <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />}
                        </button>
                      </td>
                      <td className="p-3">
                        {p.stock < 0 ? (
                          <span className="bg-rose-500/20 text-rose-400 font-bold px-2 py-0.5 rounded text-xs inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Negativo
                          </span>
                        ) : low ? (
                          <span className="bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded text-xs">
                            Bajo (mín. {p.min_stock})
                          </span>
                        ) : (
                          <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-xs">
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

      {adjusting && (
        <FormModal
          title={`Ajustar existencia — ${adjusting.name}`}
          submitLabel="Registrar ajuste"
          busy={busy}
          error={actionError}
          onSubmit={() => void submitAdjust()}
          onClose={() => setAdjusting(null)}
          onDismissError={() => setActionError(null)}
        >
          <p className="text-sm text-slate-400">
            Existencia actual: <strong className="text-white tabular-nums">{adjusting.stock} {adjusting.unit}</strong>.
            El ajuste queda registrado en el kardex con su motivo, autor y fecha.
          </p>
          <Field label="Nueva existencia *" htmlFor="adj-qty">
            <input id="adj-qty" type="number" autoFocus className={textInputClass} value={adjustQty}
              aria-label={`Nueva existencia de ${adjusting.name}`}
              onChange={e => setAdjustQty(e.target.value)} />
          </Field>
          <Field label="Motivo del ajuste *" htmlFor="adj-reason"
            hint="Ej.: conteo físico, merma, derrame, corrección de entrada.">
            <input id="adj-reason" className={textInputClass} value={adjustReason}
              onChange={e => setAdjustReason(e.target.value)}
              placeholder="Conteo físico: diferencia de almacén" />
          </Field>
        </FormModal>
      )}

      {showCreate && (
        <FormModal
          title="Nuevo producto"
          submitLabel="Crear producto"
          busy={createBusy}
          error={createError}
          onSubmit={() => void submitCreate()}
          onClose={() => setShowCreate(false)}
          onDismissError={() => setCreateError(null)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *" htmlFor="prod-name">
              <input id="prod-name" className={textInputClass} value={form.name} autoFocus
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Aromatizante" />
            </Field>
            <Field label="Código *" htmlFor="prod-code" hint="Único en la empresa.">
              <input id="prod-code" className={textInputClass} value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="ARO-01" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría" htmlFor="prod-cat">
              <input id="prod-cat" className={textInputClass} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="Insumos" />
            </Field>
            <Field label="Unidad" htmlFor="prod-unit">
              <input id="prod-unit" className={textInputClass} value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="Unidad" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Costo (${symbol})`} htmlFor="prod-cost">
              <input id="prod-cost" type="text" inputMode="decimal" className={textInputClass} value={form.cost}
                onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" />
            </Field>
            <Field label={`Precio de venta (${symbol})`} htmlFor="prod-price">
              <input id="prod-price" type="text" inputMode="decimal" className={textInputClass} value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Existencia inicial" htmlFor="prod-stock">
              <input id="prod-stock" type="number" className={textInputClass} value={form.stock}
                onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} />
            </Field>
            <Field label="Stock mínimo" htmlFor="prod-min" hint="Avisa cuando baje de aquí.">
              <input id="prod-min" type="number" min={0} className={textInputClass} value={form.minStock}
                onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.forSale} className="accent-indigo-600"
              onChange={e => setForm(f => ({ ...f, forSale: e.target.checked }))} />
            A la venta en el punto de venta (desmarque si es solo de uso interno)
          </label>
        </FormModal>
      )}
    </div>
  );
};
