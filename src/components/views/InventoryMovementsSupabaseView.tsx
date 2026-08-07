import React, { useState } from 'react';
import { History, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchInventoryMovementPage, InventoryMovement, InventoryMovementKind
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  FilterChips, ReadOnlyNotice
} from '../common/DataViewShell';

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
  entrada: 'bg-emerald-500/20 text-emerald-300',
  compra: 'bg-emerald-500/20 text-emerald-300',
  venta: 'bg-indigo-500/20 text-indigo-300',
  devolucion: 'bg-sky-500/20 text-sky-300',
  consumo: 'bg-purple-500/20 text-purple-300',
  ajuste: 'bg-amber-500/20 text-amber-300',
  merma: 'bg-rose-500/20 text-rose-300',
  transferencia: 'bg-slate-500/20 text-slate-300'
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
        <ViewHeader icon={<History className="w-5 h-5 text-indigo-400" />}
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
        icon={<History className="w-5 h-5 text-indigo-400" />}
        title="Movimientos de inventario"
        subtitle="Cada cambio de existencia con su clase, motivo y documento"
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBox id="mov-search" label="Buscar por producto" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por nombre o código del producto…" />
        <FilterChips options={KIND_FILTERS} value={kind} onChange={setKind} />
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Movimientos de inventario</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">FECHA</th>
                <th scope="col" className="p-3 font-semibold">PRODUCTO</th>
                <th scope="col" className="p-3 font-semibold">CLASE</th>
                <th scope="col" className="p-3 font-semibold text-right">CAMBIO</th>
                <th scope="col" className="p-3 font-semibold text-right">EXISTENCIA</th>
                <th scope="col" className="p-3 font-semibold">MOTIVO / DOCUMENTO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {q.loading ? <SkeletonRows cols={6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={6}>
                    {q.searchInput || kind !== 'all'
                      ? 'Ningún movimiento coincide con el filtro.'
                      : 'Todavía no hay movimientos: aparecerán con la primera venta, compra o ajuste.'}
                  </EmptyRow>
                ) : q.rows.map(m => (
                  <tr key={m.id} className="hover:bg-slate-800/40">
                    <td className="p-3 text-slate-400 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString('es-DO', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-white">{m.products?.name ?? '—'}</div>
                      <div className="text-xs text-slate-500">{m.products?.code}</div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-xs ${KIND_STYLE[m.kind]}`}>
                        {KIND_LABEL[m.kind]}
                      </span>
                    </td>
                    <td className={`p-3 text-right font-extrabold tabular-nums whitespace-nowrap ${
                      m.qty_change > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {m.qty_change > 0
                        ? <><ArrowUpRight className="w-3.5 h-3.5 inline mr-0.5" />+{m.qty_change}</>
                        : <><ArrowDownRight className="w-3.5 h-3.5 inline mr-0.5" />{m.qty_change}</>}
                      {' '}{m.products?.unit}
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums whitespace-nowrap">
                      {m.qty_before} → <strong className="text-white">{m.qty_after}</strong>
                    </td>
                    <td className="p-3 text-slate-400">
                      {m.reason
                        ?? (m.invoice_id ? 'Comprobante vinculado'
                        : m.work_order_id ? 'Orden de servicio vinculada' : '—')}
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
  );
};
