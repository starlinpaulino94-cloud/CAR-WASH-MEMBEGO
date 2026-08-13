import React from 'react';
import { Car } from 'lucide-react';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchVehiclePage, VehicleRow } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow
} from '../common/DataViewShell';
import { ExportButton } from '../common/ExportButton';
import { ImportButton } from '../common/ImportModal';
import { vehiclesExport } from '../../lib/exportSpecs';
import { can } from '../../lib/auth';
import { useAuth } from '../../context/AuthContext';

const PAGE_SIZE = 25;

/** Flotilla registrada. Paginado y búsqueda en el servidor. */
export const VehiclesSupabaseView: React.FC = () => {
  const { profile } = useAuth();
  const q = usePagedQuery<VehicleRow>({ fetcher: fetchVehiclePage, pageSize: PAGE_SIZE });

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar la flotilla" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Car className="w-5 h-5 text-brand" />}
        title="Flotilla y vehículos"
        subtitle="Historial por placa, modelo y categoría"
        actions={
          <>
            <ExportButton {...vehiclesExport()} />
            {can(profile, 'importData') && (
              <ImportButton entity="vehiculos" onImported={q.reload} />
            )}
          </>
        }
      />

      <SearchBox id="veh-search" label="Buscar vehículo" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por placa, marca o modelo…" />

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Vehículos registrados</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">PLACA</th>
                <th scope="col" className="p-3 font-semibold">MARCA Y MODELO</th>
                <th scope="col" className="p-3 font-semibold">COLOR</th>
                <th scope="col" className="p-3 font-semibold">CATEGORÍA</th>
                <th scope="col" className="p-3 font-semibold">PROPIETARIO</th>
                <th scope="col" className="p-3 font-semibold">ÚLTIMA VISITA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {q.loading ? <SkeletonRows cols={6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={6}>
                    {q.searchInput ? 'Ningún vehículo coincide con la búsqueda.' : 'Todavía no hay vehículos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(v => (
                  <tr key={v.id} className="hover:bg-surface-2/40">
                    <td className="p-3">
                      <span className="font-bold text-strong bg-canvas/60 px-2 py-0.5 rounded border border-line">
                        {v.plate}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-body">
                      {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                      {v.year ? ` (${v.year})` : ''}
                    </td>
                    <td className="p-3 text-muted">{v.color || '—'}</td>
                    <td className="p-3">
                      <span className="bg-brand-soft text-brand-hi font-bold px-2 py-0.5 rounded text-xs uppercase">
                        {v.category}
                      </span>
                    </td>
                    <td className="p-3 text-body">{v.customer_name ?? 'Visitante'}</td>
                    <td className="p-3 text-muted whitespace-nowrap">
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
