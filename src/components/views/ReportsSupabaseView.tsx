import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchAuditPage, fetchDashboardMetrics, AuditLog, DashboardMetrics
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  StatCard, FilterChips, ReadOnlyNotice
} from '../common/DataViewShell';

const PAGE_SIZE = 25;

type RangeId = 'today' | 'week' | 'month';
const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: '7 días' },
  { id: 'month', label: 'Este mes' }
];

function bounds(id: RangeId): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (id === 'today') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  if (id === 'week') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), to };
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
}

/**
 * Reportes y bitácora de auditoría.
 *
 * La bitácora es ahora una tabla de solo inserción en la base, no un array en
 * memoria que se perdía al refrescar mientras la pantalla se titulaba "Audit
 * Trail Inalterable" (§7.6). Y está paginada: el histórico de una operación
 * real no cabe en una pantalla.
 */
export const ReportsSupabaseView: React.FC = () => {
  const { company, branch, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canSee = can(profile, 'viewAuditLog');

  const [range, setRange] = useState<RangeId>('month');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const period = useMemo(() => bounds(range), [range]);

  const q = usePagedQuery<AuditLog>({
    fetcher: fetchAuditPage, pageSize: PAGE_SIZE, enabled: canSee
  });

  const loadMetrics = useCallback(async () => {
    if (!branch) return;
    setMetricsError(null);
    try { setMetrics(await fetchDashboardMetrics(branch.id, period.from, period.to)); }
    catch (err) { setMetricsError(err instanceof Error ? err.message : 'No se pudieron cargar las métricas'); }
  }, [branch, period]);

  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  if (!canSee) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <ViewHeader icon={<BarChart3 className="w-5 h-5 text-indigo-400" />}
          title="Reportes y auditoría" />
        <ReadOnlyNotice>
          Su rol no permite consultar la bitácora de auditoría. La restricción la aplica la
          base de datos, no solo esta pantalla.
        </ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar la bitácora" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<BarChart3 className="w-5 h-5 text-indigo-400" />}
        title="Reportes y auditoría"
        subtitle={`${branch?.name} · registro de solo inserción`}
        actions={<FilterChips options={RANGES} value={range} onChange={setRange} />}
      />

      {metricsError ? (
        <div role="alert" className="text-xs text-rose-300">{metricsError}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Facturado en el periodo" tone="text-emerald-400"
            value={metrics ? formatCents(metrics.sales_cents, symbol) : '—'}
            hint={metrics ? `${metrics.invoice_count} comprobantes` : undefined} />
          <StatCard label="Anulado" tone={metrics && metrics.annulled_cents > 0 ? 'text-rose-400' : 'text-slate-500'}
            value={metrics ? formatCents(metrics.annulled_cents, symbol) : '—'} />
          <StatCard label="Vehículos recibidos" tone="text-indigo-400"
            value={metrics ? String(metrics.arrived) : '—'}
            hint={metrics ? `${metrics.delivered} entregados` : undefined} />
          <StatCard label="Eventos auditados" tone="text-amber-400"
            value={q.loading ? '—' : String(q.total)} hint="histórico completo" />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h3 className="font-bold text-white text-sm">Bitácora de auditoría</h3>
        </div>
        <SearchBox id="audit-search" label="Buscar en la bitácora" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por acción, detalle o usuario…" />

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Eventos auditados</caption>
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                  <th scope="col" className="p-3 font-semibold">CUÁNDO</th>
                  <th scope="col" className="p-3 font-semibold">ACCIÓN</th>
                  <th scope="col" className="p-3 font-semibold">DETALLE</th>
                  <th scope="col" className="p-3 font-semibold">QUIÉN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {q.loading ? <SkeletonRows cols={4} />
                  : q.rows.length === 0 ? (
                    <EmptyRow cols={4}>
                      {q.searchInput ? 'Ningún evento coincide con la búsqueda.' : 'Todavía no hay eventos registrados.'}
                    </EmptyRow>
                  ) : q.rows.map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/40 align-top">
                      <td className="p-3 text-slate-500 whitespace-nowrap">
                        {new Date(log.occurred_at).toLocaleString('es-DO')}
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-indigo-300 whitespace-nowrap">{log.action}</span>
                        <div className="text-[10px] text-slate-500">{log.entity}</div>
                      </td>
                      <td className="p-3 text-slate-300">{log.details}</td>
                      <td className="p-3 text-slate-400 whitespace-nowrap">
                        {log.actor_name || '—'}
                        {log.actor_role && <div className="text-[10px] text-slate-600 uppercase">{log.actor_role}</div>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
            pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
        </div>
      </div>

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        {q.loading && <Loader2 className="w-3 h-3 animate-spin" />}
        La bitácora no admite modificación ni borrado, garantizado por permisos, políticas y
        trigger. El autor y la hora los sella el servidor.
      </p>
    </div>
  );
};
