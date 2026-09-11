import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import {
  fetchResumenCaja, fetchSesionesCaja, ResumenCaja, SesionCaja
} from '../../data/reportsRepository';
import { fetchCashMovements, CashMovement } from '../../data/billingRepository';
import { fetchOperators, Profile } from '../../data/ordersRepository';
import { ErrorState, Pagination } from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { RejillaKpi, Kpi } from '../common/RejillaKpi';
import { TablaDatos } from '../common/TablaDatos';
import { PanelDetalle } from '../common/PanelDetalle';
import { ReporteImprimible, BotonImprimir } from '../common/ReporteImprimible';
import { SeleccionFecha, rangoDeFechas, describirRango } from '../../lib/rangosFecha';
import { etiquetaMetodo } from '../../lib/etiquetas';

/**
 * Caja · lectura gerencial.
 *
 * Vive junto a la operación del cajero pero es otra cosa: el supervisor o el
 * dueño mirando TODAS las cajas del periodo —cuánto entró por método, cuánto
 * salió, qué sobró y qué faltó, y sobre todo el descuadre—. Los sobrantes y los
 * faltantes se muestran POR SEPARADO: netearlos escondería que un faltante se
 * tapó con un sobrante de otra caja. Al abrir una sesión se ve su arqueo y se
 * imprime el cierre.
 */
const PAGE = 15;

