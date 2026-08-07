import React, { useState } from 'react';
import { Truck, Plus, Pencil } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchSupplierPage, createSupplier, updateSupplier, Supplier
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const PAGE_SIZE = 25;

const emptyForm = { name: '', taxId: '', phone: '', email: '', notes: '' };

/**
 * Directorio de proveedores.
 *
 * Es la contraparte de las compras: a quién se le compra y cómo contactarlo.
 * Lo administran los roles de compras (supervisor o superior y contador);
 * nadie se borra: se desactiva, para no perder el historial de compras.
 */
export const SuppliersSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const canManage = ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const q = usePagedQuery<Supplier>({
    fetcher: fetchSupplierPage,
    pageSize: PAGE_SIZE,
    enabled: phase === 'ready'
  });

  const [modal, setModal] = useState<'create' | Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openCreate = () => { setForm(emptyForm); setError(null); setModal('create'); };
  const openEdit = (s: Supplier) => {
    setForm({ name: s.name, taxId: s.tax_id ?? '', phone: s.phone ?? '', email: s.email ?? '', notes: s.notes ?? '' });
    setError(null); setModal(s);
  };

  const submit = async () => {
    if (!company || busy) return;
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true); setError(null);
    try {
      if (modal === 'create') {
        await createSupplier({
          companyId: company.id, name: form.name, taxId: form.taxId,
          phone: form.phone, email: form.email, notes: form.notes
        });
      } else if (modal) {
        await updateSupplier(modal.id, {
          name: form.name.trim(), tax_id: form.taxId.trim() || null,
          phone: form.phone.trim() || null, email: form.email.trim() || null,
          notes: form.notes.trim() || null
        });
      }
      setModal(null);
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el proveedor');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: Supplier) => {
    try {
      await updateSupplier(s.id, { is_active: !s.is_active });
      setNotice(s.is_active ? `${s.name} quedó inactivo.` : `${s.name} quedó activo.`);
      q.reload();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<Truck className="w-5 h-5 text-indigo-400" />}
          title="Proveedores" subtitle="Directorio de suplidores" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar los proveedores" />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        icon={<Truck className="w-5 h-5 text-indigo-400" />}
        title="Proveedores"
        subtitle="A quién se compra: contacto, RNC e historial"
        actions={canManage ? (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nuevo proveedor
          </button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar el directorio, no administrarlo.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !modal && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <SearchBox id="sup-search" label="Buscar proveedor" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por nombre, teléfono o RNC…" />

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Proveedores</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">PROVEEDOR</th>
                <th scope="col" className="p-3 font-semibold">RNC</th>
                <th scope="col" className="p-3 font-semibold">CONTACTO</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {q.loading ? <SkeletonRows cols={canManage ? 5 : 4} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={canManage ? 5 : 4}>
                    {q.searchInput ? 'Ningún proveedor coincide.' : 'Todavía no hay proveedores registrados.'}
                  </EmptyRow>
                ) : q.rows.map(s => (
                  <tr key={s.id} className="hover:bg-slate-800/40">
                    <td className="p-3">
                      <div className="font-bold text-white">{s.name}</div>
                      {s.notes && <div className="text-xs text-slate-500">{s.notes}</div>}
                    </td>
                    <td className="p-3 text-slate-400">{s.tax_id ?? '—'}</td>
                    <td className="p-3 text-slate-400">
                      <div>{s.phone ?? '—'}</div>
                      {s.email && <div className="text-xs text-slate-500">{s.email}</div>}
                    </td>
                    <td className="p-3">
                      {s.is_active
                        ? <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-xs">Activo</span>
                        : <span className="bg-slate-700/50 text-slate-400 font-bold px-2 py-0.5 rounded text-xs">Inactivo</span>}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(s)} aria-label={`Editar ${s.name}`}
                          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => void toggleActive(s)}
                          className="ml-1 px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                          {s.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {modal && (
        <FormModal
          title={modal === 'create' ? 'Nuevo proveedor' : `Editar — ${modal.name}`}
          submitLabel={modal === 'create' ? 'Crear proveedor' : 'Guardar cambios'}
          busy={busy}
          error={error}
          onSubmit={() => void submit()}
          onClose={() => setModal(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Nombre *" htmlFor="sup-name">
            <input id="sup-name" className={textInputClass} value={form.name} autoFocus
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Química del Caribe SRL" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RNC" htmlFor="sup-rnc">
              <input id="sup-rnc" className={textInputClass} value={form.taxId}
                onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} />
            </Field>
            <Field label="Teléfono" htmlFor="sup-phone">
              <input id="sup-phone" className={textInputClass} value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </Field>
          </div>
          <Field label="Correo" htmlFor="sup-email">
            <input id="sup-email" type="email" className={textInputClass} value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Notas" htmlFor="sup-notes">
            <input id="sup-notes" className={textInputClass} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Condiciones, días de entrega…" />
          </Field>
        </FormModal>
      )}
    </div>
  );
};
