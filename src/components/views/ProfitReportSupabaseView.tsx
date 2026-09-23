import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import {
  fetchReporteRentabilidad, fetchRenglonesRentabilidad,
  ReporteRentabilidad, RenglonesRentabilidad
} from '../../data/reportsRepository';
import { fetchActiveBranches, Branch } from '../../data/branchRepository';
import { ViewHeader, ErrorState, ReadOnlyNotice, InlineAlert, HelpNote } from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { TablaDatos } from '../common/TablaDatos';
import { ReporteImprimible, imprimirReporte } from '../common/ReporteImprimible';
import { Button } from '../ui/button';
import { Loader2, Printer } from 'lucide-react';
import { SeleccionFecha, rangoDeFechas, describirRango } from '../../lib/rangosFecha';

/**
 * Rentabilidad: el estado de resultados estimado, en cascada y honesto.
 *
 * Sobre profit_report, que descuenta insumos (por sucursal), comisiones y
 * nómina prorrateada — las comisiones UNA sola vez, no dentro de la nómina
 * también. El resultado se rotula «operativo estimado», no «utilidad neta»:
 * sigue sin ser contabilidad financiera completa, y no se le pone un nombre más
 * fuerte del que merece.
 */
export const ProfitReportSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'viewAuditLog');

  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [report, setReport] = useState<ReporteRentabilidad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Imprimir con detalle o solo con los totales. Con detalle por defecto,
   * igual que Ventas y Caja.
   *
   * Aquí importa más que en los otros dos: la pantalla ya avisa de cuántos
   * servicios se vendieron POR DEBAJO DE SU COSTO, y el papel no daba nada con
   * qué averiguar por qué. Un aviso sin el detrás es una alarma que no se puede
   * atender.
   */
  const [conDetalle, setConDetalle] = useState(true);
  const [renglones, setRenglones] = useState<RenglonesRentabilidad | null>(null);
  const [preparando, setPreparando] = useState(false);

  useEffect(() => {
    if (phase !== 'ready' || !allowed) return;
    fetchActiveBranches().then(setBranches).catch(() => setBranches([]));
  }, [phase, allowed]);

  const { desde, hasta } = rangoDeFechas(sel);

  const reload = useCallback(() => {
    if (phase !== 'ready' || !allowed) return;
    setLoading(true); setError(null);
    fetchReporteRentabilidad(desde, hasta, branchId || null)
      .then(setReport)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte'))
      .finally(() => setLoading(false));
  }, [phase, allowed, desde, hasta, branchId]);

  useEffect(() => { reload(); }, [reload]);

  // Cambió el universo: el detalle cargado ya no corresponde.
  useEffect(() => { setRenglones(null); }, [desde, hasta, branchId]);

  const prepararImpresion = async () => {
    if (preparando || !report) return;
    if (!conDetalle || renglones) { imprimirReporte('carta'); return; }
    setPreparando(true); setError(null);
    try {
      setRenglones(await fetchRenglonesRentabilidad(desde, hasta, branchId || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar el detalle');
    } finally {
      setPreparando(false);
    }
  };

  useEffect(() => {
    if (!renglones) return;
    imprimirReporte('carta');
  }, [renglones]);

  /**
   * Los tres orígenes agrupados por servicio, para poder imprimir cada margen
   * con lo que lo forma debajo.
   *
   * Las comisiones se agrupan por NOMBRE y las otras dos por id cuando lo hay:
   * es exactamente como las casa `profit_report`, y alinear la agrupación con
   * el cálculo es lo que hace que el detalle sume lo que dice el resumen.
   */
  const detallePorServicio = useMemo(() => {
    if (!renglones) return new Map<string, {
      ventas: typeof renglones.ventas; insumos: typeof renglones.insumos;
      comisiones: typeof renglones.comisiones;
    }>();
    const mapa = new Map<string, {
      ventas: typeof renglones.ventas; insumos: typeof renglones.insumos;
      comisiones: typeof renglones.comisiones;
    }>();
    const cubo = (nombre: string) => {
      let c = mapa.get(nombre);
      if (!c) { c = { ventas: [], insumos: [], comisiones: [] }; mapa.set(nombre, c); }
      return c;
    };
    for (const v of renglones.ventas) cubo(v.service_name).ventas.push(v);
    for (const i of renglones.insumos) if (i.service_name) cubo(i.service_name).insumos.push(i);
    for (const c of renglones.comisiones) cubo(c.service_name).comisiones.push(c);
    return mapa;
  }, [renglones]);

  if (phase !== 'ready' || !allowed) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Rentabilidad" subtitle="Estado de resultados estimado del periodo" />
        <ReadOnlyNotice>
          {phase !== 'ready' ? 'Disponible al conectar la base de datos.'
            : 'Su rol no permite consultar los reportes gerenciales.'}
        </ReadOnlyNotice>
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} title="No se pudo cargar el reporte" />;

  const money = (c: number) => formatCents(c, symbol);
  const r = report;
  const margin = r?.margen_por_servicio ?? [];
  const belowCost = margin.filter(m => m.sales_cents > 0 && m.margin_cents < 0);
  const sucursalNombre = branchId ? branches.find(b => b.id === branchId)?.name ?? null : null;

  // La cascada. Los signos y los rótulos SON la promesa de lo que se descuenta.
  const cascada = r ? [
    { id: 'v', label: 'Ingresos por ventas', valor: r.ventas_cents, s: '', fuerte: false },
    { id: 'd', label: 'Descuentos', valor: -r.descuentos_cents, s: '−', fuerte: false },
    { id: 'nc', label: 'Notas de crédito', valor: -r.notas_credito_cents, s: '−', fuerte: false },
    { id: 'in', label: 'Ingreso neto', valor: r.ingreso_neto_cents, s: '=', fuerte: true },
    { id: 'i', label: 'Costo de insumos consumidos', valor: -r.insumos_cents, s: '−', fuerte: false },
    { id: 'co', label: 'Comisiones directas', valor: -r.comisiones_cents, s: '−', fuerte: false },
    { id: 'mc', label: 'Margen de contribución', valor: r.margen_contribucion_cents, s: '=', fuerte: true },
    { id: 'g', label: 'Gastos operativos', valor: -r.gastos_cents, s: '−', fuerte: false },
    { id: 'no', label: 'Nómina atribuible al periodo', valor: -r.nomina_cents, s: '−', fuerte: false },
    { id: 'ro', label: 'Resultado operativo estimado', valor: r.resultado_operativo_cents, s: '=', fuerte: true }
  ] : [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        title="Rentabilidad"
        subtitle="Estado de resultados estimado: cada línea dice qué descuenta"
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-line overflow-hidden" role="group"
              aria-label="Nivel de detalle al imprimir">
              <button type="button" onClick={() => setConDetalle(true)} aria-pressed={conDetalle}
                className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                  conDetalle ? 'bg-brand text-on-accent' : 'bg-surface-2 text-muted hover:text-strong'}`}>
                Detallado
              </button>
              <button type="button" onClick={() => setConDetalle(false)} aria-pressed={!conDetalle}
                className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                  !conDetalle ? 'bg-brand text-on-accent' : 'bg-surface-2 text-muted hover:text-strong'}`}>
                Solo totales
              </button>
            </div>
            <Button variant="outline" size="sm" disabled={!r || loading || preparando}
              onClick={() => void prepararImpresion()}>
              {preparando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {preparando ? 'Preparando…' : 'Imprimir'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between bg-surface/60 border border-line rounded-2xl p-4">
        <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
        {branches.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Sucursal
            <select value={branchId} onChange={e => setBranchId(e.target.value)} disabled={loading}
              className="bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand">
              <option value="">Todas</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <section className="bg-surface border border-line rounded-2xl divide-y divide-line">
        {loading || !r ? (
          <div className="p-6 space-y-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-5 bg-surface-2/60 rounded animate-pulse" />)}
          </div>
        ) : cascada.map(l => (
          <div key={l.id} className={`flex items-center justify-between px-5 py-3 ${l.fuerte ? 'bg-canvas/50' : ''}`}>
            <span className={`text-sm ${l.fuerte ? 'font-bold text-strong' : 'text-body'}`}>
              {l.s && <span className="text-faint mr-2 inline-block w-3">{l.s}</span>}{l.label}
            </span>
            <span className={`tabular-nums font-bold ${
              l.id === 'ro' ? (l.valor >= 0 ? 'text-success text-lg' : 'text-danger text-lg')
              : l.fuerte ? 'text-strong' : 'text-body text-sm'}`}>
              {money(Math.abs(l.valor))}
            </span>
          </div>
        ))}
      </section>

      {belowCost.length > 0 && (
        <InlineAlert tone="warning">
          {belowCost.length === 1
            ? <>El servicio <strong>{belowCost[0].name}</strong> se vendió por debajo de su costo (insumos + comisión) en el periodo.</>
            : <>{belowCost.length} servicios se vendieron por debajo de su costo (insumos + comisión) en el periodo.</>}
        </InlineAlert>
      )}

      <section className="space-y-2">
        <h3 className="font-bold text-strong text-sm">Margen por servicio</h3>
        <TablaDatos
          columnas={[
            { id: 'n', label: 'Servicio', render: m => <span className="font-medium text-strong">{m.name}</span> },
            { id: 'q', label: 'Cant.', numerica: true, render: m => m.qty },
            { id: 'v', label: 'Ventas', numerica: true, render: m => money(m.sales_cents) },
            { id: 'i', label: 'Insumos', numerica: true, ocultarEnMovil: true, render: m => money(m.consumption_cents) },
            { id: 'c', label: 'Comisión', numerica: true, ocultarEnMovil: true, render: m => money(m.commission_cents) },
            { id: 'm', label: 'Margen', numerica: true,
              render: m => <span className={m.margin_cents < 0 ? 'text-danger font-bold' : ''}>{money(m.margin_cents)}</span> },
            { id: 'p', label: '%', numerica: true, render: m => m.margin_pct === null ? '—' : `${m.margin_pct}%` }
          ]}
          filas={margin} clave={m => m.service_id ?? m.name} cargando={loading}
          vacio="Sin ventas de servicios en el periodo."
          etiqueta="Margen por servicio" />
      </section>

      <HelpNote summary="Cómo se calcula cada línea">
        Ingreso neto = ventas − descuentos − notas de crédito. Margen de
        contribución = ingreso neto − insumos con receta − comisiones directas.
        Resultado operativo estimado = margen de contribución − gastos
        registrados − nómina del periodo (prorrateada por días, y SIN sus
        comisiones, que ya se restaron arriba: contarlas dos veces inflaría la
        pérdida). Sigue siendo estimado: no incluye costos fijos sin registrar ni
        depreciación, y por eso no se llama utilidad neta.
      </HelpNote>

      {r && (
        <ReporteImprimible
          empresa={company?.trade_name}
          titulo="Estado de resultados estimado"
          periodo={describirRango(sel)}
          filtros={sucursalNombre ? [`Sucursal: ${sucursalNombre}`] : []}
          generadoPor={profile?.full_name}
        >
          <table><tbody>
            {cascada.map(l => (
              <tr key={l.id}><td>{l.s ? `${l.s} ` : ''}{l.label}</td><td className="num">{money(Math.abs(l.valor))}</td></tr>
            ))}
          </tbody></table>
          <h3>Margen por servicio</h3>
          <table>
            <thead><tr><th>Servicio</th><th className="num">Ventas</th><th className="num">Insumos</th><th className="num">Comisión</th><th className="num">Margen</th><th className="num">%</th></tr></thead>
            <tbody>{margin.map(m => (
              <tr key={m.service_id ?? m.name}><td>{m.name}</td><td className="num">{money(m.sales_cents)}</td>
                <td className="num">{money(m.consumption_cents)}</td><td className="num">{money(m.commission_cents)}</td>
                <td className="num">{money(m.margin_cents)}</td><td className="num">{m.margin_pct === null ? '—' : `${m.margin_pct}%`}</td></tr>))}</tbody>
          </table>
          {/* EL DETALLE. Tres listas bajo cada servicio, no tres columnas en la
              misma fila: `profit_report` no atribuye un insumo ni una comisión
              a una venta concreta —los suma por servicio en el periodo, y la
              comisión casando por nombre—. Ponerlos en la misma línea
              inventaría una precisión que el número no tiene. */}
          {conDetalle && renglones && (
            <>
              <h3>Detalle por servicio</h3>
              {renglones.truncated && (
                <p className="pr-nota">
                  ATENCIÓN: hay más renglones de los que caben en un reporte. Se imprimen los
                  primeros {renglones.limit} de cada lista. Acote el periodo para verlos todos.
                </p>
              )}
              <p className="pr-nota">
                Las ventas, los insumos y las comisiones van por separado porque el margen se
                calcula así: los insumos y las comisiones se suman POR SERVICIO en todo el
                periodo, no se reparten entre cada venta.
              </p>

              {margin.map(m => {
                const d = detallePorServicio.get(m.name);
                if (!d) return null;
                return (
                  <React.Fragment key={m.service_id ?? m.name}>
                    <h3>
                      {m.name} · margen {money(m.margin_cents)}
                      {m.margin_cents < 0 ? ' (POR DEBAJO DE SU COSTO)' : ''}
                    </h3>

                    {d.ventas.length > 0 && (
                      <table>
                        <thead>
                          <tr><th colSpan={5}>Ventas · {money(m.sales_cents)}</th></tr>
                          <tr>
                            <th>Fecha</th><th>Factura</th><th>Vehículo / cliente</th>
                            <th className="num">Importe</th><th>Facturó</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.ventas.map((v, i) => (
                            <tr key={`v${i}`}>
                              <td>{new Date(v.created_at).toLocaleDateString('es-DO')}</td>
                              <td>{v.invoice_number}</td>
                              <td>{[v.vehicle_plate, v.customer_name].filter(Boolean).join(' · ') || '—'}</td>
                              <td className="num">{money(v.amount_cents)}</td>
                              <td>{v.cashier_name ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {d.insumos.length > 0 && (
                      <table>
                        <thead>
                          <tr><th colSpan={4}>Insumos consumidos · {money(m.consumption_cents)}</th></tr>
                          <tr><th>Fecha</th><th>Orden</th><th>Producto</th><th className="num">Costo</th></tr>
                        </thead>
                        <tbody>
                          {d.insumos.map((x, i) => (
                            <tr key={`i${i}`}>
                              <td>{new Date(x.created_at).toLocaleDateString('es-DO')}</td>
                              <td>{x.order_number}</td>
                              <td>{x.product_name ?? '—'}</td>
                              <td className="num">{money(x.cost_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {d.comisiones.length > 0 && (
                      <table>
                        <thead>
                          <tr><th colSpan={4}>Comisiones · {money(m.commission_cents)}</th></tr>
                          <tr><th>Fecha</th><th>Orden</th><th>Lavador</th><th className="num">Importe</th></tr>
                        </thead>
                        <tbody>
                          {d.comisiones.map((c, i) => (
                            <tr key={`c${i}`}>
                              <td>{new Date(c.earned_on).toLocaleDateString('es-DO')}</td>
                              <td>{c.order_number ?? '—'}</td>
                              <td>{c.lavador ?? '—'}{c.is_paid ? '' : ' (sin pagar)'}</td>
                              <td className="num">{money(c.amount_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </React.Fragment>
                );
              })}
            </>
          )}

          <p className="pr-nota">Resultado operativo estimado: no incluye costos fijos sin registrar ni depreciación. No es utilidad neta contable.</p>
        </ReporteImprimible>
      )}
    </div>
  );
};
