import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import {
  fetchReporteVentas, fetchFacturasDelReporte, ReporteVentas, FiltrosReporte, FacturaReporte
} from '../../data/reportsRepository';
import { fetchActiveBranches, Branch } from '../../data/branchRepository';
import { fetchTeam, fetchServicesWithPrices, Profile, ServiceWithPrices } from '../../data/adminRepository';
import { ViewHeader, ErrorState, ReadOnlyNotice } from '../common/DataViewShell';
import { FiltroFechas } from '../common/FiltroFechas';
import { FiltrosReporteBar, OpcionSelect } from '../common/FiltrosReporte';
import { RejillaKpi, Kpi } from '../common/RejillaKpi';
import { TablaDatos } from '../common/TablaDatos';
import { PanelDetalle } from '../common/PanelDetalle';
import { ReporteImprimible, BotonImprimir } from '../common/ReporteImprimible';
import { SeleccionFecha, rangoDeFechas, describirRango } from '../../lib/rangosFecha';
import { useCategoriasServicio } from '../../hooks/useCategoriasServicio';
import { etiquetaMetodo } from '../../lib/etiquetas';

/**
 * Reporte de ventas.
 *
 * Sobre sales_report: siete filtros combinables (sucursal, cajero, lavador,
 * servicio, categoría, método, estado) que refrescan TODA la pantalla —KPIs,
 * tablas, exportación e impresión salen del mismo universo—, y drill-down:
 * cada KPI de ventas y cada fila de las tablas abre las facturas que lo forman.
 */

const ROLES_MOSTRADOR = ['cajero', 'supervisor', 'administrador', 'propietario', 'superadmin'];
const ROLES_LAVADOR = ['operario', 'supervisor'];

