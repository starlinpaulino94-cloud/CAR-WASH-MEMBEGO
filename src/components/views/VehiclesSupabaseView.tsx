import React from 'react';
import { Car } from 'lucide-react';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchVehiclePage, VehicleRow } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow
} from '../common/DataViewShell';

const PAGE_SIZE = 25;

/** Flotilla registrada. Paginado y búsqueda en el servidor. */
export const VehiclesSupabaseView: React.FC = () => {
  const q = usePagedQuery<VehicleRow>({ fetcher: fetchVehiclePage, pageSize: PAGE_SIZE });

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar la flotilla" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Car className="w-5 h-5 text-indigo-400" />}
        title="Flotilla y vehículos"
        subtitle="Historial por placa, modelo y categoría"
      />

      <SearchBox id="veh-search" label="Buscar vehículo" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por placa, marca o modelo…" />

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Vehículos registrados</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">PLACA</th>
                <th scope="col" className="p-3 font-semibold">MARCA Y MODELO</th>
                <th scope="col" className="p-3 font-semibold">COLOR</th>
                <th scope="col" className="p-3 font-semibold">CATEGORÍA</th>
                <th scope="col" className="p-3 font-semibold">PROPIETARIO</th>
                <th scope="col" className="p-3 font-semibold">ÚLTIMA VISITA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {q.loading ? <SkeletonRows cols={6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={6}>
                    {q.searchInput ? 'Ningún vehículo coincide con la búsqueda.' : 'Todavía no hay vehículos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(v => (
                  <tr key={v.id} className="hover:bg-slate-800/40">
                    <td className="p-3">
                      <span className="font-bold text-white bg-slate-950/60 px-2 py-0.5 rounded border border-slate-800">
                        {v.plate}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-slate-200">
                      {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                      {v.year ? ` (${v.year})` : ''}
                    </td>
                    <td className="p-3 text-slate-400">{v.color || '—'}</td>
                    <td className="p-3">
                      <span className="bg-indigo-950 text-indigo-300 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                        {v.category}
                      </span>
                    </td>
                    <td className="p-3 text-slate-300">{v.customer_name ?? 'Visitante'}</td>
                    <td className="p-3 text-slate-400 whitespace-nowrap">
                      {v.last_visit_at ? new Date(v.last_visit_at).toLocaleDateString('es-DO') : '—'}
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
