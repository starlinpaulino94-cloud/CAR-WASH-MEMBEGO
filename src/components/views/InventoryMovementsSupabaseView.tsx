import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ExternalLink, Download, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { formatCents } from '../../lib/money';
import {
  fetchKardexPage, FiltrosKardex, MovimientoKardex
} from '../../data/reportsRepository';
import { ViewHeader, ErrorState, SearchBox, Pagination, ReadOnlyNotice, FilterChips } from '../common/DataViewShell';
import { TablaDatos } from '../common/TablaDatos';
import { FiltroFechas } from '../common/FiltroFechas';
import { SeleccionFecha, rangoDeFechas } from '../../lib/rangosFecha';
import { etiquetaMovimiento } from '../../lib/etiquetas';
import { toCsv, downloadCsv, stampedName } from '../../lib/csv';

const PAGE_SIZE = 25;

const KIND_STYLE: Record<string, string> = {
  entrada: 'bg-success/20 text-success', compra: 'bg-success/20 text-success',
  venta: 'bg-brand/20 text-brand-hi', devolucion: 'bg-info/20 text-info',
  consumo: 'bg-brand/20 text-brand-2', ajuste: 'bg-warning/20 text-warning',
  merma: 'bg-danger/20 text-danger', transferencia: 'bg-surface-3/20 text-body'
};

const TIPOS: { id: string; label: string }[] = [
  { id: '', label: 'Todos' },
  { id: 'venta', label: 'Ventas' }, { id: 'compra', label: 'Compras' },
  { id: 'consumo', label: 'Consumos' }, { id: 'ajuste', label: 'Ajustes' },
  { id: 'devolucion', label: 'Devoluciones' }, { id: 'merma', label: 'Mermas' },
  { id: 'entrada', label: 'Entradas' }
];

// A qué módulo lleva cada documento de origen. Es la trazabilidad: del
// movimiento al registro que lo produjo.
const RUTA_DOC: Record<string, string> = {
  factura: '/facturacion/facturas',
  compra: '/inventario/compras',
  orden: '/operaciones/ordenes'
};

/**
 * Kardex: el historial de cada unidad que entró o salió del inventario.
 *
 * Ahora filtra en el SERVIDOR (fecha, tipo, producto), muestra el costo, el
 * valor del movimiento y el responsable, y conecta cada fila con su documento
 * de origen: al pulsar la referencia de una compra o una factura, se va a esa
 * pantalla. Un kardex que no lleva al documento es una lista que no se puede
 * auditar.
 */
