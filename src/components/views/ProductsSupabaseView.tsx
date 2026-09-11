import React, { useCallback, useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Pencil, AlertTriangle, Plus, Trash2, Archive, ArchiveRestore, FileText, Tag, Eye, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchProductPage, adjustStock, createProduct, updateProduct,
  eliminarFila, archivarFila, Product, FiltrosProducto,
  fetchResumenInventario, fetchFichaProducto, ResumenInventario, FichaProducto
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
import { Barcode } from '../common/Barcode';
import { EtiquetasProductoModal } from '../modals/EtiquetasProductoModal';
import { RejillaKpi, Kpi } from '../common/RejillaKpi';
import { PanelDetalle } from '../common/PanelDetalle';
import { TablaDatos } from '../common/TablaDatos';
import { etiquetaMovimiento } from '../../lib/etiquetas';

const PAGE_SIZE = 25;

const emptyProductForm = {
  name: '', code: '', category: '', cost: '', price: '',
  stock: '0', minStock: '0', unit: 'Unidad', forSale: true
};

type EstadoStock = NonNullable<FiltrosProducto['estado']>;
const ESTADOS: { id: EstadoStock; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'bajo', label: 'Bajo stock' },
  { id: 'agotado', label: 'Agotados' },
  { id: 'negativo', label: 'Negativos' }
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

  const [estado, setEstado] = useState<EstadoStock>('todos');
  const [actividad, setActividad] = useState<FiltrosProducto['actividad']>('activos');
  const [uso, setUso] = useState<FiltrosProducto['uso']>('todos');
  const q = usePagedQuery<Product>({
    fetcher: (page, size, search) => fetchProductPage(page, size, search, { estado, actividad, uso }),
    pageSize: PAGE_SIZE,
    deps: [estado, actividad, uso]
  });

  // El panel de indicadores. Sale de una RPC agregada, no de sumar la página.
  const [resumen, setResumen] = useState<ResumenInventario | null>(null);
  useEffect(() => {
    fetchResumenInventario().then(setResumen).catch(() => setResumen(null));
  }, [q.total, q.loading]);

  // La ficha 360 de un producto, en panel lateral.
  const [fichaProd, setFichaProd] = useState<Product | null>(null);
  const [ficha360, setFicha360] = useState<FichaProducto | null>(null);
  const [fichaCargando, setFichaCargando] = useState(false);
  const verFicha = useCallback((prod: Product) => {
    setFichaProd(prod); setFicha360(null); setFichaCargando(true);
    fetchFichaProducto(prod.id)
      .then(setFicha360).catch(() => setFicha360(null)).finally(() => setFichaCargando(false));
  }, []);

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
  /** Producto cuya hoja de etiquetas se está preparando para imprimir. */
  const [etiquetando, setEtiquetando] = useState<Product | null>(null);
  const [ficha, setFicha] = useState({
    name: '', code: '', category: '', cost: '', price: '', minStock: '', unit: '',
    forSale: true, barcode: ''
  });
  const [fichaBusy, setFichaBusy] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);

  const abrirFicha = (p: Product) => {
    setFicha({
      name: p.name, code: p.code, category: p.category ?? '',
      cost: (p.cost_cents / 100).toFixed(2), price: (p.price_cents / 100).toFixed(2),
      minStock: String(p.min_stock), unit: p.unit, forSale: p.is_for_sale,
      barcode: p.barcode ?? ''
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
        min_stock: minimo, unit: ficha.unit.trim() || 'Unidad', is_for_sale: ficha.forSale,
        // Vaciarlo es válido: la base repone uno automáticamente.
        barcode: ficha.barcode.trim()
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

      {/* El panel: cuánto vale el inventario y cuántos productos piden atención.
          Cada conteo es clicable y filtra la tabla — el KPI lleva a los productos
          que lo forman, no es un número decorativo. */}
      <RejillaKpi
        symbol={symbol}
        cargando={!resumen}
        kpis={resumen ? [
          { id: 'valor', label: 'Valor del inventario', valor: resumen.valor_costo_cents, moneda: true, hint: 'a costo' },
          { id: 'venta', label: 'Venta potencial', valor: resumen.venta_potencial_cents, moneda: true, tono: 'ok', hint: 'a precio' },
          { id: 'bajo', label: 'Bajo stock', valor: resumen.bajo_stock, tono: resumen.bajo_stock > 0 ? 'warn' : undefined,
            onClick: () => { setEstado('bajo'); setActividad('activos'); } },
          { id: 'agot', label: 'Agotados', valor: resumen.agotados, tono: resumen.agotados > 0 ? 'bad' : undefined,
            onClick: () => { setEstado('agotado'); setActividad('activos'); } }
        ] : []}
      />
      {resumen && resumen.negativos > 0 && (
        <InlineAlert tone="warning">
          <button className="underline font-semibold" onClick={() => { setEstado('negativo'); setActividad('activos'); }}>
            {resumen.negativos} {resumen.negativos === 1 ? 'producto tiene' : 'productos tienen'} existencia negativa
          </button>: revise si hubo ventas sin registrar la entrada.
        </InlineAlert>
      )}

      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <SearchBox id="prod-search" label="Buscar producto" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por nombre, código o código de barras…" />
        <FilterChips options={ESTADOS} value={estado} onChange={setEstado} />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <select value={actividad} onChange={e => setActividad(e.target.value as FiltrosProducto['actividad'])}
            className="bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand">
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Activos e inactivos</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <select value={uso} onChange={e => setUso(e.target.value as FiltrosProducto['uso'])}
            className="bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand">
            <option value="todos">Venta e interno</option>
            <option value="venta">Solo venta</option>
            <option value="interno">Solo uso interno</option>
          </select>
        </label>
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <caption className="sr-only">Inventario de productos</caption>
            <TableHeader>
              <TableRow className="border-b border-line text-muted bg-canvas/50">
                <TableHead scope="col" className="p-3 font-semibold">PRODUCTO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold hidden md:table-cell">CATEGORÍA</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">COSTO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">PRECIO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right hidden lg:table-cell">MARGEN</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">EXISTENCIA</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right hidden lg:table-cell">VALOR</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">ESTADO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">ACCIONES</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.loading ? <SkeletonRows cols={9} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={9}>
                    {q.searchInput || estado !== 'todos' || uso !== 'todos' || actividad !== 'activos'
                      ? 'Ningún producto coincide con el filtro.'
                      : 'Todavía no hay productos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(p => {
                  const low = p.stock <= p.min_stock;
                  return (
                    <TableRow key={p.id} className="hover:bg-surface-2/40">
                      <TableCell className="p-3">
                        <button onClick={() => verFicha(p)} className="text-left hover:underline"
                          title="Ver ficha del producto">
                          <div className="font-bold text-strong">{p.name}</div>
                          <div className="text-xs text-faint">{p.code}</div>
                        </button>
                      </TableCell>
                      <TableCell className="p-3 text-muted hidden md:table-cell">{p.category || '—'}</TableCell>
                      <TableCell className="p-3 text-body text-right whitespace-nowrap">
                        {formatCents(p.cost_cents, symbol)}
                      </TableCell>
                      <TableCell className="p-3 font-bold text-brand-hi text-right whitespace-nowrap">
                        {p.is_for_sale ? formatCents(p.price_cents, symbol) : 'Uso interno'}
                      </TableCell>
                      <TableCell className="p-3 text-right whitespace-nowrap hidden lg:table-cell">
                        {p.is_for_sale && p.price_cents > 0 ? (
                          <span className={p.price_cents <= p.cost_cents ? 'text-danger font-bold' : 'text-body'}>
                            {formatCents(p.price_cents - p.cost_cents, symbol)}
                            <span className="block text-xs text-faint">
                              {Math.round(((p.price_cents - p.cost_cents) / p.price_cents) * 100)}%
                            </span>
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="p-3 text-right">
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
                      </TableCell>
                      <TableCell className="p-3 text-right whitespace-nowrap hidden lg:table-cell text-body tabular-nums">
                        {p.stock > 0 ? formatCents(p.cost_cents * p.stock, symbol) : '—'}
                      </TableCell>
                      <TableCell className="p-3">
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
                      </TableCell>
                      <TableCell className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* Etiquetar no cambia nada del producto: lo puede hacer
                              cualquiera que vea el catálogo, igual que exportar. */}
                          <Button variant="ghost" size="icon-sm" onClick={() => setEtiquetando(p)}
                            aria-label={`Imprimir etiquetas de ${p.name}`}
                            title="Imprimir etiquetas con su código de barras"
                            >
                            <Tag className="w-4 h-4" />
                          </Button>
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
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
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

          {/* Código de barras: se genera solo al crear el producto. Se puede
              sustituir por el del envase; si se deja vacío, la base repone uno. */}
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2">
              <Field label="Código de barras" htmlFor="ed-prd-barcode"
                hint="Se genera solo. Si el producto trae el suyo en el envase, escríbalo aquí.">
                <input id="ed-prd-barcode" inputMode="numeric" className={textInputClass}
                  value={ficha.barcode}
                  onChange={e => setFicha(f => ({ ...f, barcode: e.target.value }))} />
              </Field>
            </div>
            <div className="bg-white rounded p-2 flex items-center justify-center min-h-[64px]">
              <Barcode value={ficha.barcode} alto={40} className="text-slate-900 w-full" />
            </div>
          </div>

          <div>
            <Button type="button" variant="secondary" size="sm"
              onClick={() => { const p = fichaDe; setFichaDe(null); setEtiquetando(p); }}>
              <Tag className="w-4 h-4 mr-1.5" /> Imprimir etiquetas
            </Button>
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

      {etiquetando && (
        <EtiquetasProductoModal
          producto={etiquetando}
          symbol={symbol}
          onClose={() => setEtiquetando(null)}
        />
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

          <p className="text-xs text-faint">
            El <strong>código de barras</strong> se genera solo al guardar: podrá imprimir sus
            etiquetas desde la lista. Si el producto ya trae el suyo en el envase, cámbielo
            después en la ficha.
          </p>

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
      <PanelDetalle
        abierto={!!fichaProd}
        titulo={fichaProd?.name ?? ''}
        subtitulo={fichaProd ? `${fichaProd.code}${fichaProd.barcode ? ` · ${fichaProd.barcode}` : ''}` : ''}
        onCerrar={() => { setFichaProd(null); setFicha360(null); }}
        acciones={editable && fichaProd
          ? <Button variant="outline" size="sm" onClick={() => { const pr = fichaProd; setFichaProd(null); abrirFicha(pr); }}>
              <Pencil className="w-4 h-4" /> Editar
            </Button>
          : undefined}
      >
        {fichaProd && (
          <div className="space-y-5">
            {/* Lo general, de la propia fila: no hace falta esperar la RPC. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Existencia', `${fichaProd.stock} ${fichaProd.unit}`, fichaProd.stock < 0 ? 'text-danger' : 'text-strong'],
                ['Mínimo', String(fichaProd.min_stock), 'text-strong'],
                ['Costo', formatCents(fichaProd.cost_cents, symbol), 'text-strong'],
                ['Precio', fichaProd.is_for_sale ? formatCents(fichaProd.price_cents, symbol) : 'Uso interno', 'text-brand-hi'],
                ['Valor actual', fichaProd.stock > 0 ? formatCents(fichaProd.cost_cents * fichaProd.stock, symbol) : '—', 'text-strong'],
                ['Categoría', fichaProd.category || '—', 'text-strong'],
                ['Consumo 30 días', ficha360 ? `${ficha360.consumo_30d} ${fichaProd.unit}` : '…', 'text-strong'],
                ['Proveedor habitual', ficha360?.proveedor_habitual ?? '—', 'text-strong']
              ].map(([l, v, c]) => (
                <div key={l} className="bg-canvas border border-line rounded-xl p-3">
                  <div className="text-xs text-muted">{l}</div>
                  <div className={`text-sm font-bold tabular-nums ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            {fichaCargando ? (
              <p className="text-xs text-faint flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Cargando historial…</p>
            ) : ficha360 ? (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-strong">Últimas compras</h3>
                  <TablaDatos
                    columnas={[
                      { id: 'f', label: 'Fecha', render: c => new Date(c.purchase_date).toLocaleDateString('es-DO') },
                      { id: 'prov', label: 'Proveedor', render: c => c.supplier_name ?? '—' },
                      { id: 'ref', label: 'Ref.', ocultarEnMovil: true, render: c => c.invoice_ref ?? '—' },
                      { id: 'q', label: 'Cant.', numerica: true, render: c => c.quantity },
                      { id: 'costo', label: 'Costo unit.', numerica: true, render: c => formatCents(c.unit_cost_cents, symbol) }
                    ]}
                    filas={ficha360.ultimas_compras} clave={c => c.purchase_id + c.purchase_date}
                    vacio="Sin compras registradas de este producto." etiqueta="Últimas compras" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-strong">Últimos movimientos</h3>
                  <TablaDatos
                    columnas={[
                      { id: 'f', label: 'Fecha', render: m => new Date(m.created_at).toLocaleDateString('es-DO') },
                      { id: 'tipo', label: 'Tipo', render: m => etiquetaMovimiento(m.kind) },
                      { id: 'cam', label: 'Cambio', numerica: true,
                        render: m => <span className={m.qty_change < 0 ? 'text-danger' : 'text-success'}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</span> },
                      { id: 'desp', label: 'Queda', numerica: true, render: m => m.qty_after },
                      { id: 'motivo', label: 'Motivo', ocultarEnMovil: true, render: m => m.reason ?? '—' }
                    ]}
                    filas={ficha360.ultimos_movimientos} clave={m => String(m.id)}
                    vacio="Sin movimientos registrados." etiqueta="Últimos movimientos" />
                </div>
              </>
            ) : (
              <p className="text-xs text-faint">No se pudo cargar el historial.</p>
            )}
          </div>
        )}
      </PanelDetalle>
    </div>
  );
};
