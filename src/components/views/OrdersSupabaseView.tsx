import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Car, Search, Plus, AlertCircle, RefreshCw, Loader2, ChevronLeft, ChevronRight,
  ClipboardCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useQueueCount } from '../../context/QueueCountContext';
import { formatCents } from '../../lib/money';
import {
  fetchOrderPage, WorkOrder, OrderStatus, STATUS_LABEL
} from '../../data/ordersRepository';
import { NewArrivalSupabaseModal } from '../modals/NewArrivalSupabaseModal';
import { InspectionModal } from '../modals/InspectionModal';

const PAGE_SIZE = 25;

const STATUS_FILTERS: { id: OrderStatus | 'all' | 'active'; label: string }[] = [
  { id: 'active', label: 'En taller' },
  { id: 'all', label: 'Todas' },
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'en_proceso', label: 'En lavado' },
  { id: 'listo', label: 'Listas' },
  { id: 'entregado', label: 'Entregadas' },
  { id: 'cancelado', label: 'Canceladas' }
];

const STATUS_TONE: Record<OrderStatus, string> = {
  pendiente: 'bg-amber-500/20 text-amber-300',
  en_espera: 'bg-sky-500/20 text-sky-300',
  asignada: 'bg-sky-500/20 text-sky-300',
  en_proceso: 'bg-indigo-500/20 text-indigo-300',
  control_calidad: 'bg-purple-500/20 text-purple-300',
  listo: 'bg-emerald-500/20 text-emerald-300',
  entregado: 'bg-slate-800 text-slate-300',
  cancelado: 'bg-rose-500/20 text-rose-300'
};

/**
 * Historial de órdenes sobre Supabase.
 *
 * Paginado y búsqueda en el servidor, igual que en Facturas: la vista auditada
 * filtraba en memoria sobre el array completo en cada pulsación de tecla.
 */
export const OrdersSupabaseView: React.FC = () => {
  const { branch, company } = useAuth();
  const { refresh: refreshQueue } = useQueueCount();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all' | 'active'>('active');

  const [inspecting, setInspecting] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const searchTimer = useRef<number | null>(null);
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => { setSearch(searchInput); setPage(0); }, 350);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchOrderPage({
        branchId: branch.id, page, pageSize: PAGE_SIZE, search, status
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar las órdenes');
    } finally {
      setLoading(false);
    }
  }, [branch, page, search, status]);

  useEffect(() => { void load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudieron cargar las órdenes
          </div>
          <p className="text-xs text-slate-300">{loadError}</p>
          <button onClick={() => void load()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Car className="w-5 h-5 text-indigo-400" /> Órdenes de servicio
          </h2>
          <p className="text-xs text-slate-400">{branch?.name}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Registrar llegada
        </button>
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-2 p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-200">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Descartar aviso" className="px-1 font-bold">×</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <label htmlFor="ord-search" className="sr-only">Buscar orden</label>
          <input
            id="ord-search" type="search" value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Buscar por número de orden, placa o cliente…"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => { setStatus(f.id); setPage(0); }}
              aria-pressed={status === f.id}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                status === f.id
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Listado de órdenes de servicio</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">ORDEN</th>
                <th scope="col" className="p-3 font-semibold">VEHÍCULO</th>
                <th scope="col" className="p-3 font-semibold">CLIENTE</th>
                <th scope="col" className="p-3 font-semibold">LLEGADA</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                <th scope="col" className="p-3 font-semibold text-right">TOTAL</th>
                <th scope="col" className="p-3 font-semibold text-right">INSPECCIÓN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} aria-hidden="true">
                    <td colSpan={7} className="p-3"><div className="h-5 bg-slate-800/60 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-500 italic">
                    {search || status !== 'active'
                      ? 'Ninguna orden coincide con el filtro.'
                      : 'No hay vehículos en el taller ahora mismo.'}
                  </td>
                </tr>
              ) : rows.map(order => (
                <tr key={order.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-3 font-bold text-indigo-300 whitespace-nowrap">{order.order_number}</td>
                  <td className="p-3">
                    <div className="font-bold text-white uppercase">{order.vehicle_plate}</div>
                    <div className="text-xs text-slate-400">
                      {order.vehicle_make_model || '—'} ({order.vehicle_category})
                    </div>
                  </td>
                  <td className="p-3 text-slate-200">{order.customer_name}</td>
                  <td className="p-3 text-slate-400 whitespace-nowrap">
                    {new Date(order.arrival_at).toLocaleString('es-DO')}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_TONE[order.status]}`}>
                      {STATUS_LABEL[order.status]}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-right text-slate-200 whitespace-nowrap">
                    {order.total_cents === 0
                      ? <span className="text-emerald-400">Beneficio</span>
                      : formatCents(order.total_cents, symbol)}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => setInspecting(order)}
                      aria-label={`Inspección de ${order.vehicle_plate}`}
                      title="Estado del vehículo al recibirlo y entregarlo"
                      className="p-1.5 text-sky-400 hover:text-sky-300 rounded-lg hover:bg-slate-800">
                      <ClipboardCheck className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs">
          <span className="text-slate-400">
            {total === 0 ? 'Sin resultados'
              : <>Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</>}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}
              aria-label="Página anterior"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-slate-300">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-400 tabular-nums">{page + 1} / {pageCount}</span>
            <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1 || loading}
              aria-label="Página siguiente"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-slate-300">
              <ChevronRight className="w-4 h-4" />
            </button>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
          </div>
        </div>
      </div>

      {creating && (
        <NewArrivalSupabaseModal
          onClose={() => setCreating(false)}
          onCreated={order => {
            setCreating(false);
            setNotice(`Orden ${order.order_number} registrada para ${order.vehicle_plate}.`);
            void load();
            refreshQueue();
          }}
        />
      )}

      {inspecting && (
        <InspectionModal
          orderId={inspecting.id}
          orderNumber={inspecting.order_number}
          plate={inspecting.vehicle_plate}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
};
