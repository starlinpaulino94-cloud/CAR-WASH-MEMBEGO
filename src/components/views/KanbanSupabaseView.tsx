import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Car, Plus, ShieldCheck, UserCheck, AlertCircle, RefreshCw, Loader2, Warehouse, X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import {
  fetchBoardOrders, fetchItemsForOrders, fetchBays, fetchOperators, fetchAssignees,
  advanceOrder, allowedTransitions, STATUS_LABEL,
  WorkOrder, WorkOrderItem, Bay, Profile, OrderStatus
} from '../../data/ordersRepository';
import { NewArrivalSupabaseModal } from '../modals/NewArrivalSupabaseModal';

const COLUMNS: { id: OrderStatus; label: string; tone: string }[] = [
  { id: 'pendiente',       label: 'Llegadas',        tone: 'border-amber-500/50 bg-amber-500/5' },
  { id: 'en_espera',       label: 'En cola',          tone: 'border-sky-500/50 bg-sky-500/5' },
  { id: 'en_proceso',      label: 'En lavado',        tone: 'border-indigo-500/50 bg-indigo-500/5' },
  { id: 'control_calidad', label: 'Control calidad',  tone: 'border-purple-500/50 bg-purple-500/5' },
  { id: 'listo',           label: 'Listo para entrega', tone: 'border-emerald-500/50 bg-emerald-500/5' },
  { id: 'entregado',       label: 'Entregados',       tone: 'border-slate-700 bg-slate-900/30' }
];

/**
 * Tablero de operación sobre Supabase.
 *
 * Diferencias de fondo con el auditado:
 *  - Las órdenes se agrupan por estado en UN solo recorrido, no con seis
 *    `filter` completos por render (§3.2).
 *  - La columna de entregados está acotada: antes crecía sin límite.
 *  - Iniciar el lavado exige elegir bahía de verdad, y la base rechaza las
 *    ocupadas. El tablero anterior metía todos los vehículos en 'bay-1'.
 *  - Los cambios de estado van por `advance_work_order`, que valida la
 *    transición y libera la bahía al salir de lavado.
 */
