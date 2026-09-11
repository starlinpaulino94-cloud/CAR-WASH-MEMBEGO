import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { fetchReporteRentabilidad, ReporteRentabilidad } from '../../data/reportsRepository';
import { fetchActiveBranches, Branch } from '../../data/branchRepository';
import { ViewHeader, ErrorState, ReadOnlyNotice, InlineAlert, HelpNote } from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { TablaDatos } from '../common/TablaDatos';
import { ReporteImprimible, BotonImprimir } from '../common/ReporteImprimible';
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
        actions={<BotonImprimir disabled={!r || loading} />}
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
          <p className="pr-nota">Resultado operativo estimado: no incluye costos fijos sin registrar ni depreciación. No es utilidad neta contable.</p>
        </ReporteImprimible>
      )}
    </div>
  );
};
