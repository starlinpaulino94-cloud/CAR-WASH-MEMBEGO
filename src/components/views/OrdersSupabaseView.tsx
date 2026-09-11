import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Car, Plus, AlertCircle, Loader2, Printer, PackageCheck, ClipboardCheck, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuth } from '../../context/AuthContext';
import { useQueueCount } from '../../context/QueueCountContext';
import { formatCents } from '../../lib/money';
import {
  fetchOrdersPage, fetchDetalleOrden, fetchWorkOrderById, fetchAssignees, fetchOperators,
  FiltrosOrden, OrdenOperacion, DetalleOrden, WorkOrder, OrderStatus, STATUS_LABEL, Profile
} from '../../data/ordersRepository';
import { fetchServicesWithPrices, ServiceWithPrices } from '../../data/adminRepository';
import { ViewHeader, ErrorState, SearchBox, Pagination, ReadOnlyNotice, InlineAlert } from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { TablaDatos } from '../common/TablaDatos';
import { PanelDetalle } from '../common/PanelDetalle';
import { SeleccionFecha, rangoDeFechas } from '../../lib/rangosFecha';
import { NewArrivalSupabaseModal } from '../modals/NewArrivalSupabaseModal';
import { InspectionModal } from '../modals/InspectionModal';
import { ComandaOrdenModal } from '../modals/ComandaOrdenModal';

const PAGE_SIZE = 25;

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: 'active', label: 'En taller' }, { id: 'all', label: 'Todas' },
  { id: 'pendiente', label: 'Pendientes' }, { id: 'en_proceso', label: 'En lavado' },
  { id: 'listo', label: 'Listas' }, { id: 'entregado', label: 'Entregadas' },
  { id: 'cancelado', label: 'Canceladas' }
];

const STATUS_TONE: Record<OrderStatus, string> = {
  pendiente: 'bg-warning/20 text-warning', en_espera: 'bg-info/20 text-info',
  asignada: 'bg-info/20 text-info', en_proceso: 'bg-brand/20 text-brand-hi',
  control_calidad: 'bg-brand/20 text-brand-2', listo: 'bg-success/20 text-success',
  entregado: 'bg-surface-2 text-body', cancelado: 'bg-danger/20 text-danger'
};

