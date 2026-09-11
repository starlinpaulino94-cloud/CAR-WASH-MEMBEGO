import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { fetchManagementReport, ManagementReport } from '../../data/adminRepository';
import { fetchActiveBranches, Branch } from '../../data/branchRepository';
import { ViewHeader, ErrorState, ReadOnlyNotice } from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { RejillaKpi, Kpi } from '../common/RejillaKpi';
import { TablaDatos, ColumnaDatos } from '../common/TablaDatos';
import { ReporteImprimible, BotonImprimir } from '../common/ReporteImprimible';
import { SeleccionFecha, rangoDeFechas, describirRango } from '../../lib/rangosFecha';
import { etiquetaMetodo, etiquetaGasto } from '../../lib/etiquetas';

/**
 * Reporte de ventas del periodo.
 *
 * Primera vista sobre la infraestructura transversal: filtro de fechas con
 * fecha exacta, rango, mes y año (con el corte de día en hora LOCAL: la
 * versión anterior mostraba cero ventas a partir de las 8 de la noche porque
 * «hoy» ya era mañana en UTC), filtro de sucursal (la RPC lo aceptaba desde
 * el principio y la pantalla nunca lo mandó), impresión en Carta y export
 * que lleva exactamente el universo filtrado.
 *
 * Los datos siguen saliendo de management_report: esta fase cambia la
 * experiencia, no la fuente. Los filtros por lavador, servicio y método
 * llegan con las RPC nuevas de la siguiente fase.
 */