export const CajaGerencial: React.FC<{ branchId: string }> = ({ branchId }) => {
  const { company, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [cashierId, setCashierId] = useState('');
  const [estado, setEstado] = useState('');
  const [diferencia, setDiferencia] = useState('');
  const [page, setPage] = useState(0);
  const [cajeros, setCajeros] = useState<Profile[]>([]);
  const [resumen, setResumen] = useState<ResumenCaja | null>(null);
  const [data, setData] = useState<{ total: number; rows: SesionCaja[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detalle de una sesión: su arqueo y sus movimientos.
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [movs, setMovs] = useState<CashMovement[]>([]);
  const [movsCargando, setMovsCargando] = useState(false);

  const { desde, hasta } = rangoDeFechas(sel);

  useEffect(() => { fetchOperators(branchId).then(setCajeros).catch(() => setCajeros([])); }, [branchId]);

  const cargar = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      fetchResumenCaja(branchId, desde, hasta, cashierId || null),
      fetchSesionesCaja(branchId, desde, hasta, cashierId || null, estado || null, diferencia || null, page, PAGE)
    ]).then(([r, s]) => { setResumen(r); setData(s); })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
      .finally(() => setLoading(false));
  }, [branchId, desde, hasta, cashierId, estado, diferencia, page]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPage(0); }, [desde, hasta, cashierId, estado, diferencia]);

  const abrir = (s: SesionCaja) => {
    setSesion(s); setMovs([]); setMovsCargando(true);
    fetchCashMovements(s.id).then(setMovs).catch(() => setMovs([])).finally(() => setMovsCargando(false));
  };

  const money = (c: number) => formatCents(c, symbol);

  const kpis: Kpi[] = useMemo(() => resumen ? [
    { id: 'ventas', label: 'Ventas', valor: resumen.ventas_cents, moneda: true, tono: 'ok',
      hint: `${resumen.cajas_cerradas} cajas cerradas` },
    { id: 'efe', label: 'Efectivo', valor: resumen.efectivo_cents, moneda: true },
    { id: 'salidas', label: 'Salidas', valor: resumen.salidas_cents, moneda: true, tono: 'warn' },
    { id: 'desc', label: 'Descuadre neto', valor: resumen.descuadre_neto_cents, moneda: true,
      tono: resumen.descuadre_neto_cents === 0 ? 'ok' : 'bad',
      hint: `${money(resumen.sobrantes_cents)} sobró · ${money(resumen.faltantes_cents)} faltó` }
  ] : [], [resumen]);

  if (error) return <ErrorState message={error} onRetry={cargar} title="No se pudo cargar el histórico" />;

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE));
  const sel3 = 'bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand';

  return (
    <div className="space-y-4">
      <div className="space-y-3 bg-surface/60 border border-line rounded-2xl p-4">
        <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">Cajero
            <select className={sel3} value={cashierId} onChange={e => setCashierId(e.target.value)}>
              <option value="">Todos</option>
              {cajeros.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">Estado
            <select className={sel3} value={estado} onChange={e => setEstado(e.target.value)}>
              <option value="">Todas</option>
              <option value="closed">Cerradas</option>
              <option value="open">Abiertas</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">Descuadre
            <select className={sel3} value={diferencia} onChange={e => setDiferencia(e.target.value)}>
              <option value="">Todas</option>
              <option value="con">Con diferencia</option>
              <option value="sin">Sin diferencia</option>
            </select>
          </label>
        </div>
      </div>

      <RejillaKpi kpis={kpis} cargando={loading || !resumen} symbol={symbol} />

      <TablaDatos
        columnas={[
          { id: 'ap', label: 'Apertura', render: (s: SesionCaja) => new Date(s.opened_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
          { id: 'caj', label: 'Cajero', render: s => s.cashier ?? '—' },
          { id: 'est', label: 'Estado', render: s => s.status === 'open'
            ? <span className="text-brand-hi font-semibold">Abierta</span> : <span className="text-muted">Cerrada</span> },
          { id: 'ven', label: 'Ventas', numerica: true, ocultarEnMovil: true, render: s => money(s.ventas_cents) },
          { id: 'esp', label: 'Esperado', numerica: true, ocultarEnMovil: true, render: s => money(s.expected_cash_cents) },
          { id: 'con', label: 'Contado', numerica: true, ocultarEnMovil: true, render: s => s.counted_cash_cents == null ? '—' : money(s.counted_cash_cents) },
          { id: 'dif', label: 'Diferencia', numerica: true, render: s => s.difference_cents == null ? '—'
            : <span className={s.difference_cents === 0 ? 'text-success' : s.difference_cents > 0 ? 'text-warning font-bold' : 'text-danger font-bold'}>
                {s.difference_cents > 0 ? '+' : ''}{money(s.difference_cents)}</span> }
        ]}
        filas={data.rows} clave={s => s.id} cargando={loading}
        onFila={abrir}
        vacio="Sin cajas en el periodo." etiqueta="Histórico de cajas" />
      <Pagination page={page} pageCount={pageCount} total={data.total} pageSize={PAGE} loading={loading} onPage={setPage} />

      <PanelDetalle
        abierto={!!sesion}
        titulo={sesion ? `Caja de ${sesion.cashier ?? '—'}` : 'Caja'}
        subtitulo={sesion ? new Date(sesion.opened_at).toLocaleDateString('es-DO') : undefined}
        onCerrar={() => setSesion(null)}
        acciones={sesion ? <BotonImprimir /> : undefined}
      >
        {sesion && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Fondo inicial', money(sesion.initial_amount_cents)],
                ['Ventas', money(sesion.ventas_cents)],
                ['Efectivo', money(sesion.efectivo_cents)],
                ['Tarjeta', money(sesion.tarjeta_cents)],
                ['Transferencia', money(sesion.transferencia_cents)],
                ['Membego', money(sesion.membego_cents)],
                ['Salidas', money(sesion.salidas_cents)],
                ['Efectivo esperado', money(sesion.expected_cash_cents)],
                ['Efectivo contado', sesion.counted_cash_cents == null ? '—' : money(sesion.counted_cash_cents)]
              ].map(([l, v]) => (
                <div key={l} className="bg-canvas border border-line rounded-xl p-3">
                  <div className="text-xs text-muted">{l}</div>
                  <div className="text-sm font-bold text-strong tabular-nums">{v}</div>
                </div>
              ))}
              <div className={`rounded-xl p-3 border ${
                (sesion.difference_cents ?? 0) === 0 ? 'bg-success/10 border-success/30'
                : (sesion.difference_cents ?? 0) > 0 ? 'bg-warning/10 border-warning/30' : 'bg-danger/10 border-danger/30'}`}>
                <div className="text-xs text-muted">Diferencia</div>
                <div className="text-sm font-black tabular-nums">
                  {sesion.difference_cents == null ? '—' : `${sesion.difference_cents > 0 ? '+' : ''}${money(sesion.difference_cents)}`}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-bold text-strong">Movimientos</h3>
              {movsCargando ? <p className="text-xs text-faint flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Cargando…</p>
                : movs.length === 0 ? <p className="text-xs text-faint">Sin movimientos.</p>
                : <TablaDatos
                    columnas={[
                      { id: 'h', label: 'Hora', render: (m: CashMovement) => new Date(m.created_at).toLocaleTimeString('es-DO') },
                      { id: 'c', label: 'Concepto', render: m => m.reason },
                      { id: 'm', label: 'Método', render: m => etiquetaMetodo(m.method) },
                      { id: 'i', label: 'Importe', numerica: true, render: m => (
                        <span className={m.type === 'inflow' ? 'text-success' : 'text-danger'}>
                          {m.type === 'inflow' ? '+' : '−'}{money(m.amount_cents)}</span>) }
                    ]}
                    filas={movs} clave={m => m.id} etiqueta="Movimientos de la caja" />}
            </div>

            <ReporteImprimible
              empresa={company?.trade_name}
              titulo="Cierre de caja"
              periodo={describirRango(sel)}
              filtros={[
                `Cajero: ${sesion.cashier ?? '—'}`,
                `Apertura: ${new Date(sesion.opened_at).toLocaleString('es-DO')}`,
                ...(sesion.closed_at ? [`Cierre: ${new Date(sesion.closed_at).toLocaleString('es-DO')}`] : [])
              ]}
              generadoPor={profile?.full_name}
            >
              <table><tbody>
                <tr><td>Fondo inicial</td><td className="num">{money(sesion.initial_amount_cents)}</td></tr>
                <tr><td>Ventas en efectivo</td><td className="num">{money(sesion.efectivo_cents)}</td></tr>
                <tr><td>Tarjeta</td><td className="num">{money(sesion.tarjeta_cents)}</td></tr>
                <tr><td>Transferencia</td><td className="num">{money(sesion.transferencia_cents)}</td></tr>
                <tr><td>Beneficios Membego</td><td className="num">{money(sesion.membego_cents)}</td></tr>
                <tr><td>Salidas</td><td className="num">−{money(sesion.salidas_cents)}</td></tr>
                <tr><td><strong>Efectivo esperado</strong></td><td className="num"><strong>{money(sesion.expected_cash_cents)}</strong></td></tr>
                <tr><td>Efectivo contado</td><td className="num">{sesion.counted_cash_cents == null ? '—' : money(sesion.counted_cash_cents)}</td></tr>
                <tr><td><strong>Diferencia</strong></td><td className="num"><strong>{sesion.difference_cents == null ? '—' : money(sesion.difference_cents)}</strong></td></tr>
              </tbody></table>
              <p className="pr-nota">Diferencia = efectivo contado − efectivo esperado. Positiva es sobrante; negativa, faltante.</p>
            </ReporteImprimible>
          </div>
        )}
      </PanelDetalle>
    </div>
  );
};
