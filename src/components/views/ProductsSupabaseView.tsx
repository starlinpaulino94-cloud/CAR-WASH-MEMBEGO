import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Pencil, AlertTriangle, Plus, Trash2, Archive, ArchiveRestore, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchProductPage, adjustStock, createProduct, updateProduct,
  eliminarFila, archivarFila, Product
} from '../../data/adminRepository';
import { ConfirmarEliminar } from '../common/ConfirmarEliminar';
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

  /*
   * La FICHA del producto: nombre, código, categoría, precio, unidad.
   *
   * Hasta aquí solo se ajustaba la existencia. Un producto con el precio mal
   * puesto había que dejarlo así, y no había forma de retirarlo del catálogo.
   *
   * La existencia sigue FUERA de este formulario, y a propósito: desde 0019
   * todo cambio de stock es un movimiento con motivo, y editarlo aquí sería
   * volver al ajuste silencioso que esa migración vino a quitar.
   */
  const puedeBorrar = can(profile, 'deleteRecords');
  const [fichaDe, setFichaDe] = useState<Product | null>(null);
  const [borrando, setBorrando] = useState<Product | null>(null);
  const [ficha, setFicha] = useState({
    name: '', code: '', category: '', cost: '', price: '', minStock: '', unit: '', forSale: true
  });
  const [fichaBusy, setFichaBusy] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);

  const abrirFicha = (p: Product) => {
    setFicha({
      name: p.name, code: p.code, category: p.category ?? '',
      cost: (p.cost_cents / 100).toFixed(2), price: (p.price_cents / 100).toFixed(2),
      minStock: String(p.min_stock), unit: p.unit, forSale: p.is_for_sale
    });
    setFichaError(null);
    setFichaDe(p);
  };

  const guardarFicha = async () => {
    if (!fichaDe) return;
    if (!ficha.name.trim()) { setFichaError('El nombre es obligatorio.'); return; }
    const costo = parseAmountToCents(ficha.cost);
    const precio = parseAmountToCents(ficha.price);
    if (costo === null || precio === null) {
      setFichaError('Costo y precio deben ser importes válidos.'); return;
    }
    const minimo = Number(ficha.minStock);
    if (!Number.isInteger(minimo) || minimo < 0) {
      setFichaError('La existencia mínima debe ser un entero no negativo.'); return;
    }
    setFichaBusy(true);
    setFichaError(null);
    try {
      await updateProduct(fichaDe.id, {
        name: ficha.name.trim(), code: ficha.code.trim(),
        category: ficha.category.trim(), cost_cents: costo, price_cents: precio,
        min_stock: minimo, unit: ficha.unit.trim() || 'Unidad', is_for_sale: ficha.forSale
      });
      setFichaDe(null);
      q.reload();
    } catch (err) {
      setFichaError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setFichaBusy(false);
    }
  };

  const alternarActivo = async (p: Product) => {
    try {
      await archivarFila('products', p.id, p.is_active);
      q.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.');
    }
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
        title="Productos e insumos"
        subtitle="Existencias, costo y precio de venta"
        actions={
          <>
            <ExportButton {...productsExport()} />
            {can(profile, 'importData') && (
              <ImportButton entity="productos" onImported={q.reload} />
            )}
            {editable && (
              <Button size="sm" onClick={openCreate}
                >
                <Plus className="w-4 h-4" /> Nuevo producto
              </Button>
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

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Inventario de productos</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">PRODUCTO</th>
                <th scope="col" className="p-3 font-semibold">CATEGORÍA</th>
                <th scope="col" className="p-3 font-semibold text-right">COSTO</th>
                <th scope="col" className="p-3 font-semibold text-right">PRECIO</th>
                <th scope="col" className="p-3 font-semibold text-right">EXISTENCIA</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {q.loading ? <SkeletonRows cols={7} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={7}>
                    {q.searchInput || lowOnly === 'low'
                      ? 'Ningún producto coincide con el filtro.'
                      : 'Todavía no hay productos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(p => {
                  const low = p.stock <= p.min_stock;
                  return (
                    <tr key={p.id} className="hover:bg-surface-2/40">
                      <td className="p-3">
                        <div className="font-bold text-strong">{p.name}</div>
                        <div className="text-xs text-faint">{p.code}</div>
                      </td>
                      <td className="p-3 text-muted">{p.category || '—'}</td>
                      <td className="p-3 text-body text-right whitespace-nowrap">
                        {formatCents(p.cost_cents, symbol)}
                      </td>
                      <td className="p-3 font-bold text-brand-hi text-right whitespace-nowrap">
                        {p.is_for_sale ? formatCents(p.price_cents, symbol) : 'Uso interno'}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => { if (editable) openAdjust(p); }}
                          disabled={!editable}
                          aria-label={`Existencia de ${p.name}`}
                          title={editable ? 'Ajustar existencia (queda en el kardex)' : undefined}
                          className={`px-2 py-1 rounded font-extrabold tabular-nums ${
                            p.stock < 0 ? 'text-danger' : 'text-strong'
                          } ${editable ? 'hover:bg-surface-2' : 'cursor-default'}`}
                        >
                          {p.stock} {p.unit}
                          {editable && <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />}
                        </button>
                      </td>
                      <td className="p-3">
                        {p.stock < 0 ? (
                          <span className="bg-danger/20 text-danger font-bold px-2 py-0.5 rounded text-xs inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Negativo
                          </span>
                        ) : low ? (
                          <span className="bg-warning/20 text-warning font-bold px-2 py-0.5 rounded text-xs">
                            Bajo (mín. {p.min_stock})
                          </span>
                        ) : (
                          <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">
                            Normal
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          {editable && (
                            <Button variant="ghost" size="icon-sm" onClick={() => abrirFicha(p)} aria-label={`Editar ${p.name}`}
                              title="Nombre, código, precio y unidad"
                              >
                              <FileText className="w-4 h-4" />
                            </Button>
                          )}
                          {puedeBorrar && (
                            <>
                              <Button variant="ghost" size="icon-sm" onClick={() => void alternarActivo(p)}
                                aria-label={`${p.is_active ? 'Desactivar' : 'Activar'} ${p.name}`}
                                title={p.is_active ? 'Deja de ofrecerse en caja' : 'Vuelve a ofrecerse'}
                                >
                                {p.is_active ? <Archive className="w-4 h-4" /> : <ArchiveRestore className="w-4 h-4" />}
                              </Button>
                              <Button variant="ghost" size="icon-sm" className="text-muted hover:text-danger" onClick={() => setBorrando(p)} aria-label={`Eliminar ${p.name}`}
                                >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
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

      {fichaDe && (
        <FormModal
          title={`Editar — ${fichaDe.name}`}
          submitLabel="Guardar cambios"
          busy={fichaBusy}
          error={fichaError}
          onSubmit={() => void guardarFicha()}
          onClose={() => setFichaDe(null)}
          onDismissError={() => setFichaError(null)}
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Nombre" htmlFor="ed-prd-name">
                <input id="ed-prd-name" className={textInputClass} value={ficha.name} autoFocus
                  onChange={e => setFicha(f => ({ ...f, name: e.target.value }))} />
              </Field>
            </div>
            <Field label="Código" htmlFor="ed-prd-code">
              <input id="ed-prd-code" className={textInputClass} value={ficha.code}
                onChange={e => setFicha(f => ({ ...f, code: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría" htmlFor="ed-prd-cat">
              <input id="ed-prd-cat" className={textInputClass} value={ficha.category}
                onChange={e => setFicha(f => ({ ...f, category: e.target.value }))} />
            </Field>
            <Field label="Unidad" htmlFor="ed-prd-unit">
              <input id="ed-prd-unit" className={textInputClass} value={ficha.unit}
                onChange={e => setFicha(f => ({ ...f, unit: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Costo" htmlFor="ed-prd-cost">
              <input id="ed-prd-cost" inputMode="decimal" className={textInputClass} value={ficha.cost}
                onChange={e => setFicha(f => ({ ...f, cost: e.target.value }))} />
            </Field>
            <Field label="Precio" htmlFor="ed-prd-price">
              <input id="ed-prd-price" inputMode="decimal" className={textInputClass} value={ficha.price}
                onChange={e => setFicha(f => ({ ...f, price: e.target.value }))} />
            </Field>
            <Field label="Mínimo" htmlFor="ed-prd-min">
              <input id="ed-prd-min" type="number" min="0" className={textInputClass} value={ficha.minStock}
                onChange={e => setFicha(f => ({ ...f, minStock: e.target.value }))} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={ficha.forSale} className="accent-brand"
              onChange={e => setFicha(f => ({ ...f, forSale: e.target.checked }))} />
            Se vende en caja (si no, es de uso interno)
          </label>
          {/* La existencia no está aquí a propósito: desde 0019 todo cambio de
              stock es un movimiento con motivo, y editarla en un formulario
              sería el ajuste silencioso que esa migración vino a quitar. */}
          <p className="text-xs text-faint">
            La existencia se cambia tocando la cifra en la tabla, y queda en el kardex con su motivo.
          </p>
        </FormModal>
      )}

      {borrando && (
        <ConfirmarEliminar
          queEs="el producto"
          nombre={borrando.name}
          onEliminar={() => eliminarFila('products', borrando.id)}
          onArchivar={() => archivarFila('products', borrando.id, true)}
          onCerrar={() => setBorrando(null)}
          onHecho={() => q.reload()}
        />
      )}

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
          <p className="text-sm text-muted">
            Existencia actual: <strong className="text-strong tabular-nums">{adjusting.stock} {adjusting.unit}</strong>.
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

          <label className="flex items-center gap-2 text-xs text-body cursor-pointer">
            <input type="checkbox" checked={form.forSale} className="accent-brand"
              onChange={e => setForm(f => ({ ...f, forSale: e.target.checked }))} />
            A la venta en el punto de venta (desmarque si es solo de uso interno)
          </label>
        </FormModal>
      )}
    </div>
  );
};
