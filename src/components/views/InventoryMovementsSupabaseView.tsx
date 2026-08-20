import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchInventoryMovementPage, InventoryMovement, InventoryMovementKind
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  FilterChips, ReadOnlyNotice
} from '../common/DataViewShell';
import { ExportButton } from '../common/ExportButton';
import { movementsExport } from '../../lib/exportSpecs';

const PAGE_SIZE = 25;

type KindFilter = InventoryMovementKind | 'all';
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'venta', label: 'Ventas' },
  { id: 'devolucion', label: 'Devoluciones' },
  { id: 'ajuste', label: 'Ajustes' },
  { id: 'entrada', label: 'Entradas' },
  { id: 'compra', label: 'Compras' },
  { id: 'consumo', label: 'Consumos' },
  { id: 'merma', label: 'Mermas' }
];

const KIND_STYLE: Record<InventoryMovementKind, string> = {
  entrada: 'bg-success/20 text-success',
  compra: 'bg-success/20 text-success',
  venta: 'bg-brand/20 text-brand-hi',
  devolucion: 'bg-info/20 text-info',
  consumo: 'bg-brand/20 text-brand-2',
  ajuste: 'bg-warning/20 text-warning',
  merma: 'bg-danger/20 text-danger',
  transferencia: 'bg-surface-3/20 text-body'
};

const KIND_LABEL: Record<InventoryMovementKind, string> = {
  entrada: 'Entrada', compra: 'Compra', venta: 'Venta', devolucion: 'Devolución',
  consumo: 'Consumo', ajuste: 'Ajuste', merma: 'Merma', transferencia: 'Transferencia'
};

/**
 * Kardex: el historial de cada unidad que entró o salió del inventario.
 *
 * Cada fila la escribió el servidor al procesar una venta, devolución, ajuste,
 * compra o consumo. Aquí no se edita nada: es el registro que explica por qué
 * la existencia es la que es.
 */
export const InventoryMovementsSupabaseView: React.FC = () => {
  const { phase } = useAuth();
  const [kind, setKind] = useState<KindFilter>('all');

  const q = usePagedQuery<InventoryMovement>({
    fetcher: (page, size, search) => fetchInventoryMovementPage(page, size, search, kind),
    pageSize: PAGE_SIZE,
    deps: [kind],
    enabled: phase === 'ready'
  });

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Movimientos de inventario" subtitle="Kardex por producto" />
        <ReadOnlyNotice>
          El kardex registra los movimientos reales del servidor: está disponible al
          conectar la base de datos.
        </ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar el kardex" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Movimientos de inventario"
        subtitle="Cada cambio de existencia con su clase, motivo y documento"
        actions={<ExportButton {...movementsExport()} />}
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBox id="mov-search" label="Buscar por producto" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por nombre o código del producto…" />
        <FilterChips options={KIND_FILTERS} value={kind} onChange={setKind} />
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <caption className="sr-only">Movimientos de inventario</caption>
            <TableHeader>
              <TableRow className="border-b border-line text-muted bg-canvas/50">
                <TableHead scope="col" className="p-3 font-semibold">FECHA</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">PRODUCTO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">CLASE</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">CAMBIO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">EXISTENCIA</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">MOTIVO / DOCUMENTO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.loading ? <SkeletonRows cols={6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={6}>
                    {q.searchInput || kind !== 'all'
                      ? 'Ningún movimiento coincide con el filtro.'
                      : 'Todavía no hay movimientos: aparecerán con la primera venta, compra o ajuste.'}
                  </EmptyRow>
                ) : q.rows.map(m => (
                  <TableRow key={m.id} className="hover:bg-surface-2/40">
                    <TableCell className="p-3 text-muted whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString('es-DO', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </TableCell>
                    <TableCell className="p-3">
                      <div className="font-bold text-strong">{m.products?.name ?? '—'}</div>
                      <div className="text-xs text-faint">{m.products?.code}</div>
                    </TableCell>
                    <TableCell className="p-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-xs ${KIND_STYLE[m.kind]}`}>
                        {KIND_LABEL[m.kind]}
                      </span>
                    </TableCell>
                    <TableCell className={`p-3 text-right font-extrabold tabular-nums whitespace-nowrap ${
                      m.qty_change > 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {m.qty_change > 0
                        ? <><ArrowUpRight className="w-3.5 h-3.5 inline mr-0.5" />+{m.qty_change}</>
                        : <><ArrowDownRight className="w-3.5 h-3.5 inline mr-0.5" />{m.qty_change}</>}
                      {' '}{m.products?.unit}
                    </TableCell>
                    <TableCell className="p-3 text-right text-body tabular-nums whitespace-nowrap">
                      {m.qty_before} → <strong className="text-strong">{m.qty_after}</strong>
                    </TableCell>
                    <TableCell className="p-3 text-muted">
                      {m.reason
                        ?? (m.invoice_id ? 'Comprobante vinculado'
                        : m.work_order_id ? 'Orden de servicio vinculada' : '—')}
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
  );
};