export const InventoryMovementsSupabaseView: React.FC = () => {
  const { phase, company } = useAuth();
  const { navigate } = useNavigation();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [tipo, setTipo] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: MovimientoKardex[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { desde, hasta } = rangoDeFechas(sel);

  const filtros: FiltrosKardex = useMemo(() => ({
    from: desde, to: hasta, kind: tipo || null, search: busqueda || null
  }), [desde, hasta, tipo, busqueda]);

  const cargar = useCallback(() => {
    if (phase !== 'ready') return;
    setLoading(true); setError(null);
    fetchKardexPage(filtros, page, PAGE_SIZE)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el kardex'))
      .finally(() => setLoading(false));
  }, [phase, filtros, page]);

  useEffect(() => { cargar(); }, [cargar]);
  // Al cambiar cualquier filtro se vuelve a la primera página.
  useEffect(() => { setPage(0); }, [desde, hasta, tipo, busqueda]);

  const exportar = async () => {
    const todas: MovimientoKardex[] = [];
    for (let p = 0; p < 40; p++) {
      const r = await fetchKardexPage(filtros, p, 500);
      todas.push(...r.rows);
      if (r.rows.length < 500) break;
    }
    downloadCsv(stampedName('kardex'), toCsv<MovimientoKardex>([
      { header: 'fecha', value: m => new Date(m.created_at).toLocaleString('es-DO') },
      { header: 'producto', value: m => m.product_name },
      { header: 'codigo', value: m => m.product_code },
      { header: 'tipo', value: m => etiquetaMovimiento(m.kind) },
      { header: 'cambio', value: m => String(m.qty_change) },
      { header: 'antes', value: m => String(m.qty_before) },
      { header: 'despues', value: m => String(m.qty_after) },
      { header: 'valor', value: m => (m.valor_cents / 100).toFixed(2) },
      { header: 'documento', value: m => m.doc_ref ?? '' },
      { header: 'responsable', value: m => m.responsable ?? '' },
      { header: 'motivo', value: m => m.reason ?? '' }
    ], todas));
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Movimientos de inventario" subtitle="Kardex por producto" />
        <ReadOnlyNotice>El kardex está disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={cargar} title="No se pudo cargar el kardex" />;

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Movimientos de inventario"
        subtitle="Cada cambio de existencia con su valor, responsable y documento de origen"
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void exportar()}>
            <Download className="w-4 h-4" /> Exportar filtrado
          </Button>
        }
      />

      <div className="space-y-3 bg-surface/60 border border-line rounded-2xl p-4">
        <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
        <div className="flex flex-col lg:flex-row gap-3">
          <SearchBox id="mov-search" label="Buscar por producto" value={busqueda}
            onChange={setBusqueda} placeholder="Buscar por nombre o código del producto…" />
          <FilterChips options={TIPOS} value={tipo} onChange={setTipo} />
        </div>
      </div>

      <TablaDatos
        columnas={[
          { id: 'fecha', label: 'Fecha', render: (m: MovimientoKardex) =>
            new Date(m.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
          { id: 'prod', label: 'Producto', render: m => (
            <><span className="font-bold text-strong">{m.product_name}</span>
              <span className="block text-xs text-faint">{m.product_code}</span></>) },
          { id: 'clase', label: 'Clase', render: m => (
            <span className={`px-2 py-0.5 rounded font-bold text-xs ${KIND_STYLE[m.kind] ?? ''}`}>
              {etiquetaMovimiento(m.kind)}</span>) },
          { id: 'cambio', label: 'Cambio', numerica: true, render: m => (
            <span className={m.qty_change > 0 ? 'text-success font-extrabold' : 'text-danger font-extrabold'}>
              {m.qty_change > 0 ? <ArrowUpRight className="w-3.5 h-3.5 inline" /> : <ArrowDownRight className="w-3.5 h-3.5 inline" />}
              {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change} {m.product_unit}</span>) },
          { id: 'exist', label: 'Existencia', numerica: true, ocultarEnMovil: true,
            render: m => <>{m.qty_before} → <strong className="text-strong">{m.qty_after}</strong></> },
          { id: 'valor', label: 'Valor', numerica: true, ocultarEnMovil: true,
            render: m => formatCents(m.valor_cents, symbol) },
          { id: 'doc', label: 'Documento', render: m => m.doc_ref && m.doc_tipo && RUTA_DOC[m.doc_tipo]
            ? <button onClick={() => navigate(RUTA_DOC[m.doc_tipo!])}
                className="text-brand-hi hover:underline inline-flex items-center gap-1 font-medium"
                title={`Abrir ${m.doc_tipo}`}>
                {m.doc_ref} <ExternalLink className="w-3 h-3" /></button>
            : <span className="text-faint">{m.reason ?? '—'}</span> },
          { id: 'quien', label: 'Responsable', ocultarEnMovil: true, render: m => m.responsable ?? '—' }
        ]}
        filas={data.rows}
        clave={m => String(m.id)}
        cargando={loading}
        vacio={busqueda || tipo ? 'Ningún movimiento coincide con el filtro.' : 'Sin movimientos en el periodo.'}
        etiqueta="Movimientos de inventario"
      />
      <Pagination page={page} pageCount={pageCount} total={data.total}
        pageSize={PAGE_SIZE} loading={loading} onPage={setPage} />

      {loading && <p className="text-xs text-faint flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Cargando…</p>}
    </div>
  );
};
