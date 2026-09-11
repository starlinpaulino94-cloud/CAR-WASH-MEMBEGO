import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, bpsToPercent } from '../../lib/money';
import { fetchManagementReport, ManagementReport } from '../../data/adminRepository';
import { fetchActiveBranches, Branch } from '../../data/branchRepository';
import {
  ViewHeader, ErrorState, ReadOnlyNotice, InlineAlert, HelpNote
} from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { TablaDatos } from '../common/TablaDatos';
import { ReporteImprimible, BotonImprimir } from '../common/ReporteImprimible';
import { SeleccionFecha, rangoDeFechas, describirRango } from '../../lib/rangosFecha';

/**
 * Rentabilidad del periodo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NINGÚN NÚMERO CON UN NOMBRE MÁS FUERTE DE LO QUE ES
 *
 * La versión anterior rotulaba «lo que de verdad queda» y «utilidad bruta» a
 * un cálculo que solo descuenta insumos con receta y gastos registrados: sin
 * comisiones ni nómina. Un dueño que decida con ese número decide con un
 * resultado inflado. Esta pantalla usa MARGEN SOBRE INSUMOS Y GASTOS, dice en
 * cada línea qué descuenta, y deja explícito lo que todavía no entra. El
 * estado de resultados completo (comisiones, nómina prorrateada) llega con la
 * RPC nueva de la siguiente fase; hasta entonces no se finge que existe.
 */
