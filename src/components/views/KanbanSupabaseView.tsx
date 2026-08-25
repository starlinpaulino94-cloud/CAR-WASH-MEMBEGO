import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Car, Plus, ShieldCheck, UserCheck, AlertCircle, RefreshCw, Loader2, Warehouse, X, Ban, Receipt
} from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { useQueueCount } from '../../context/QueueCountContext';
import { dejarOrdenParaFacturar } from '../../data/billingRepository';
import { formatCents } from '../../lib/money';
import {
  fetchBoardOrders, fetchItemsForOrders, fetchBays, fetchOperators, fetchAssignees,
  advanceOrder, cancelOrder, allowedTransitions, STATUS_LABEL,
  WorkOrder, WorkOrderItem, Bay, Profile, OrderStatus
} from '../../data/ordersRepository';
import { can } from '../../lib/auth';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { NewArrivalSupabaseModal } from '../modals/NewArrivalSupabaseModal';
import { QcReviewModal } from '../modals/QcReviewModal';

const COLUMNS: { id: OrderStatus; label: string; tone: string }[] = [
  { id: 'pendiente',       label: 'Llegadas',        tone: 'border-warning/50 bg-warning/5' },
  { id: 'en_espera',       label: 'En cola',          tone: 'border-info/50 bg-info/5' },
  { id: 'en_proceso',      label: 'En lavado',        tone: 'border-brand/50 bg-brand/5' },
  { id: 'control_calidad', label: 'Control calidad',  tone: 'border-brand-2/50 bg-brand/5' },
  { id: 'listo',           label: 'Listo para entrega', tone: 'border-success/50 bg-success/5' },
  { id: 'entregado',       label: 'Entregados',       tone: 'border-line-strong bg-surface/30' }
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
  const { branch, company, profile } = useAuth();
  const { refresh: refreshQueue } = useQueueCount();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [items, setItems] = useState<Map<string, WorkOrderItem[]>>(new Map());
  const [assignees, setAssignees] = useState<Map<string, string[]>>(new Map());
  const [bays, setBays] = useState<Bay[]>([]);
  const [operators, setOperators] = useState<Profile[]>([]);
  // Revisión de calidad: la orden en control_calidad se resuelve con checklist.
  const [reviewing, setReviewing] = useState<WorkOrder | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [startTarget, setStartTarget] = useState<WorkOrder | null>(null);

  /*
   * Cancelar una orden.
   *
   * El tablero ya excluía `cancelado` de los botones de transición
   * (`nexts.filter(n => n !== 'cancelado')`) porque no había forma de pedir el
   * motivo. Esto es lo que faltaba: un diálogo aparte, con su motivo
   * obligatorio, para lo que es una operación correctiva y no un paso del flujo.
   */
  const puedeCancelar = can(profile, 'cancelOrder');
  const puedeFacturar = can(profile, 'issueInvoice');
  const { navigate } = useNavigation();

  /** Manda la orden al POS ya cargada, para cobrarla sin buscarla a mano. */
  const facturarOrden = (order: WorkOrder) => {
    dejarOrdenParaFacturar(order.id);
    navigate('/ventas/pos');
  };
  const [cancelando, setCancelando] = useState<WorkOrder | null>(null);
  const [motivo, setMotivo] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
      refreshQueue();   // el badge de la barra lateral se entera al momento
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo mover la orden');
    } finally {
      setMovingId(null);
    }
  };

  const confirmarCancelacion = async () => {
    if (!cancelando) return;
    if (motivo.trim().length < 5) {
      setCancelError('Explique por qué se cancela (mínimo 5 caracteres).');
      return;
    }
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelOrder(cancelando.id, motivo.trim());
      setCancelando(null);
      setMotivo('');
      await load();
      refreshQueue();
    } catch (err) {
      // El servidor ya redacta lo importante —«anule primero la factura»—, así
      // que se enseña tal cual y el diálogo se queda abierto para leerlo.
      setCancelError(err instanceof Error ? err.message : 'No se pudo cancelar la orden');
    } finally {
      setCancelBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-danger/40 border border-danger/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-danger font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar el tablero
          </div>
          <p className="text-xs text-body">{loadError}</p>
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const freeBays = bays.filter(b => b.status === 'disponible');

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <Car className="w-5 h-5 text-brand" /> Tablero de operación
          </h2>
          <p className="text-xs text-muted">
            {branch?.name} · {freeBays.length} de {bays.length} bahías libres
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} /> Actualizar
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Registrar llegada
          </Button>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" />
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
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <h3 className="font-bold text-xs text-body">{col.label}</h3>
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-surface-2 text-body font-extrabold text-xs flex items-center justify-center">
                  {loading ? '·' : list.length}
                </span>
              </div>

              <div className="space-y-3 flex-1 overflow-y-auto max-h-[70vh] pr-1">
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-28 bg-surface border border-line rounded-xl animate-pulse" />
                  ))
                ) : list.length === 0 ? (
                  <p className="text-center py-8 text-xs text-faint italic">Sin vehículos</p>
                ) : list.map(order => {
                  const orderItems = items.get(order.id) ?? [];
                  const orderOps = assignees.get(order.id) ?? [];
                  const nexts = allowedTransitions(order.status);
                  const busy = movingId === order.id;

                  return (
                    <article
                      key={order.id}
                      className="bg-surface border border-line hover:border-line-strong p-3 rounded-xl shadow-md space-y-2.5 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-sm text-strong tracking-wider bg-canvas px-2 py-0.5 rounded border border-line inline-block">
                            {order.vehicle_plate}
                          </div>
                          <div className="text-xs text-muted mt-0.5">{order.vehicle_make_model || '—'}</div>
                        </div>
                        <span className="text-xs font-bold text-brand-hi bg-brand-soft/60 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {order.order_number}
                        </span>
                      </div>

                      <div className="text-xs space-y-1">
                        <div className="text-body font-medium truncate">{order.customer_name}</div>
                        {order.membego_benefit_id && (
                          <span className="text-xs bg-success/20 text-success border border-success/30 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Beneficio Membego
                          </span>
                        )}
                        {order.priority === 'alta' && (
                          <span className="text-xs bg-warning/20 text-warning border border-warning/30 px-1.5 py-0.5 rounded font-bold">
                            Prioridad alta
                          </span>
                        )}
                      </div>

                      {orderItems.length > 0 && (
                        <p className="text-xs text-muted bg-canvas/50 p-2 rounded border border-line/80 line-clamp-2">
                          {orderItems.map(i => i.name).join(', ')}
                        </p>
                      )}

                      {order.bay_id && (
                        <div className="text-xs text-brand-hi flex items-center gap-1">
                          <Warehouse className="w-3 h-3" />
                          {bays.find(b => b.id === order.bay_id)?.name ?? 'Bahía asignada'}
                        </div>
                      )}

                      <div className="text-xs text-muted flex items-center justify-between gap-2 pt-1 border-t border-line/60">
                        <span className="flex items-center gap-1 min-w-0">
                          <UserCheck className="w-3 h-3 text-brand flex-shrink-0" />
                          <span className="truncate">
                            {orderOps.length > 0 ? orderOps.map(operatorName).join(', ') : 'Sin asignar'}
                          </span>
                        </span>
                        <span className="font-bold text-body whitespace-nowrap">
                          {order.total_cents === 0 ? 'Beneficio' : formatCents(order.total_cents, symbol)}
                        </span>
                      </div>

                      {order.status === 'control_calidad' && (
                        <div className="pt-1">
                          <Button size="xs" className="w-full" disabled={busy} onClick={() => setReviewing(order)}>
                            <ShieldCheck /> Revisar calidad…
                          </Button>
                        </div>
                      )}

                      {nexts.length > 0 && (
                        <div className="pt-1 space-y-1">
                          {nexts.filter(n => n !== 'cancelado').map(next => (
                            <Button
                              key={next}
                              variant="secondary" size="xs" className="w-full"
                              disabled={busy}
                              onClick={() => {
                                if (next === 'en_proceso') setStartTarget(order);
                                else void move(order, next);
                              }}
                            >
                              {busy && <Loader2 className="animate-spin" />}
                              {next === 'en_proceso' ? 'Iniciar lavado…' : `Mover a ${STATUS_LABEL[next]}`}
                            </Button>
                          ))}
                        </div>
                      )}

                      {/* Facturar sin ir a buscarla al POS: manda la orden ya
                          cargada. Solo si está pendiente de cobro y no cancelada. */}
                      {puedeFacturar && order.payment_status === 'pendiente'
                        && order.status !== 'cancelado' && (
                        <Button
                          variant="secondary" size="xs" className="w-full"
                          disabled={busy}
                          onClick={() => facturarOrden(order)}
                          aria-label={`Facturar la orden ${order.order_number}`}
                        >
                          <Receipt /> Facturar
                        </Button>
                      )}

                      {/* Cancelar va aparte de los botones de flujo y en gris:
                          no es un paso siguiente, es deshacer. Solo aparece
                          donde la máquina de estados lo permite. */}
                      {puedeCancelar && nexts.includes('cancelado') && (
                        <Button
                          variant="ghost" size="xs" className="w-full text-faint hover:text-danger"
                          disabled={busy}
                          onClick={() => { setMotivo(''); setCancelError(null); setCancelando(order); }}
                          aria-label={`Cancelar la orden ${order.order_number}`}
                        >
                          <Ban /> Cancelar orden
                        </Button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {cancelando && (
        <FormModal
          title={`Cancelar la orden ${cancelando.order_number}`}
          submitLabel="Cancelar la orden"
          busy={cancelBusy}
          error={cancelError}
          onSubmit={() => void confirmarCancelacion()}
          onClose={() => { setCancelando(null); setCancelError(null); }}
          onDismissError={() => setCancelError(null)}
        >
          <p className="text-sm text-body">
            El vehículo <strong className="text-strong">{cancelando.vehicle_plate}</strong> de{' '}
            <strong className="text-strong">{cancelando.customer_name}</strong> sale del tablero.
            La bahía, si tenía una, queda libre.
          </p>
          <Field label="Motivo" htmlFor="cnl-motivo"
            hint="Queda guardado con la orden y en la bitácora. Sin él nadie puede explicar la semana que viene por qué se cayó este lavado.">
            <textarea id="cnl-motivo" rows={3} className={textInputClass} value={motivo} autoFocus
              onChange={e => setMotivo(e.target.value)}
              placeholder="El cliente se llevó el carro sin lavar" />
          </Field>
          {/* Si ya se cobró, esto va a fallar. Decirlo antes ahorra el viaje. */}
          <p className="text-xs text-faint">
            Si la orden ya está facturada, primero hay que anular la factura en
            Facturación: se emite su nota de crédito y después se puede cancelar.
          </p>
        </FormModal>
      )}

      {reviewing && (
        <QcReviewModal
          orderId={reviewing.id}
          orderNumber={reviewing.order_number}
          plate={reviewing.vehicle_plate}
          operators={operators}
          onClose={() => setReviewing(null)}
          onDone={result => {
            setReviewing(null);
            setActionError(null);
            void load();
            refreshQueue();
            if (result === 'rechazado') {
              setActionError('Revisión rechazada: la orden volvió a lavado para reproceso.');
            }
          }}
        />
      )}

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
          onCreated={() => { setCreating(false); void load(); refreshQueue(); }}
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

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onCancel(); }}>
      <DialogContent showCloseButton={false} className="flex max-w-md flex-col gap-0 overflow-hidden p-0">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div>
            <DialogTitle className="font-bold text-strong text-sm">Iniciar lavado</DialogTitle>
            <p className="text-xs text-muted">{order.vehicle_plate} · {order.order_number}</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar" disabled={busy} onClick={onCancel}>
            <X />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <label htmlFor="start-bay" className="text-xs font-semibold text-muted uppercase">
              Bahía *
            </label>
            {available.length === 0 ? (
              <p role="status" className="text-xs text-warning bg-warning/40 border border-warning/40 rounded-xl p-3">
                No hay bahías libres. Termine o libere un vehículo antes de iniciar otro lavado.
              </p>
            ) : (
              <select
                id="start-bay" value={bayId} onChange={e => setBayId(e.target.value)} disabled={busy}
                className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
              >
                {available.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted uppercase">Operarios</span>
            {operators.length === 0 ? (
              <p className="text-xs text-faint italic">No hay operarios registrados en esta sucursal.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {operators.map(op => (
                  <button
                    key={op.id} onClick={() => toggle(op.id)} disabled={busy}
                    aria-pressed={selected.has(op.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition-all disabled:opacity-50 ${
                      selected.has(op.id)
                        ? 'bg-primary text-primary-foreground border-transparent'
                        : 'bg-transparent text-body border-line hover:bg-surface-2 hover:text-strong'
                    }`}
                  >
                    {op.full_name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-faint">
              De quienes se asignen aquí saldrán las comisiones cuando se entregue el vehículo.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={() => onConfirm(bayId, [...selected])} disabled={busy || !bayId}>
              {busy && <Loader2 className="animate-spin" />} Iniciar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