/** Segundos a «1 h 20 min» o «15 min». */
function fmtDur(seg: number | null): string {
  if (seg == null) return '—';
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Órdenes de servicio: la operación, no solo el historial.
 *
 * Sobre orders_page: filtra en el servidor por periodo, estado, lavador,
 * servicio y pago, y trae los TIEMPOS (espera, duración) y las BANDERAS
 * operativas (atrasada, lista sin entregar, sin lavador) ya calculadas. Al
 * abrir una orden se ve su línea de tiempo —llegó, se inició, se terminó, se
 * entregó— con lavadores, servicios, calidad e inspección. El sistema se
 * siente conectado: del número al carro y su historia.
 */
export const OrdersSupabaseView: React.FC = () => {
  const { branch, company, phase } = useAuth();
  const { refresh: refreshQueue } = useQueueCount();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [sel, setSel] = useState<SeleccionFecha>({ preset: '7dias' });
  const [status, setStatus] = useState('active');
  const [busqueda, setBusqueda] = useState('');
  const [washerId, setWasherId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [payment, setPayment] = useState('');
  const [page, setPage] = useState(0);

  const [washers, setWashers] = useState<Profile[]>([]);
  const [services, setServices] = useState<ServiceWithPrices[]>([]);
  const [data, setData] = useState<{ total: number; rows: OrdenOperacion[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [inspecting, setInspecting] = useState<WorkOrder | null>(null);
  const [imprimiendo, setImprimiendo] = useState<{ order: WorkOrder; variante: 'llegada' | 'entrega' } | null>(null);
  const [lavadoresImpresion, setLavadoresImpresion] = useState<string[]>([]);

  // El detalle con la línea de tiempo.
  const [detalle, setDetalle] = useState<DetalleOrden | null>(null);
  const [detalleCargando, setDetalleCargando] = useState(false);

  useEffect(() => {
    if (phase !== 'ready' || !branch) return;
    fetchOperators(branch.id).then(setWashers).catch(() => setWashers([]));
    fetchServicesWithPrices().then(setServices).catch(() => setServices([]));
  }, [phase, branch]);

  const { desde, hasta } = rangoDeFechas(sel);
  const filtros: FiltrosOrden = useMemo(() => ({
    from: desde, to: hasta, status, search: busqueda || null,
    washerId: washerId || null, serviceId: serviceId || null, payment: payment || null
  }), [desde, hasta, status, busqueda, washerId, serviceId, payment]);

  const load = useCallback(() => {
    if (phase !== 'ready' || !branch) return;
    setLoading(true); setError(null);
    fetchOrdersPage(branch.id, filtros, page, PAGE_SIZE)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar las órdenes'))
      .finally(() => setLoading(false));
  }, [phase, branch, filtros, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [desde, hasta, status, busqueda, washerId, serviceId, payment]);

  // Los nombres de lavadores para el papel se resuelven al abrir la impresión.
  useEffect(() => {
    if (!imprimiendo) { setLavadoresImpresion([]); return; }
    let activo = true;
    const orden = imprimiendo.order;
    Promise.all([fetchAssignees([orden.id]), fetchOperators(orden.branch_id)])
      .then(([mapa, gente]) => {
        if (!activo) return;
        const ids = new Set(mapa.get(orden.id) ?? []);
        setLavadoresImpresion(gente.filter(p => ids.has(p.id)).map(p => p.full_name));
      })
      .catch(() => { if (activo) setLavadoresImpresion([]); });
    return () => { activo = false; };
  }, [imprimiendo]);

  const abrirDetalle = (id: string) => {
    setDetalle(null); setDetalleCargando(true);
    fetchDetalleOrden(id).then(setDetalle).catch(() => setDetalle(null)).finally(() => setDetalleCargando(false));
  };

  // Las banderas operativas de la página, para el aviso de arriba.
  const alertas = useMemo(() => ({
    atrasadas: data.rows.filter(o => o.atrasada).length,
    listas: data.rows.filter(o => o.lista_sin_entregar).length,
    sinLavador: data.rows.filter(o => o.sin_lavador && o.status !== 'entregado' && o.status !== 'cancelado').length
  }), [data.rows]);

  // Para imprimir o inspeccionar se necesita la orden COMPLETA (el listado trae
  // una forma recortada). Se pide por id al pulsar.
  const conOrdenCompleta = async (id: string, fn: (o: WorkOrder) => void) => {
    const o = await fetchWorkOrderById(id);
    if (o) fn(o);
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Órdenes de servicio" subtitle="Operación del taller" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} title="No se pudieron cargar las órdenes" />;

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const sel3 = 'bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Órdenes de servicio"
        subtitle={branch?.name}
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Registrar llegada</Button>}
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

      {/* Avisos operativos: lo que pide atención AHORA, calculado de las banderas
          de la página. No son alertas inventadas: cada una es una condición real. */}
      {(alertas.atrasadas > 0 || alertas.listas > 0 || alertas.sinLavador > 0) && (
        <div className="flex flex-wrap gap-2">
          {alertas.atrasadas > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-danger/15 text-danger border border-danger/30 rounded-xl px-3 py-1.5 text-xs font-bold">
              <AlertTriangle className="w-3.5 h-3.5" /> {alertas.atrasadas} atrasada{alertas.atrasadas > 1 ? 's' : ''}
            </span>
          )}
          {alertas.listas > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-warning/15 text-warning border border-warning/30 rounded-xl px-3 py-1.5 text-xs font-bold">
              <PackageCheck className="w-3.5 h-3.5" /> {alertas.listas} lista{alertas.listas > 1 ? 's' : ''} sin entregar
            </span>
          )}
          {alertas.sinLavador > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-info/15 text-info border border-info/30 rounded-xl px-3 py-1.5 text-xs font-bold">
              <AlertCircle className="w-3.5 h-3.5" /> {alertas.sinLavador} sin lavador
            </span>
          )}
        </div>
      )}

      <div className="space-y-3 bg-surface/60 border border-line rounded-2xl p-4">
        <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
        <div className="flex flex-col lg:flex-row gap-3">
          <SearchBox id="ord-search" label="Buscar orden" value={busqueda} onChange={setBusqueda}
            placeholder="Buscar por número, placa o cliente…" />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(f => (
              <button key={f.id} onClick={() => setStatus(f.id)} aria-pressed={status === f.id}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  status === f.id ? 'bg-brand text-on-accent border-brand' : 'bg-surface text-muted border-line hover:border-brand'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">Lavador
            <select className={sel3} value={washerId} onChange={e => setWasherId(e.target.value)}>
              <option value="">Todos</option>
              {washers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">Servicio
            <select className={sel3} value={serviceId} onChange={e => setServiceId(e.target.value)}>
              <option value="">Todos</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">Pago
            <select className={sel3} value={payment} onChange={e => setPayment(e.target.value)}>
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
              <option value="parcial">Parcial</option>
            </select>
          </label>
        </div>
      </div>

      <TablaDatos
        columnas={[
          { id: 'ord', label: 'Orden', render: (o: OrdenOperacion) => (
            <><span className="font-bold text-brand-hi">{o.order_number}</span>
              {o.es_membego && <span className="block text-xs text-brand-2">Membego</span>}</>) },
          { id: 'veh', label: 'Vehículo', render: o => (
            <><span className="font-bold text-strong uppercase">{o.vehicle_plate}</span>
              <span className="block text-xs text-muted">{o.vehicle_make_model || '—'}</span></>) },
          { id: 'cli', label: 'Cliente', ocultarEnMovil: true, render: o => o.customer_name },
          { id: 'lav', label: 'Lavador', ocultarEnMovil: true, render: o => o.lavadores
            ?? <span className="text-info">sin asignar</span> },
          { id: 'espera', label: 'Espera', numerica: true, ocultarEnMovil: true, render: o => fmtDur(o.espera_seg) },
          { id: 'dur', label: 'Duración', numerica: true, ocultarEnMovil: true, render: o => fmtDur(o.duracion_seg) },
          { id: 'est', label: 'Estado', render: o => (
            <div className="flex flex-col gap-1 items-start">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_TONE[o.status]}`}>
                {STATUS_LABEL[o.status]}</span>
              {o.atrasada && <span className="text-xs text-danger font-bold flex items-center gap-0.5"><Clock className="w-3 h-3" /> atrasada</span>}
              {o.lista_sin_entregar && <span className="text-xs text-warning font-bold">sin entregar</span>}
            </div>) },
          { id: 'tot', label: 'Total', numerica: true, render: o => o.total_cents === 0
            ? <span className="text-success">Beneficio</span> : formatCents(o.total_cents, symbol) },
          { id: 'acc', label: '', render: o => (
            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => void conOrdenCompleta(o.id, ord => setImprimiendo({ order: ord, variante: 'llegada' }))}
                title="Comanda de llegada" className="p-1.5 text-body hover:text-strong rounded-lg hover:bg-surface-2">
                <Printer className="w-4 h-4" /></button>
              {o.status === 'entregado' && (
                <button onClick={() => void conOrdenCompleta(o.id, ord => setImprimiendo({ order: ord, variante: 'entrega' }))}
                  title="Comprobante de entrega" className="p-1.5 text-success rounded-lg hover:bg-surface-2">
                  <PackageCheck className="w-4 h-4" /></button>)}
              <button onClick={() => void conOrdenCompleta(o.id, setInspecting)}
                title="Inspección del vehículo" className="p-1.5 text-info rounded-lg hover:bg-surface-2">
                <ClipboardCheck className="w-4 h-4" /></button>
            </div>) }
        ]}
        filas={data.rows}
        clave={o => o.id}
        cargando={loading}
        onFila={o => abrirDetalle(o.id)}
        vacio={busqueda || status !== 'active' ? 'Ninguna orden coincide con el filtro.' : 'No hay vehículos en el taller ahora mismo.'}
        etiqueta="Órdenes de servicio"
      />
      <Pagination page={page} pageCount={pageCount} total={data.total} pageSize={PAGE_SIZE} loading={loading} onPage={setPage} />

      {/* La línea de tiempo de la orden. */}
      <PanelDetalle
        abierto={!!detalle || detalleCargando}
        titulo={detalle ? `Orden ${detalle.order_number}` : 'Orden'}
        subtitulo={detalle ? `${detalle.vehicle_plate} · ${detalle.customer_name}` : undefined}
        onCerrar={() => { setDetalle(null); }}
      >
        {detalleCargando ? (
          <p className="text-xs text-faint flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Cargando…</p>
        ) : detalle ? (
          <div className="space-y-5">
            {/* La línea de tiempo: cada hito con su hora; los que no pasaron, en gris. */}
            <ol className="relative border-l-2 border-line ml-2 space-y-4">
              {detalle.hitos.map(h => (
                <li key={h.clave} className="ml-4">
                  <span className={`absolute -left-[7px] w-3 h-3 rounded-full ${h.at ? 'bg-brand' : 'bg-surface-2 border border-line'}`} />
                  <div className={`text-sm font-semibold ${h.at ? 'text-strong' : 'text-faint'}`}>{h.label}</div>
                  <div className="text-xs text-muted">
                    {h.at ? new Date(h.at).toLocaleString('es-DO') : 'pendiente'}</div>
                </li>
              ))}
            </ol>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                ['Estado', STATUS_LABEL[detalle.status]],
                ['Bahía', detalle.bay_name ?? '—'],
                ['Lavadores', detalle.lavadores.join(', ') || '—'],
                ['Vehículo', `${detalle.vehicle_make_model} ${detalle.vehicle_color}`.trim() || detalle.vehicle_plate],
                ['Total', formatCents(detalle.total_cents, symbol)],
                ['Pago', detalle.payment_status]
              ].map(([l, v]) => (
                <div key={l} className="bg-canvas border border-line rounded-xl p-3">
                  <div className="text-xs text-muted">{l}</div>
                  <div className="text-sm font-bold text-strong">{v}</div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-strong">Servicios</h3>
              {detalle.servicios.length === 0 ? <p className="text-xs text-faint">Sin servicios.</p> :
                detalle.servicios.map((s, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-body">{s.name}{s.qty > 1 ? ` ×${s.qty}` : ''}</span>
                    <span className="tabular-nums text-strong">{formatCents(s.price_cents * s.qty, symbol)}</span>
                  </div>))}
            </div>

            {detalle.calidad.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold text-strong">Control de calidad</h3>
                {detalle.calidad.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className={c.result === 'rechazado' ? 'text-danger' : 'text-success'}>
                      Intento {c.attempt}: {c.result === 'rechazado' ? `Rechazado — ${c.reject_reason}` : 'Aprobado'}
                    </span>
                    <span className="text-xs text-faint">{c.reviewer ?? ''}</span>
                  </div>))}
              </div>
            )}

            {detalle.inspeccion && (
              <div className="bg-canvas border border-line rounded-xl p-3 text-xs text-body space-y-1">
                <div className="font-bold text-strong text-sm">Inspección al recibir</div>
                {detalle.inspeccion.fuel_level && <div>Combustible: {detalle.inspeccion.fuel_level}</div>}
                {detalle.inspeccion.mileage != null && <div>Kilometraje: {detalle.inspeccion.mileage}</div>}
                {detalle.inspeccion.notes && <div>Notas: {detalle.inspeccion.notes}</div>}
              </div>
            )}

            {detalle.factura && (
              <div className="text-xs text-muted">
                Factura <strong className="text-strong">{detalle.factura.invoice_number}</strong> · {formatCents(detalle.factura.total_cents, symbol)}
              </div>
            )}
            {detalle.notes && <p className="text-xs text-faint">Observaciones: {detalle.notes}</p>}
          </div>
        ) : (
          <p className="text-xs text-faint">No se pudo cargar el detalle.</p>
        )}
      </PanelDetalle>

      {creating && (
        <NewArrivalSupabaseModal
          onClose={() => setCreating(false)}
          onCreated={order => {
            setCreating(false);
            setNotice(`Orden ${order.order_number} registrada para ${order.vehicle_plate}.`);
            load(); refreshQueue();
          }}
        />
      )}
      {imprimiendo && (
        <ComandaOrdenModal order={imprimiendo.order} company={company} branch={branch}
          lavadores={lavadoresImpresion} variante={imprimiendo.variante} onClose={() => setImprimiendo(null)} />
      )}
      {inspecting && (
        <InspectionModal orderId={inspecting.id} orderNumber={inspecting.order_number}
          plate={inspecting.vehicle_plate} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
};
