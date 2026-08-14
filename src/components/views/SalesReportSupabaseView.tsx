import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { fetchManagementReport, ManagementReport } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, StatCard, FilterChips, ReadOnlyNotice
} from '../common/DataViewShell';
import { RangeId, RANGES, rangeDates } from '../../lib/reportRanges';


const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  pago_movil: 'Pago móvil', membego_beneficio: 'Beneficio Membego',
  credito: 'Crédito', cortesia: 'Cortesía', mixto: 'Mixto'
};

const CATEGORY_LABEL: Record<string, string> = {
  quimicos_insumos: 'Químicos e insumos', servicios_publicos: 'Servicios públicos',
  mantenimiento_equipos: 'Mantenimiento', nomina_extras: 'Nómina y extras', varios: 'Varios'
};

/** Descarga el reporte como CSV (secciones apiladas), para Excel. */
function exportCsv(r: ManagementReport, symbol: string) {
  const money = (c: number) => (c / 100).toFixed(2);
  const lines: string[] = [];
  lines.push(`Reporte gerencial;${r.from} a ${r.to};(${symbol})`);
  lines.push('');
  lines.push('RESUMEN;;');
  lines.push(`Ventas;${money(r.sales.total_cents)};${r.sales.invoice_count} facturas`);
  lines.push(`Ticket promedio;${money(r.sales.avg_ticket_cents)};`);
  lines.push(`Anulado;${money(r.sales.annulled_cents)};${r.sales.annulled_count} facturas`);
  lines.push(`Gastos;${money(r.expenses_total_cents)};`);
  lines.push(`Insumos consumidos;${money(r.consumption_cents)};`);
  lines.push(`Compras del periodo;${money(r.purchases_total_cents)};`);
  lines.push(`Cuentas por pagar (vigentes);${money(r.payables_cents)};`);
  lines.push(`Utilidad bruta estimada;${money(r.gross_profit_cents)};`);
  lines.push('');
  lines.push('COBROS POR MÉTODO;;');
  r.by_method.forEach(m => lines.push(`${METHOD_LABEL[m.method] ?? m.method};${money(m.amount_cents)};`));
  lines.push('');
  lines.push('VENTAS POR SERVICIO;Cantidad;Importe');
  r.by_service.forEach(s => lines.push(`${s.name};${s.qty};${money(s.sales_cents)}`));
  lines.push('');
  lines.push('VENTAS POR PRODUCTO;Cantidad;Importe');
  r.by_product.forEach(p => lines.push(`${p.name};${p.qty};${money(p.sales_cents)}`));
  lines.push('');
  lines.push('VENTAS POR EMPLEADO;Facturas;Importe');
  r.by_employee.forEach(e => lines.push(`${e.name};${e.invoice_count};${money(e.sales_cents)}`));
  lines.push('');
  lines.push('GASTOS POR CATEGORÍA;;');
  r.expenses.forEach(e => lines.push(`${CATEGORY_LABEL[e.category] ?? e.category};${money(e.amount_cents)};`));
  lines.push('');
  lines.push('MARGEN POR SERVICIO;Ventas;Insumos;Margen');
  r.service_margin.forEach(s =>
    lines.push(`${s.name};${money(s.sales_cents)};${money(s.consumption_cents)};${money(s.margin_cents)}`));

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${r.from}-a-${r.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const SimpleTable: React.FC<{
  title: string;
  headers: string[];
  rows: (string | number)[][];
  empty: string;
}> = ({ title, headers, rows, empty }) => (
  <section className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
    <h3 className="font-bold text-strong text-sm px-4 pt-4">{title}</h3>
    <div className="overflow-x-auto p-2">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted text-xs">
            {headers.map((h, i) => (
              <th key={h} className={`p-2 font-semibold ${i > 0 ? 'text-right' : ''}`}>{h.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="p-4 text-center text-faint italic">{empty}</td></tr>
          ) : rows.map((cells, ri) => (
            <tr key={ri}>
              {cells.map((c, ci) => (
                <td key={ci} className={`p-2 ${ci === 0 ? 'text-strong font-medium' : 'text-right text-body tabular-nums whitespace-nowrap'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

/**
 * Reporte de ventas del periodo.
 *
 * Separado a propósito de la Auditoría (que es un registro técnico): esto es
 * el tablero comercial. Todo sale de management_report, agregado por el
 * servidor dentro del tenant y con permiso de rol.
 */
export const SalesReportSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const allowed = can(profile, 'viewAuditLog');

  const [range, setRange] = useState<RangeId>('today');
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
        <ViewHeader
          title="Ventas" subtitle="Reporte comercial del periodo" />
        <ReadOnlyNotice>
          {phase !== 'ready'
            ? 'Disponible al conectar la base de datos.'
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
        subtitle="Qué se vendió, quién lo vendió y cómo se cobró"
        actions={report ? (
          <button onClick={() => exportCsv(report, symbol)}
            className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 text-strong font-bold text-xs rounded-xl">
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        ) : undefined}
      />

      <FilterChips options={RANGES} value={range} onChange={setRange} />

      {loading || !report ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-surface border border-line rounded-2xl animate-pulse" />
          ))}
          <div className="col-span-2 lg:col-span-4 flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-faint" />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Ventas del periodo" tone="text-success"
              value={formatCents(report.sales.total_cents, symbol)}
              hint={`${report.sales.invoice_count} facturas`} />
            <StatCard label="Ticket promedio"
              value={formatCents(report.sales.avg_ticket_cents, symbol)} />
            <StatCard label="Anulado" tone="text-danger"
              value={formatCents(report.sales.annulled_cents, symbol)}
              hint={`${report.sales.annulled_count} facturas`} />
            <StatCard label="Gastos del periodo" tone="text-warning"
              value={formatCents(report.expenses_total_cents, symbol)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SimpleTable
              title="Ventas por servicio"
              headers={['Servicio', 'Cant.', 'Importe']}
              rows={report.by_service.map(s => [s.name, s.qty, formatCents(s.sales_cents, symbol)])}
              empty="Sin ventas de servicios en el periodo." />
            <SimpleTable
              title="Ventas por producto"
              headers={['Producto', 'Cant.', 'Importe']}
              rows={report.by_product.map(p => [p.name, p.qty, formatCents(p.sales_cents, symbol)])}
              empty="Sin ventas de productos en el periodo." />
            <SimpleTable
              title="Cobros por método (caja)"
              headers={['Método', 'Importe']}
              rows={report.by_method.map(m => [METHOD_LABEL[m.method] ?? m.method, formatCents(m.amount_cents, symbol)])}
              empty="Sin cobros registrados en caja." />
            <SimpleTable
              title="Ventas por empleado"
              headers={['Empleado', 'Facturas', 'Importe']}
              rows={report.by_employee.map(e => [e.name, e.invoice_count, formatCents(e.sales_cents, symbol)])}
              empty="Sin ventas en el periodo." />
            <SimpleTable
              title="Gastos por categoría"
              headers={['Categoría', 'Importe']}
              rows={report.expenses.map(e => [CATEGORY_LABEL[e.category] ?? e.category, formatCents(e.amount_cents, symbol)])}
              empty="Sin gastos en el periodo." />
          </div>
        </>
      )}
    </div>
  );
};