export const KanbanSupabaseView: React.FC = () => {
  const { branch, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [items, setItems] = useState<Map<string, WorkOrderItem[]>>(new Map());
  const [assignees, setAssignees] = useState<Map<string, string[]>>(new Map());
  const [bays, setBays] = useState<Bay[]>([]);
  const [operators, setOperators] = useState<Profile[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [startTarget, setStartTarget] = useState<WorkOrder | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [board, bayRows, ops] = await Promise.all([
        fetchBoardOrders(branch.id),
        fetchBays(branch.id),
        fetchOperators(branch.id)
      ]);
      const ids = board.map(o => o.id);
      // Una consulta para todos los ítems y otra para los asignados: el patrón
      // ingenuo sería una por tarjeta, es decir un N+1 en el camino caliente.
      const [itemMap, assigneeMap] = await Promise.all([
        fetchItemsForOrders(ids),
        fetchAssignees(ids)
      ]);
      setOrders(board);
      setItems(itemMap);
      setAssignees(assigneeMap);
      setBays(bayRows);
      setOperators(ops);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el tablero');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  // Agrupación en un solo recorrido, memoizada.
  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, WorkOrder[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const order of orders) {
      const bucket = map.get(order.status);
      if (bucket) bucket.push(order);
    }
    return map;
  }, [orders]);

  const operatorName = useCallback(
    (id: string) => operators.find(o => o.id === id)?.full_name ?? '—',
    [operators]
  );

  const move = async (order: WorkOrder, to: OrderStatus, bayId?: string, ops?: string[]) => {
    setMovingId(order.id);
    setActionError(null);
    try {
      await advanceOrder(order.id, to, bayId, ops);
      setStartTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo mover la orden');
    } finally {
      setMovingId(null);
    }
  };

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar el tablero
          </div>
          <p className="text-xs text-slate-300">{loadError}</p>
          <button onClick={() => void load()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  const freeBays = bays.filter(b => b.status === 'disponible');

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Car className="w-5 h-5 text-indigo-400" /> Tablero de operación
          </h2>
          <p className="text-xs text-slate-400">
            {branch?.name} · {freeBays.length} de {bays.length} bahías libres
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Registrar llegada
          </button>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Descartar" className="px-1 font-bold">×</button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(col => {
          const list = byStatus.get(col.id) ?? [];
          return (
            <section
              key={col.id}
              aria-label={col.label}
              className={`flex flex-col rounded-2xl border ${col.tone} p-3 space-y-3 w-[260px] flex-shrink-0`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="font-bold text-xs text-slate-200">{col.label}</h3>
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-slate-800 text-slate-300 font-extrabold text-[10px] flex items-center justify-center">
                  {loading ? '·' : list.length}
                </span>
              </div>

              <div className="space-y-3 flex-1 overflow-y-auto max-h-[70vh] pr-1">
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-28 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
                  ))
                ) : list.length === 0 ? (
                  <p className="text-center py-8 text-xs text-slate-600 italic">Sin vehículos</p>
                ) : list.map(order => {
                  const orderItems = items.get(order.id) ?? [];
                  const orderOps = assignees.get(order.id) ?? [];
                  const nexts = allowedTransitions(order.status);
                  const busy = movingId === order.id;

                  return (
                    <article
                      key={order.id}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-3 rounded-xl shadow-md space-y-2.5 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-sm text-white tracking-wider bg-slate-950 px-2 py-0.5 rounded border border-slate-800 inline-block">
                            {order.vehicle_plate}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{order.vehicle_make_model || '—'}</div>
                        </div>
                        <span className="text-[9px] font-bold text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {order.order_number}
                        </span>
                      </div>

                      <div className="text-xs space-y-1">
                        <div className="text-slate-300 font-medium truncate">{order.customer_name}</div>
                        {order.membego_benefit_id && (
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Beneficio Membego
                          </span>
                        )}
                        {order.priority === 'alta' && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">
                            Prioridad alta
                          </span>
                        )}
                      </div>

                      {orderItems.length > 0 && (
                        <p className="text-[11px] text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800/80 line-clamp-2">
                          {orderItems.map(i => i.name).join(', ')}
                        </p>
                      )}

                      {order.bay_id && (
                        <div className="text-[10px] text-indigo-300 flex items-center gap-1">
                          <Warehouse className="w-3 h-3" />
                          {bays.find(b => b.id === order.bay_id)?.name ?? 'Bahía asignada'}
                        </div>
                      )}

                      <div className="text-[10px] text-slate-400 flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                        <span className="flex items-center gap-1 min-w-0">
                          <UserCheck className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                          <span className="truncate">
                            {orderOps.length > 0 ? orderOps.map(operatorName).join(', ') : 'Sin asignar'}
                          </span>
                        </span>
                        <span className="font-bold text-slate-300 whitespace-nowrap">
                          {order.total_cents === 0 ? 'Beneficio' : formatCents(order.total_cents, symbol)}
                        </span>
                      </div>

                      {nexts.length > 0 && (
                        <div className="pt-1 space-y-1">
                          {nexts.filter(n => n !== 'cancelado').map(next => (
                            <button
                              key={next}
                              disabled={busy}
                              onClick={() => {
                                if (next === 'en_proceso') setStartTarget(order);
                                else void move(order, next);
                              }}
                              className="w-full py-1.5 bg-slate-800 hover:bg-indigo-600 disabled:opacity-40 text-slate-200 hover:text-white font-bold text-[10px] rounded transition-colors flex items-center justify-center gap-1"
                            >
                              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                              {next === 'en_proceso' ? 'Iniciar lavado…' : `Mover a ${STATUS_LABEL[next]}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {startTarget && (
        <StartServiceDialog
          order={startTarget}
          bays={bays}
          operators={operators}
          busy={movingId === startTarget.id}
          onCancel={() => setStartTarget(null)}
          onConfirm={(bayId, ops) => void move(startTarget, 'en_proceso', bayId, ops)}
        />
      )}

      {creating && (
        <NewArrivalSupabaseModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load(); }}
        />
      )}
    </div>
  );
};

interface StartProps {
  order: WorkOrder;
  bays: Bay[];
  operators: Profile[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (bayId: string, operators: string[]) => void;
}

/**
 * Elección de bahía y operarios al iniciar el lavado.
 *
 * Existe porque el tablero auditado llamaba a updateOrderStatus con 'bay-1' y
 * washers[0] codificados: todos los vehículos acababan "en la bahía 1" y las
 * bahías nunca reflejaban la realidad.
 */
const StartServiceDialog: React.FC<StartProps> = ({
  order, bays, operators, busy, onCancel, onConfirm
}) => {
  const available = bays.filter(b => b.status === 'disponible');
  const [bayId, setBayId] = useState(available[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div role="dialog" aria-modal="true" aria-label="Iniciar lavado"
        className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-slate-800 px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-white text-sm">Iniciar lavado</h2>
            <p className="text-xs text-slate-400">{order.vehicle_plate} · {order.order_number}</p>
          </div>
          <button onClick={onCancel} disabled={busy} aria-label="Cerrar"
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <label htmlFor="start-bay" className="text-xs font-semibold text-slate-400 uppercase">
              Bahía *
            </label>
            {available.length === 0 ? (
              <p role="status" className="text-xs text-amber-300 bg-amber-950/40 border border-amber-500/40 rounded-xl p-3">
                No hay bahías libres. Termine o libere un vehículo antes de iniciar otro lavado.
              </p>
            ) : (
              <select
                id="start-bay" value={bayId} onChange={e => setBayId(e.target.value)} disabled={busy}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                {available.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase">Operarios</span>
            {operators.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No hay operarios registrados en esta sucursal.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {operators.map(op => (
                  <button
                    key={op.id} onClick={() => toggle(op.id)} disabled={busy}
                    aria-pressed={selected.has(op.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border text-left transition-all disabled:opacity-50 ${
                      selected.has(op.id)
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {op.full_name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-500">
              De quienes se asignen aquí saldrán las comisiones cuando se entregue el vehículo.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onCancel} disabled={busy}
              className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl disabled:opacity-50">
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(bayId, [...selected])}
              disabled={busy || !bayId}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Iniciar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
