import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { FiltroFechas } from '../common/FiltroFechas';
import { BotonImprimir, ReporteImprimible } from '../common/ReporteImprimible';
import { SeleccionFecha, rangoDeFechas, describirRango } from '../../lib/rangosFecha';
import { toCsv, downloadCsv, stampedName } from '../../lib/csv';
import { Button } from '../ui/button';
import { Download } from 'lucide-react';
import {
  fetchAuditPage, fetchDashboardMetrics, fetchTeam,
  AuditLog, DashboardMetrics, Profile
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  StatCard, FilterChips, ReadOnlyNotice
} from '../common/DataViewShell';

const PAGE_SIZE = 25;

/** Módulos conocidos, para filtrar por tipo de dato. La búsqueda de texto cubre
 *  cualquier otro que no esté en esta lista. */
const ENTIDADES: { id: string; label: string }[] = [
  { id: '', label: 'Todos los módulos' },
  { id: 'invoice', label: 'Facturas' },
  { id: 'credit_note', label: 'Notas de crédito' },
  { id: 'product', label: 'Productos' },
  { id: 'service', label: 'Servicios' },
  { id: 'customer', label: 'Clientes' },
  { id: 'vehicle', label: 'Vehículos' },
  { id: 'work_order', label: 'Órdenes' },
  { id: 'fleet', label: 'Flotillas' },
  { id: 'promotion', label: 'Promociones' },
  { id: 'membership', label: 'Membresías' },
  { id: 'expense', label: 'Gastos' },
  { id: 'cash_session', label: 'Caja' },
  { id: 'profile', label: 'Usuarios' },
  { id: 'company', label: 'Empresa' }
];

