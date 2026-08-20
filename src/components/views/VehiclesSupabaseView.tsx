import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchVehiclePage, updateVehicle, eliminarFila, VehicleRow, VehicleCategory
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow, InlineAlert
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { ConfirmarEliminar } from '../common/ConfirmarEliminar';
import { ExportButton } from '../common/ExportButton';
import { ImportButton } from '../common/ImportModal';
import { vehiclesExport } from '../../lib/exportSpecs';
import { can } from '../../lib/auth';
import { useAuth } from '../../context/AuthContext';

const PAGE_SIZE = 25;

const CATEGORIAS: VehicleCategory[] =
  ['sedan', 'suv', 'jeep', 'pickup', 'van', 'truck', 'motorcycle', 'special'];

/** Flotilla registrada. Paginado y búsqueda en el servidor. */
export const VehiclesSupabaseView: React.FC = () => {
  const { profile } = useAuth();
  const q = usePagedQuery<VehicleRow>({ fetcher: fetchVehiclePage, pageSize: PAGE_SIZE });

  /*
   * Editar y eliminar. Esta vista era de solo lectura: una placa mal tecleada
   * —«O» por «0», que pasa todos los días— no se podía arreglar, y el carro
   * duplicado se quedaba en el listado para siempre.
   *
   * La categoría se puede corregir y no es un detalle: de ella depende la tarifa
   * que se le cobra y si su membresía de Membego cubre el lavado.
   */
  const puedeBorrar = can(profile, 'deleteRecords');
  const [editando, setEditando] = useState<VehicleRow | null>(null);
  const [borrando, setBorrando] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState({ plate: '', make: '', model: '', color: '', year: '', category: 'sedan' as VehicleCategory });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const abrirEdicion = (v: VehicleRow) => {
    setForm({
      plate: v.plate, make: v.make ?? '', model: v.model ?? '',
      color: v.color ?? '', year: v.year ? String(v.year) : '',
      category: v.category
    });
    setFormError(null);
    setEditando(v);
  };

  const guardar = async () => {
    if (!editando) return;
    if (!form.plate.trim()) { setFormError('La placa es obligatoria.'); return; }
    const anio = form.year.trim() ? Number(form.year) : null;
    if (anio !== null && (!Number.isInteger(anio) || anio < 1900 || anio > 2100)) {
      setFormError('El año no parece válido.'); return;
    }
    setBusy(true);
    setFormError(null);
    try {
      // La placa la normaliza el servidor (un trigger desde 0002), así que aquí
      // se manda tal cual se escribió: normalizarla dos veces con reglas
      // distintas es como se acaba con dos formas de la misma matrícula.
      await updateVehicle(editando.id, {
        plate: form.plate.trim(), make: form.make.trim() || null,
        model: form.model.trim() || null, color: form.color.trim() || null,
        year: anio, category: form.category
      });
      setEditando(null);
      setNotice('Vehículo actualizado.');
      q.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar la flotilla" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
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

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

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
                <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {q.loading ? <SkeletonRows cols={7} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={7}>
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
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => abrirEdicion(v)} aria-label={`Editar ${v.plate}`}
                          >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {puedeBorrar && (
                          <Button variant="ghost" size="icon-sm" className="text-muted hover:text-danger" onClick={() => setBorrando(v)} aria-label={`Eliminar ${v.plate}`}
                            >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {editando && (
        <FormModal
          title={`Editar — ${editando.plate}`}
          submitLabel="Guardar cambios"
          busy={busy}
          error={formError}
          onSubmit={() => void guardar()}
          onClose={() => setEditando(null)}
          onDismissError={() => setFormError(null)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Placa" htmlFor="ed-veh-plate">
              <input id="ed-veh-plate" className={textInputClass} value={form.plate} autoFocus
                onChange={e => setForm(f => ({ ...f, plate: e.target.value }))} />
            </Field>
            <Field label="Categoría" htmlFor="ed-veh-cat"
              hint="De ella depende la tarifa y si su membresía cubre el lavado.">
              <select id="ed-veh-cat" className={textInputClass} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as VehicleCategory }))}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca" htmlFor="ed-veh-make">
              <input id="ed-veh-make" className={textInputClass} value={form.make}
                onChange={e => setForm(f => ({ ...f, make: e.target.value }))} />
            </Field>
            <Field label="Modelo" htmlFor="ed-veh-model">
              <input id="ed-veh-model" className={textInputClass} value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Color" htmlFor="ed-veh-color">
              <input id="ed-veh-color" className={textInputClass} value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
            </Field>
            <Field label="Año" htmlFor="ed-veh-year">
              <input id="ed-veh-year" type="number" className={textInputClass} value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
            </Field>
          </div>
        </FormModal>
      )}

      {borrando && (
        <ConfirmarEliminar
          queEs="el vehículo"
          nombre={borrando.plate}
          onEliminar={() => eliminarFila('vehicles', borrando.id)}
          onCerrar={() => setBorrando(null)}
          onHecho={() => q.reload()}
        />
      )}
    </div>
  );
};