export const ProfitReportSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'viewAuditLog');

  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [branchId, setBranchId] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [report, setReport] = useState<ManagementReport | null>(null);
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
    fetchManagementReport(desde, hasta, branchId || null)
      .then(setReport)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte'))
      .finally(() => setLoading(false));
  }, [phase, allowed, desde, hasta, branchId]);

  useEffect(() => { reload(); }, [reload]);

  if (phase !== 'ready' || !allowed) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Rentabilidad" subtitle="Margen por servicio del periodo" />
        <ReadOnlyNotice>
          {phase !== 'ready'
            ? 'Disponible al conectar la base de datos.'
            : 'Su rol no permite consultar los reportes gerenciales.'}
        </ReadOnlyNotice>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={reload} title="No se pudo cargar el reporte" />;

  const money = (c: number) => formatCents(c, symbol);
  const margin = report?.service_margin ?? [];
  const belowCost = margin.filter(m => m.sales_cents > 0 && m.margin_cents < 0);
  const pct = (m: { sales_cents: number; margin_cents: number }) =>
    m.sales_cents === 0 ? null : Math.round((m.margin_cents / m.sales_cents) * 10000);

  const sucursalNombre = branchId ? branches.find(b => b.id === branchId)?.name ?? null : null;

  // La cascada: cada línea dice de dónde sale. Los rótulos son la promesa.
  const cascada = report ? [
    { id: 'ventas', label: 'Ingresos por ventas', valor: report.sales.total_cents, signo: '' },
    { id: 'insumos', label: 'Costo de insumos consumidos', valor: -report.consumption_cents, signo: '−' },
    { id: 'gastos', label: 'Gastos operativos registrados', valor: -report.expenses_total_cents, signo: '−' },
    { id: 'margen', label: 'Margen sobre insumos y gastos (estimado)', valor: report.gross_profit_cents, signo: '=' }
  ] : [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        title="Rentabilidad"
        subtitle="Margen del periodo: qué descuenta cada línea está escrito en la propia línea"
        actions={<BotonImprimir disabled={!report || loading} />}
      />

      <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
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

      {branchId && (
        <InlineAlert tone="warning">
          Con sucursal elegida, el consumo de insumos sigue siendo el de TODA la
          empresa: los consumos aún no guardan sucursal. El margen por sucursal
          se corrige en la siguiente fase; mientras, tómelo como referencia.
        </InlineAlert>
      )}

      {/* La cascada del margen. No es un estado de resultados: le faltan
          comisiones y nómina, y por eso no se llama así. */}
      <section className="bg-surface border border-line rounded-2xl divide-y divide-line">
        {loading || !report ? (
          <div className="p-6 space-y-3" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-5 bg-surface-2/60 rounded animate-pulse" />
            ))}
          </div>
        ) : cascada.map(l => (
          <div key={l.id}
            className={`flex items-center justify-between px-5 py-3 ${l.signo === '=' ? 'bg-canvas/50' : ''}`}>
            <span className={`text-sm ${l.signo === '=' ? 'font-bold text-strong' : 'text-body'}`}>
              {l.signo && <span className="text-faint mr-2">{l.signo}</span>}{l.label}
            </span>
            <span className={`tabular-nums font-bold ${
              l.signo === '=' ? (l.valor >= 0 ? 'text-success text-lg' : 'text-danger text-lg') : 'text-strong text-sm'
            }`}>
              {money(Math.abs(l.valor))}
            </span>
          </div>
        ))}
      </section>

      {!loading && report && (
        <p className="text-xs text-faint">
          Todavía NO descuenta comisiones de lavadores ni nómina. No es utilidad
          neta y por eso no se llama así.
        </p>
      )}

      {belowCost.length > 0 && (
        <InlineAlert tone="warning">
          {belowCost.length === 1
            ? <>El servicio <strong>{belowCost[0].name}</strong> se vendió por debajo de su costo de insumos en este periodo.</>
            : <>{belowCost.length} servicios se vendieron por debajo de su costo de insumos en este periodo.</>}
        </InlineAlert>
      )}

      <section className="space-y-2">
        <h3 className="font-bold text-strong text-sm">Margen por servicio</h3>
        <TablaDatos
          columnas={[
            { id: 'n', label: 'Servicio', render: m => <span className="font-medium text-strong">{m.name}</span> },
            { id: 'v', label: 'Ventas', numerica: true, render: m => money(m.sales_cents) },
            { id: 'i', label: 'Insumos', numerica: true, render: m => money(m.consumption_cents) },
            { id: 'm', label: 'Margen', numerica: true,
              render: m => (
                <span className={m.margin_cents < 0 ? 'text-danger font-bold' : ''}>
                  {money(m.margin_cents)}
                </span>
              ) },
            { id: 'p', label: '%', numerica: true,
              render: m => { const p = pct(m); return p === null ? '—' : bpsToPercent(p); } }
          ]}
          filas={margin}
          clave={m => m.service_id ?? m.name}
          cargando={loading}
          vacio="Sin ventas de servicios en el periodo. El margen aparece cuando hay ventas y las recetas registran consumo al entregar."
          etiqueta="Margen por servicio"
        />
      </section>

      <HelpNote summary="Qué descuenta este margen, exactamente">
        Por servicio: sus ventas menos los insumos con receta consumidos al
        entregar. En total: además, los gastos operativos registrados en Caja →
        Gastos. NO entran comisiones, nómina ni costos fijos sin registrar: un
        servicio sin receta muestra margen igual a sus ventas. Las fórmulas
        completas, con comisiones y nómina prorrateada, llegan con el estado de
        resultados de la próxima fase.
      </HelpNote>

      {report && (
        <ReporteImprimible
          empresa={company?.trade_name}
          titulo="Reporte de rentabilidad"
          periodo={describirRango(sel)}
          filtros={sucursalNombre ? [`Sucursal: ${sucursalNombre}`] : []}
          generadoPor={profile?.full_name}
        >
          <table>
            <tbody>
              {cascada.map(l => (
                <tr key={l.id}>
                  <td>{l.signo ? `${l.signo} ` : ''}{l.label}</td>
                  <td className="num">{money(Math.abs(l.valor))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Margen por servicio</h3>
          <table>
            <thead>
              <tr><th>Servicio</th><th className="num">Ventas</th><th className="num">Insumos</th><th className="num">Margen</th><th className="num">%</th></tr>
            </thead>
            <tbody>
              {margin.map(m => {
                const p = pct(m);
                return (
                  <tr key={m.service_id ?? m.name}>
                    <td>{m.name}</td>
                    <td className="num">{money(m.sales_cents)}</td>
                    <td className="num">{money(m.consumption_cents)}</td>
                    <td className="num">{money(m.margin_cents)}</td>
                    <td className="num">{p === null ? '—' : bpsToPercent(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="pr-nota">
            Margen sobre insumos con receta y gastos registrados. No descuenta
            comisiones ni nómina: no es utilidad neta.
          </p>
        </ReporteImprimible>
      )}
    </div>
  );
};
