import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, ArrowRight, Clock, Car, CheckCircle2, DollarSign } from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import { fetchDashboardMetrics, DashboardMetrics } from '../../data/adminRepository';
import { ViewHeader, ErrorState, StatCard } from '../common/DataViewShell';

type RangeId = 'today' | 'week' | 'month';

const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' }
];

/**
 * Calcula el rango en la zona horaria del navegador.
 *
 * El panel auditado no tenía rango: sumaba TODO el histórico bajo el rótulo
 * "Ventas Facturadas Hoy" (§M11). Aquí el periodo es explícito y visible.
 */
function rangeBounds(id: RangeId): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (id === 'today') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  }
  if (id === 'week') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), to };
  }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
}

export const DashboardSupabaseView: React.FC = () => {
  const { navigate } = useNavigation();
  const { branch, company, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [range, setRange] = useState<RangeId>('today');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(() => rangeBounds(range), [range]);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setError(null);
    try {
      setMetrics(await fetchDashboardMetrics(branch.id, bounds.from, bounds.to));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los indicadores');
    } finally {
      setLoading(false);
    }
  }, [branch, bounds]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} title="No se pudieron cargar los indicadores" />;

  const skeleton = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 bg-surface border border-line rounded-2xl animate-pulse" />
      ))}
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <ViewHeader
        title={`Hola, ${profile?.full_name?.split(' ')[0] ?? ''}`}
        subtitle={`${branch?.name} · ${RANGES.find(r => r.id === range)?.label.toLowerCase()}`}
        actions={
          <>
            <div className="flex gap-1.5">
              {RANGES.map(r => (
                <button key={r.id} onClick={() => setRange(r.id)} aria-pressed={range === r.id}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                    range === r.id
                      ? 'bg-brand text-on-accent border-brand'
                      : 'bg-surface text-muted border-line hover:border-line-strong'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={() => void load()} disabled={loading} aria-label="Actualizar indicadores"
              className="px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-line-strong text-body rounded-xl disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      {/* Estado del taller AHORA: no depende del rango elegido. */}
      <section aria-label="Estado del taller" className="space-y-2">
        <h3 className="text-xs font-extrabold text-faint uppercase tracking-wider">
          En el taller ahora
        </h3>
        {loading && !metrics ? skeleton : metrics && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="En cola" value={String(metrics.in_queue)} tone="text-warning"
              hint="Llegadas sin iniciar" />
            <StatCard label="En proceso" value={String(metrics.in_process)} tone="text-brand"
              hint="Lavado y control de calidad" />
            <StatCard label="Listos para entrega" value={String(metrics.ready)} tone="text-success"
              hint="Esperando al cliente" />
          </div>
        )}
      </section>

      <section aria-label="Resultados del periodo" className="space-y-2">
        <h3 className="text-xs font-extrabold text-faint uppercase tracking-wider">
          {RANGES.find(r => r.id === range)?.label}
        </h3>
        {loading && !metrics ? skeleton : metrics && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Vehículos recibidos" value={String(metrics.arrived)}
              hint={`${metrics.delivered} entregados`} />
            <StatCard label="Facturado" value={formatCents(metrics.sales_cents, symbol)}
              tone="text-success" hint={`${metrics.invoice_count} comprobantes`} />
            <StatCard label="Ticket promedio" value={formatCents(metrics.avg_ticket_cents, symbol)}
              tone="text-brand" />
            <StatCard label="Anulado" value={formatCents(metrics.annulled_cents, symbol)}
              tone={metrics.annulled_cents > 0 ? 'text-danger' : 'text-faint'}
              hint={metrics.membego_orders > 0 ? `${metrics.membego_orders} con beneficio Membego` : undefined} />
          </div>
        )}
      </section>

      <section aria-label="Accesos rápidos" className="bg-surface/80 border border-line rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-strong text-sm">Ir a</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { tab: 'kanban', label: 'Tablero de operación', icon: Car },
            { tab: 'pos', label: 'Punto de venta', icon: DollarSign },
            { tab: 'cash', label: 'Control de caja', icon: CheckCircle2 }
          ].map(({ tab, label, icon: Icon }) => (
            <button key={tab} onClick={() => navigate(tab)}
              className="p-3 bg-surface-2 hover:bg-surface-3 border border-line-strong text-body font-bold rounded-xl text-xs flex items-center justify-between transition-all">
              <span className="flex items-center gap-2.5"><Icon className="w-4 h-4 text-brand" />{label}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ))}
        </div>
      </section>

      <p className="text-xs text-faint flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        Los importes del periodo excluyen comprobantes anulados y notas de crédito.
        {loading && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
      </p>
    </div>
  );
};