const selectClass =
  'w-full bg-canvas border border-line rounded-lg p-2 text-strong text-xs focus:outline-none focus:border-brand';


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

  /**
   * UN periodo para toda la pantalla. Antes los KPI tenían sus chips y la
   * bitácora sus propios «desde/hasta»: las tarjetas podían decir un mes
   * mientras la tabla enseñaba otro, que es exactamente la clase de pantalla
   * en la que no se puede confiar.
   */
  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const rango = rangoDeFechas(sel);
  const period = useMemo(() => ({
    from: new Date(`${rango.desde}T00:00:00`),
    to: new Date(new Date(`${rango.hasta}T00:00:00`).getTime() + 24 * 3600 * 1000)
  }), [rango.desde, rango.hasta]);

  // Filtros de la bitácora (el periodo es el mismo de arriba).
  const [fEntidad, setFEntidad] = useState('');
  const [fActor, setFActor] = useState('');
  const [team, setTeam] = useState<Profile[]>([]);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    if (!canSee) return;
    fetchTeam().then(setTeam).catch(() => { /* el filtro de usuario es accesorio */ });
  }, [canSee]);

  const filtrosAuditoria = useCallback((search: string) => ({
    search,
    entity: fEntidad || undefined,
    actorId: fActor || undefined,
    from: new Date(`${rango.desde}T00:00:00`).toISOString(),
    to: new Date(`${rango.hasta}T23:59:59.999`).toISOString()
  }), [fEntidad, fActor, rango.desde, rango.hasta]);

  const fetcher = useCallback(
    (page: number, size: number, search: string) =>
      fetchAuditPage(page, size, filtrosAuditoria(search)),
    [filtrosAuditoria]
  );

  const q = usePagedQuery<AuditLog>({
    fetcher, pageSize: PAGE_SIZE, enabled: canSee,
    deps: [fEntidad, fActor, rango.desde, rango.hasta]
  });

  const hayFiltros = Boolean(fEntidad || fActor || q.searchInput);
  const limpiarFiltros = () => {
    setFEntidad(''); setFActor(''); q.setSearchInput('');
  };

  /**
   * Exporta LO FILTRADO: mismos filtros que la tabla, recorriendo el servidor
   * por páginas. Tope de 10.000 eventos con aviso; para más, acotar el rango
   * — que aquí SÍ se puede acotar.
   */
  const exportarBitacora = async () => {
    setExportando(true);
    try {
      const todas: AuditLog[] = [];
      const TAM = 500;
      for (let pagina = 0; pagina < 20; pagina++) {
        const { rows } = await fetchAuditPage(pagina, TAM, filtrosAuditoria(q.searchInput));
        todas.push(...rows);
        if (rows.length < TAM) break;
      }
      downloadCsv(stampedName('auditoria'), toCsv<AuditLog>([
        { header: 'cuando', value: l => new Date(l.occurred_at).toLocaleString('es-DO') },
        { header: 'accion', value: l => l.action },
        { header: 'modulo', value: l => ENTIDADES.find(x => x.id === l.entity)?.label ?? l.entity },
        { header: 'detalle', value: l => l.details },
        { header: 'quien', value: l => l.actor_name || '' },
        { header: 'rol', value: l => l.actor_role ?? '' }
      ], todas));
    } finally {
      setExportando(false);
    }
  };

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
        <ViewHeader
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
        title="Reportes y auditoría"
        subtitle={`${branch?.name} · registro de solo inserción`}
        actions={
          <>
            <BotonImprimir disabled={q.loading} />
            <Button variant="outline" size="sm" onClick={() => void exportarBitacora()}
              disabled={q.loading || exportando}>
              {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Exportar filtrado
            </Button>
          </>
        }
      />

      <FiltroFechas valor={sel} onCambiar={setSel} disabled={q.loading} />

      {metricsError ? (
        <div role="alert" className="text-xs text-danger">{metricsError}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Facturado en el periodo" tone="text-success"
            value={metrics ? formatCents(metrics.sales_cents, symbol) : '—'}
            hint={metrics ? `${metrics.invoice_count} comprobantes` : undefined} />
          <StatCard label="Anulado" tone={metrics && metrics.annulled_cents > 0 ? 'text-danger' : 'text-faint'}
            value={metrics ? formatCents(metrics.annulled_cents, symbol) : '—'} />
          <StatCard label="Vehículos recibidos" tone="text-brand"
            value={metrics ? String(metrics.arrived) : '—'}
            hint={metrics ? `${metrics.delivered} entregados` : undefined} />
          <StatCard label="Eventos auditados" tone="text-warning"
            value={q.loading ? '—' : String(q.total)} hint="en el periodo y filtros elegidos" />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-success" />
          <h3 className="font-bold text-strong text-sm">Bitácora de auditoría</h3>
        </div>
        <SearchBox id="audit-search" label="Buscar en la bitácora" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por acción, detalle o usuario…" />

        {/* Filtros: módulo, usuario y rango de fechas. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="f-entidad" className="text-xs font-semibold text-muted uppercase">Módulo</label>
            <select id="f-entidad" className={selectClass} value={fEntidad}
              onChange={e => setFEntidad(e.target.value)}>
              {ENTIDADES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="f-actor" className="text-xs font-semibold text-muted uppercase">Usuario</label>
            <select id="f-actor" className={selectClass} value={fActor}
              onChange={e => setFActor(e.target.value)}>
              <option value="">Todos los usuarios</option>
              {team.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
        </div>
        {hayFiltros && (
          <button onClick={limpiarFiltros}
            className="text-xs font-semibold text-brand hover:underline">
            Limpiar filtros
          </button>
        )}

        <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <caption className="sr-only">Eventos auditados</caption>
              <TableHeader>
                <TableRow className="border-b border-line text-muted bg-canvas/50">
                  <TableHead scope="col" className="p-3 font-semibold">CUÁNDO</TableHead>
                  <TableHead scope="col" className="p-3 font-semibold">ACCIÓN</TableHead>
                  <TableHead scope="col" className="p-3 font-semibold">DETALLE</TableHead>
                  <TableHead scope="col" className="p-3 font-semibold">QUIÉN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.loading ? <SkeletonRows cols={4} />
                  : q.rows.length === 0 ? (
                    <EmptyRow cols={4}>
                      {hayFiltros ? 'Ningún evento coincide con los filtros.' : 'Todavía no hay eventos registrados.'}
                    </EmptyRow>
                  ) : q.rows.map(log => (
                    <TableRow key={log.id} className="hover:bg-surface-2/40 align-top">
                      <TableCell className="p-3 text-faint whitespace-nowrap">
                        {new Date(log.occurred_at).toLocaleString('es-DO')}
                      </TableCell>
                      <TableCell className="p-3">
                        <span className="font-bold text-brand-hi whitespace-nowrap">{log.action}</span>
                        <div className="text-xs text-faint">
                          {ENTIDADES.find(x => x.id === log.entity)?.label ?? log.entity}
                        </div>
                      </TableCell>
                      <TableCell className="p-3 text-body">{log.details}</TableCell>
                      <TableCell className="p-3 text-muted whitespace-nowrap">
                        {log.actor_name || '—'}
                        {log.actor_role && <div className="text-xs text-faint uppercase">{log.actor_role}</div>}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
            pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
        </div>
      </div>

      <p className="text-xs text-faint flex items-center gap-1.5">
        {q.loading && <Loader2 className="w-3 h-3 animate-spin" />}
        La bitácora no admite modificación ni borrado, garantizado por permisos, políticas y
        trigger. El autor y la hora los sella el servidor.
      </p>

      {/* En papel va la página visible de la bitácora: para el histórico
          completo está «Exportar filtrado». */}
      <ReporteImprimible
        empresa={company?.trade_name}
        titulo="Bitácora de auditoría"
        periodo={describirRango(sel)}
        filtros={[
          ...(fEntidad ? [`Módulo: ${ENTIDADES.find(x => x.id === fEntidad)?.label ?? fEntidad}`] : []),
          ...(fActor ? [`Usuario: ${team.find(t => t.id === fActor)?.full_name ?? ''}`] : []),
          `Eventos: ${q.total} (se imprimen ${q.rows.length})`
        ]}
        generadoPor={profile?.full_name}
      >
        <table>
          <thead><tr><th>Cuándo</th><th>Acción</th><th>Detalle</th><th>Quién</th></tr></thead>
          <tbody>
            {q.rows.map(l => (
              <tr key={l.id}>
                <td>{new Date(l.occurred_at).toLocaleString('es-DO')}</td>
                <td>{l.action}</td>
                <td>{l.details}</td>
                <td>{l.actor_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReporteImprimible>
    </div>
  );
};