export const SalesReportSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'viewAuditLog');
  const { categorias } = useCategoriasServicio();

  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'hoy' });
  const [filtros, setFiltros] = useState<FiltrosReporte>({});
  const [branches, setBranches] = useState<Branch[]>([]);
  const [team, setTeam] = useState<Profile[]>([]);
  const [servicios, setServicios] = useState<ServiceWithPrices[]>([]);
  const [report, setReport] = useState<ReporteVentas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drill-down: las facturas del universo, o de una fila concreta.
  const [drill, setDrill] = useState<{ titulo: string; filtros: FiltrosReporte } | null>(null);
  const [facturas, setFacturas] = useState<FacturaReporte[]>([]);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillCargando, setDrillCargando] = useState(false);

  useEffect(() => {
    if (phase !== 'ready' || !allowed) return;
    fetchActiveBranches().then(setBranches).catch(() => setBranches([]));
    fetchTeam().then(setTeam).catch(() => setTeam([]));
    fetchServicesWithPrices().then(setServicios).catch(() => setServicios([]));
  }, [phase, allowed]);

  const { desde, hasta } = rangoDeFechas(sel);

  const reload = useCallback(() => {
    if (phase !== 'ready' || !allowed) return;
    setLoading(true); setError(null);
    fetchReporteVentas(desde, hasta, filtros)
      .then(setReport)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte'))
      .finally(() => setLoading(false));
  }, [phase, allowed, desde, hasta, filtros]);

  useEffect(() => { reload(); }, [reload]);

  const abrirDrill = useCallback((titulo: string, extra: FiltrosReporte) => {
    const combinado = { ...filtros, ...extra };
    setDrill({ titulo, filtros: combinado });
    setDrillCargando(true);
    fetchFacturasDelReporte(desde, hasta, combinado, 0, 100)
      .then(r => { setFacturas(r.rows); setDrillTotal(r.total); })
      .catch(() => { setFacturas([]); setDrillTotal(0); })
      .finally(() => setDrillCargando(false));
  }, [filtros, desde, hasta]);

  const cajeros: OpcionSelect[] = useMemo(
    () => team.filter(p => p.role && ROLES_MOSTRADOR.includes(p.role)).map(p => ({ id: p.id, label: p.full_name })), [team]);
  const lavadores: OpcionSelect[] = useMemo(
    () => team.filter(p => p.role && ROLES_LAVADOR.includes(p.role)).map(p => ({ id: p.id, label: p.full_name })), [team]);
  const opcServicios: OpcionSelect[] = useMemo(
    () => servicios.map(s => ({ id: s.id, label: s.name })), [servicios]);
  const opcCategorias: OpcionSelect[] = useMemo(
    () => categorias.map(c => ({ id: c.code, label: c.label })), [categorias]);

  const money = (c: number) => formatCents(c, symbol);

  const kpis: Kpi[] = useMemo(() => report ? [
    { id: 'ventas', label: 'Ventas del periodo', valor: report.kpis.ventas_cents, moneda: true, tono: 'ok',
      hint: `${report.kpis.facturas} facturas`, onClick: () => abrirDrill('Facturas del periodo', {}) },
    { id: 'ticket', label: 'Ticket promedio', valor: report.kpis.ticket_promedio_cents, moneda: true },
    { id: 'vehiculos', label: 'Vehículos atendidos', valor: report.kpis.vehiculos,
      hint: `${report.servicios_vendidos} servicios` },
    { id: 'anulado', label: 'Anulado', valor: report.kpis.anulado_cents, moneda: true,
      tono: report.kpis.anulado_cents > 0 ? 'bad' : undefined,
      hint: `${report.kpis.anuladas} facturas`,
      onClick: report.kpis.anuladas > 0 ? () => abrirDrill('Facturas anuladas', { status: 'anulada' }) : undefined },
    { id: 'descuentos', label: 'Descuentos', valor: report.kpis.descuento_cents, moneda: true, tono: 'warn' },
    { id: 'membego', label: 'Beneficio Membego', valor: report.kpis.membego_cents, moneda: true, tono: 'brand' },
    { id: 'itbis', label: 'ITBIS', valor: report.kpis.impuesto_cents, moneda: true },
    { id: 'clientes', label: 'Clientes con ficha', valor: report.kpis.clientes }
  ] : [], [report, abrirDrill]);

  const filtrosLegibles = useMemo(() => {
    const l: string[] = [];
    if (filtros.branch_id) l.push(`Sucursal: ${branches.find(b => b.id === filtros.branch_id)?.name ?? ''}`);
    if (filtros.cashier_id) l.push(`Cajero: ${team.find(t => t.id === filtros.cashier_id)?.full_name ?? ''}`);
    if (filtros.washer_id) l.push(`Lavador: ${team.find(t => t.id === filtros.washer_id)?.full_name ?? ''}`);
    if (filtros.service_id) l.push(`Servicio: ${servicios.find(s => s.id === filtros.service_id)?.name ?? ''}`);
    if (filtros.service_category) l.push(`Categoría: ${categorias.find(c => c.code === filtros.service_category)?.label ?? ''}`);
    if (filtros.payment_method) l.push(`Método: ${etiquetaMetodo(filtros.payment_method)}`);
    return l;
  }, [filtros, branches, team, servicios, categorias]);

  function exportCsv() {
    if (!report) return;
    const m = (c: number) => (c / 100).toFixed(2);
    const L: string[] = [`Reporte de ventas;${desde} a ${hasta}`];
    filtrosLegibles.forEach(f => L.push(`${f};`));
    L.push('', 'RESUMEN;');
    L.push(`Ventas;${m(report.kpis.ventas_cents)};${report.kpis.facturas} facturas`);
    L.push(`Ticket promedio;${m(report.kpis.ticket_promedio_cents)}`);
    L.push(`Anulado;${m(report.kpis.anulado_cents)};${report.kpis.anuladas} facturas`);
    L.push('', 'POR SERVICIO;Cant.;Importe');
    report.por_servicio.forEach(s => L.push(`${s.name};${s.qty};${m(s.sales_cents)}`));
    L.push('', 'POR MÉTODO;Importe');
    report.por_metodo.forEach(x => L.push(`${etiquetaMetodo(x.method)};${m(x.amount_cents)}`));
    L.push('', 'POR CAJERO;Facturas;Importe');
    report.por_cajero.forEach(x => L.push(`${x.name};${x.invoice_count};${m(x.sales_cents)}`));
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ventas-${desde}-a-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (phase !== 'ready' || !allowed) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Ventas" subtitle="Reporte comercial del periodo" />
        <ReadOnlyNotice>
          {phase !== 'ready' ? 'Disponible al conectar la base de datos.'
            : 'Su rol no permite consultar los reportes gerenciales.'}
        </ReadOnlyNotice>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={reload} title="No se pudo cargar el reporte" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Ventas"
        subtitle="Qué se vendió, quién lo cobró y cómo se pagó"
        actions={
          <>
            <BotonImprimir disabled={!report || loading} />
            <Button variant="outline" size="sm" disabled={!report || loading} onClick={exportCsv}>
              <Download className="w-4 h-4" /> Exportar filtrado
            </Button>
          </>
        }
      />

      <div className="space-y-3 bg-surface/60 border border-line rounded-2xl p-4">
        <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
        <FiltrosReporteBar
          valor={filtros} onCambiar={setFiltros} disabled={loading}
          sucursales={branches.map(b => ({ id: b.id, label: b.name }))}
          cajeros={cajeros} lavadores={lavadores}
          servicios={opcServicios} categorias={opcCategorias}
          conMetodo conEstado
        />
      </div>

      <RejillaKpi kpis={kpis} cargando={loading || !report} symbol={symbol} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Ventas por servicio</h3>
          <TablaDatos
            columnas={[
              { id: 'n', label: 'Servicio', render: s => <span className="font-medium text-strong">{s.name}</span> },
              { id: 'q', label: 'Cant.', numerica: true, render: s => s.qty },
              { id: 'i', label: 'Importe', numerica: true, render: s => money(s.sales_cents) }
            ]}
            filas={report?.por_servicio ?? []} clave={s => s.service_id ?? s.name}
            cargando={loading} vacio="Sin ventas de servicios en el periodo."
            onFila={s => s.service_id && abrirDrill(`Ventas de ${s.name}`, { service_id: s.service_id })}
            etiqueta="Ventas por servicio" />
        </section>
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Ventas por producto</h3>
          <TablaDatos
            columnas={[
              { id: 'n', label: 'Producto', render: s => <span className="font-medium text-strong">{s.name}</span> },
              { id: 'q', label: 'Cant.', numerica: true, render: s => s.qty },
              { id: 'i', label: 'Importe', numerica: true, render: s => money(s.sales_cents) }
            ]}
            filas={report?.por_producto ?? []} clave={s => s.product_id ?? s.name}
            cargando={loading} vacio="Sin ventas de productos en el periodo."
            etiqueta="Ventas por producto" />
        </section>
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Cobros por método</h3>
          <TablaDatos
            columnas={[
              { id: 'm', label: 'Método', render: x => etiquetaMetodo(x.method) },
              { id: 'i', label: 'Importe', numerica: true, render: x => money(x.amount_cents) }
            ]}
            filas={report?.por_metodo ?? []} clave={x => x.method}
            cargando={loading} vacio="Sin cobros registrados."
            onFila={x => abrirDrill(`Cobros en ${etiquetaMetodo(x.method)}`, { payment_method: x.method })}
            etiqueta="Cobros por método" />
        </section>
        <section className="space-y-2">
          <h3 className="font-bold text-strong text-sm">Ventas por cajero</h3>
          <TablaDatos
            columnas={[
              { id: 'n', label: 'Cajero', render: x => <span className="font-medium text-strong">{x.name}</span> },
              { id: 'f', label: 'Facturas', numerica: true, render: x => x.invoice_count },
              { id: 'i', label: 'Importe', numerica: true, render: x => money(x.sales_cents) }
            ]}
            filas={report?.por_cajero ?? []} clave={x => x.profile_id}
            cargando={loading} vacio="Sin ventas en el periodo."
            onFila={x => abrirDrill(`Ventas de ${x.name}`, { cashier_id: x.profile_id })}
            etiqueta="Ventas por cajero" />
        </section>
      </div>

      <PanelDetalle
        abierto={!!drill}
        titulo={drill?.titulo ?? ''}
        subtitulo={`${describirRango(sel)} · ${drillTotal} ${drillTotal === 1 ? 'factura' : 'facturas'}`}
        onCerrar={() => setDrill(null)}
      >
        {drillCargando ? (
          <p className="text-xs text-faint flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Cargando facturas…</p>
        ) : (
          <TablaDatos
            columnas={[
              { id: 'num', label: 'Factura', render: (f: FacturaReporte) => (
                <span className={f.is_annulled ? 'line-through text-faint' : 'font-medium text-strong'}>{f.invoice_number}</span>) },
              { id: 'fecha', label: 'Fecha', ocultarEnMovil: true,
                render: f => new Date(f.created_at).toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' }) },
              { id: 'cli', label: 'Cliente', render: f => f.customer_name },
              { id: 'placa', label: 'Placa', ocultarEnMovil: true, render: f => f.vehicle_plate || '—' },
              { id: 'tot', label: 'Total', numerica: true, render: f => money(f.total_cents) }
            ]}
            filas={facturas} clave={f => f.id}
            vacio="Ninguna factura en este universo." etiqueta="Facturas del reporte" />
        )}
      </PanelDetalle>

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
              ['Ventas', money(report.kpis.ventas_cents), `${report.kpis.facturas} facturas`],
              ['Ticket promedio', money(report.kpis.ticket_promedio_cents), ''],
              ['Vehículos', String(report.kpis.vehiculos), `${report.servicios_vendidos} servicios`],
              ['Anulado', money(report.kpis.anulado_cents), `${report.kpis.anuladas} facturas`]
            ].map(([l, v, h]) => (
              <div key={l as string}>
                <div className="pr-kpi-label">{l}</div><div className="pr-kpi-valor">{v}</div>
                {h && <div className="pr-kpi-label">{h}</div>}
              </div>
            ))}
          </div>
          <h3>Ventas por servicio</h3>
          <table><thead><tr><th>Servicio</th><th className="num">Cant.</th><th className="num">Importe</th></tr></thead>
            <tbody>{report.por_servicio.map(s => (
              <tr key={s.name}><td>{s.name}</td><td className="num">{s.qty}</td><td className="num">{money(s.sales_cents)}</td></tr>))}</tbody></table>
          <h3>Cobros por método</h3>
          <table><thead><tr><th>Método</th><th className="num">Importe</th></tr></thead>
            <tbody>{report.por_metodo.map(x => (
              <tr key={x.method}><td>{etiquetaMetodo(x.method)}</td><td className="num">{money(x.amount_cents)}</td></tr>))}</tbody></table>
          <h3>Ventas por cajero</h3>
          <table><thead><tr><th>Cajero</th><th className="num">Facturas</th><th className="num">Importe</th></tr></thead>
            <tbody>{report.por_cajero.map(x => (
              <tr key={x.profile_id}><td>{x.name}</td><td className="num">{x.invoice_count}</td><td className="num">{money(x.sales_cents)}</td></tr>))}</tbody></table>
          <p className="pr-nota">Ventas de facturas vigentes; las anuladas se cuentan aparte y las notas de crédito quedan fuera. Cobros según los movimientos de caja del periodo.</p>
        </ReporteImprimible>
      )}
    </div>
  );
};