function exportCsv(r: ManagementReport, symbol: string, cabecera: string[]) {
  const money = (c: number) => (c / 100).toFixed(2);
  const lines: string[] = [];
  lines.push(`Reporte de ventas;${r.from} a ${r.to};(${symbol})`);
  cabecera.forEach(c => lines.push(`${c};;`));
  lines.push('');
  lines.push('RESUMEN;;');
  lines.push(`Ventas;${money(r.sales.total_cents)};${r.sales.invoice_count} facturas`);
  lines.push(`Ticket promedio;${money(r.sales.avg_ticket_cents)};`);
  lines.push(`Anulado;${money(r.sales.annulled_cents)};${r.sales.annulled_count} facturas`);
  lines.push(`Gastos;${money(r.expenses_total_cents)};`);
  lines.push(`Insumos consumidos;${money(r.consumption_cents)};`);
  lines.push('');
  lines.push('COBROS POR MÉTODO;;');
  r.by_method.forEach(m => lines.push(`${etiquetaMetodo(m.method)};${money(m.amount_cents)};`));
  lines.push('');
  lines.push('VENTAS POR SERVICIO;Cantidad;Importe');
  r.by_service.forEach(s => lines.push(`${s.name};${s.qty};${money(s.sales_cents)}`));
  lines.push('');
  lines.push('VENTAS POR PRODUCTO;Cantidad;Importe');
  r.by_product.forEach(p => lines.push(`${p.name};${p.qty};${money(p.sales_cents)}`));
  lines.push('');
  lines.push('VENTAS POR CAJERO;Facturas;Importe');
  r.by_employee.forEach(e => lines.push(`${e.name};${e.invoice_count};${money(e.sales_cents)}`));
  lines.push('');
  lines.push('GASTOS POR CATEGORÍA;;');
  r.expenses.forEach(e => lines.push(`${etiquetaGasto(e.category)};${money(e.amount_cents)};`));

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ventas-${r.from}-a-${r.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface FilaNombre { name: string; qty?: number; invoice_count?: number; sales_cents?: number; amount_cents?: number }

export const SalesReportSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'viewAuditLog');

  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'hoy' });
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

  const sucursalNombre = branchId ? branches.find(b => b.id === branchId)?.name ?? null : null;
  const filtrosLegibles = sucursalNombre ? [`Sucursal: ${sucursalNombre}`] : [];

  const kpis: Kpi[] = useMemo(() => report ? [
    { id: 'ventas', label: 'Ventas del periodo', valor: report.sales.total_cents, moneda: true,
      tono: 'ok', hint: `${report.sales.invoice_count} facturas` },
    { id: 'ticket', label: 'Ticket promedio', valor: report.sales.avg_ticket_cents, moneda: true },
    { id: 'anulado', label: 'Anulado', valor: report.sales.annulled_cents, moneda: true,
      tono: report.sales.annulled_cents > 0 ? 'bad' : undefined,
      hint: `${report.sales.annulled_count} facturas` },
    { id: 'gastos', label: 'Gastos del periodo', valor: report.expenses_total_cents, moneda: true, tono: 'warn' }
  ] : [], [report]);

  const colCant: ColumnaDatos<FilaNombre>[] = [
    { id: 'n', label: 'Servicio', render: f => <span className="font-medium text-strong">{f.name}</span> },
    { id: 'q', label: 'Cant.', numerica: true, render: f => f.qty ?? '' },
    { id: 'i', label: 'Importe', numerica: true, render: f => formatCents(f.sales_cents ?? 0, symbol) }
  ];

  if (phase !== 'ready' || !allowed) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Ventas" subtitle="Reporte comercial del periodo" />
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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Ventas"
        subtitle="Qué se vendió, quién lo cobró y cómo se pagó"
        actions={
          <>
            <BotonImprimir disabled={!report || loading} />
            <Button variant="outline" size="sm" disabled={!report || loading}
              onClick={() => report && exportCsv(report, symbol, [
                `Periodo;${describirRango(sel)}`,
                ...(sucursalNombre ? [`Sucursal;${sucursalNombre}`] : [])
              ])}>
              <Download className="w-4 h-4" /> Exportar filtrado
            </Button>
          </>
        }
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

      <RejillaKpi kpis={kpis} cargando={loading || !report} symbol={symbol} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Ventas por servicio</h3>
          <TablaDatos columnas={colCant} filas={(report?.by_service ?? []) as FilaNombre[]}
            clave={f => f.name} cargando={loading} vacio="Sin ventas de servicios en el periodo."
            etiqueta="Ventas por servicio" />
        </section>
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Ventas por producto</h3>
          <TablaDatos columnas={[{ ...colCant[0], label: 'Producto' }, colCant[1], colCant[2]]}
            filas={(report?.by_product ?? []) as FilaNombre[]}
            clave={f => f.name} cargando={loading} vacio="Sin ventas de productos en el periodo."
            etiqueta="Ventas por producto" />
        </section>
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Cobros por método (caja)</h3>
          <TablaDatos
            columnas={[
              { id: 'm', label: 'Método', render: (f: FilaNombre) => etiquetaMetodo(f.name) },
              { id: 'i', label: 'Importe', numerica: true, render: f => money(f.amount_cents ?? 0) }
            ]}
            filas={(report?.by_method ?? []).map(m => ({ name: m.method, amount_cents: m.amount_cents }))}
            clave={f => f.name} cargando={loading} vacio="Sin cobros registrados en caja."
            etiqueta="Cobros por método" />
        </section>
        <section className="space-y-2">
          {/* «Cajero», no «empleado»: mide quién FACTURÓ. Quién lavó se mide en
              Personal → Comisiones, y confundir los dos es cobrarle la venta
              del mostrador al que estaba con la espuma. */}
          <h3 className="font-bold text-strong text-sm">Ventas por cajero</h3>
          <TablaDatos
            columnas={[
              { id: 'n', label: 'Cajero', render: (f: FilaNombre) => <span className="font-medium text-strong">{f.name}</span> },
              { id: 'f', label: 'Facturas', numerica: true, render: f => f.invoice_count ?? 0 },
              { id: 'i', label: 'Importe', numerica: true, render: f => money(f.sales_cents ?? 0) }
            ]}
            filas={(report?.by_employee ?? []) as FilaNombre[]}
            clave={f => f.name} cargando={loading} vacio="Sin ventas en el periodo."
            etiqueta="Ventas por cajero" />
        </section>
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Gastos por categoría</h3>
          <TablaDatos
            columnas={[
              { id: 'c', label: 'Categoría', render: (f: FilaNombre) => etiquetaGasto(f.name) },
              { id: 'i', label: 'Importe', numerica: true, render: f => money(f.amount_cents ?? 0) }
            ]}
            filas={(report?.expenses ?? []).map(e => ({ name: e.category, amount_cents: e.amount_cents }))}
            clave={f => f.name} cargando={loading} vacio="Sin gastos en el periodo."
            etiqueta="Gastos por categoría" />
        </section>
      </div>

      {/* Lo que sale por la impresora: mismos datos, papel Carta. */}
      {report && (
        <ReporteImprimible
          empresa={company?.trade_name}
          titulo="Reporte de ventas"
          periodo={describirRango(sel)}
          filtros={filtrosLegibles}
          generadoPor={profile?.full_name}
        >
          <div className="pr-kpis">
            {[
              ['Ventas', money(report.sales.total_cents), `${report.sales.invoice_count} facturas`],
              ['Ticket promedio', money(report.sales.avg_ticket_cents), ''],
              ['Anulado', money(report.sales.annulled_cents), `${report.sales.annulled_count} facturas`],
              ['Gastos', money(report.expenses_total_cents), '']
            ].map(([l, v, h]) => (
              <div key={l as string}>
                <div className="pr-kpi-label">{l}</div>
                <div className="pr-kpi-valor">{v}</div>
                {h && <div className="pr-kpi-label">{h}</div>}
              </div>
            ))}
          </div>

          <h3>Ventas por servicio</h3>
          <table>
            <thead><tr><th>Servicio</th><th className="num">Cant.</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {report.by_service.map(s => (
                <tr key={s.name}><td>{s.name}</td><td className="num">{s.qty}</td><td className="num">{money(s.sales_cents)}</td></tr>
              ))}
            </tbody>
          </table>

          {report.by_product.length > 0 && (
            <>
              <h3>Ventas por producto</h3>
              <table>
                <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Importe</th></tr></thead>
                <tbody>
                  {report.by_product.map(p => (
                    <tr key={p.name}><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{money(p.sales_cents)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Cobros por método</h3>
          <table>
            <thead><tr><th>Método</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {report.by_method.map(m => (
                <tr key={m.method}><td>{etiquetaMetodo(m.method)}</td><td className="num">{money(m.amount_cents)}</td></tr>
              ))}
            </tbody>
          </table>

          <h3>Ventas por cajero</h3>
          <table>
            <thead><tr><th>Cajero</th><th className="num">Facturas</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {report.by_employee.map(e => (
                <tr key={e.name}><td>{e.name}</td><td className="num">{e.invoice_count}</td><td className="num">{money(e.sales_cents)}</td></tr>
              ))}
            </tbody>
          </table>

          {report.expenses.length > 0 && (
            <>
              <h3>Gastos por categoría</h3>
              <table>
                <thead><tr><th>Categoría</th><th className="num">Importe</th></tr></thead>
                <tbody>
                  {report.expenses.map(e => (
                    <tr key={e.category}><td>{etiquetaGasto(e.category)}</td><td className="num">{money(e.amount_cents)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <p className="pr-nota">
            Ventas de facturas vigentes; las anuladas se reportan aparte y las
            notas de crédito quedan fuera del universo. Cobros según los
            movimientos de caja del periodo.
          </p>
        </ReporteImprimible>
      )}
    </div>
  );
};
