import React, { useCallback, useEffect, useState } from 'react';
import { PieChart, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { fetchManagementReport, ManagementReport } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, StatCard, FilterChips, ReadOnlyNotice, InlineAlert
} from '../common/DataViewShell';
import { RangeId, RANGES, rangeDates } from '../../lib/reportRanges';

/**
 * Rentabilidad del periodo.
 *
 * La pieza que faltaba: el sistema conocía el precio de venta, pero no el
 * costo de ejecutar cada servicio. Con las recetas (0021) el consumo de
 * insumos queda registrado con su costo, y aquí se enfrenta a las ventas:
 * margen por servicio y utilidad bruta estimada.
 */
export const ProfitReportSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'viewAuditLog');

  const [range, setRange] = useState<RangeId>('month');
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (phase !== 'ready' || !allowed) return;
    setLoading(true); setError(null);
    const { from, to } = rangeDates(range);
    fetchManagementReport(from, to)
      .then(setReport)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte'))
      .finally(() => setLoading(false));
  }, [phase, allowed, range]);

  useEffect(() => { reload(); }, [reload]);

  if (phase !== 'ready' || !allowed) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<PieChart className="w-5 h-5 text-indigo-400" />}
          title="Rentabilidad" subtitle="Margen por servicio y utilidad estimada" />
        <ReadOnlyNotice>
          {phase !== 'ready'
            ? 'Disponible al conectar la base de datos.'
            : 'Su rol no permite consultar los reportes gerenciales.'}
        </ReadOnlyNotice>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={reload} title="No se pudo cargar el reporte" />;

  const margin = report?.service_margin ?? [];
  const belowCost = margin.filter(m => m.sales_cents > 0 && m.margin_cents < 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        icon={<PieChart className="w-5 h-5 text-indigo-400" />}
        title="Rentabilidad"
        subtitle="Ventas menos insumos consumidos y gastos: lo que de verdad queda"
      />

      <FilterChips options={RANGES} value={range} onChange={setRange} />

      {loading || !report ? (
        <div className="flex justify-center py-16" aria-busy="true">
          <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Ventas" tone="text-emerald-400"
              value={formatCents(report.sales.total_cents, symbol)} />
            <StatCard label="Insumos consumidos" tone="text-purple-300"
              value={formatCents(report.consumption_cents, symbol)}
              hint="Según las recetas aplicadas al entregar" />
            <StatCard label="Gastos" tone="text-amber-300"
              value={formatCents(report.expenses_total_cents, symbol)} />
            <StatCard label="Utilidad bruta estimada"
              tone={report.gross_profit_cents >= 0 ? 'text-emerald-400' : 'text-rose-400'}
              value={formatCents(report.gross_profit_cents, symbol)}
              hint="Ventas − insumos − gastos" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Compras del periodo"
              value={formatCents(report.purchases_total_cents, symbol)} />
            <StatCard label="Cuentas por pagar (vigentes)" tone="text-amber-300"
              value={formatCents(report.payables_cents, symbol)}
              hint="Saldo pendiente a proveedores, sin importar el rango" />
          </div>

          {belowCost.length > 0 && (
            <InlineAlert tone="warning">
              {belowCost.length === 1
                ? <>El servicio <strong>{belowCost[0].name}</strong> se vendió por debajo de su costo de insumos en este periodo.</>
                : <>{belowCost.length} servicios se vendieron por debajo de su costo de insumos en este periodo.</>}
            </InlineAlert>
          )}

          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <h3 className="font-bold text-white text-sm px-4 pt-4">Margen por servicio</h3>
            <div className="overflow-x-auto p-2">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs">
                    <th className="p-2 font-semibold">SERVICIO</th>
                    <th className="p-2 font-semibold text-right">VENTAS</th>
                    <th className="p-2 font-semibold text-right">INSUMOS</th>
                    <th className="p-2 font-semibold text-right">MARGEN</th>
                    <th className="p-2 font-semibold text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {margin.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500 italic">
                        Sin ventas de servicios en el periodo. El margen aparece cuando hay
                        ventas y las recetas registran consumo al entregar.
                      </td>
                    </tr>
                  ) : margin.map(m => {
                    const pct = m.sales_cents > 0
                      ? Math.round((m.margin_cents / m.sales_cents) * 100)
                      : null;
                    return (
                      <tr key={m.service_id ?? m.name}>
                        <td className="p-2 text-white font-medium">{m.name}</td>
                        <td className="p-2 text-right text-slate-300 tabular-nums whitespace-nowrap">
                          {formatCents(m.sales_cents, symbol)}
                        </td>
                        <td className="p-2 text-right text-purple-300 tabular-nums whitespace-nowrap">
                          {formatCents(m.consumption_cents, symbol)}
                        </td>
                        <td className={`p-2 text-right font-bold tabular-nums whitespace-nowrap ${
                          m.margin_cents >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {formatCents(m.margin_cents, symbol)}
                        </td>
                        <td className={`p-2 text-right font-bold tabular-nums ${
                          pct === null ? 'text-slate-500' : pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {pct === null ? '—' : `${pct}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-sm text-slate-500">
            El margen descuenta SOLO los insumos con receta; no prorratea nómina, comisiones ni
            gastos fijos. Un servicio sin receta muestra margen igual a sus ventas.
          </p>
        </>
      )}
    </div>
  );
};
