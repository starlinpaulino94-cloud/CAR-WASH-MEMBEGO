import React, { useEffect, useState } from 'react';
import { Store, Plus, Star, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  fetchBranches, upsertBranch, setEmployeeBranch,
  Branch, BranchScope
} from '../../data/branchRepository';
import { fetchStaff, Profile } from '../../data/payrollRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow, HelpNote
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const emptyForm = { name: '', address: '', phone: '', isMain: false };

/**
 * Sucursales y alcance del personal.
 *
 * Dar de alta una sucursal es media función; la otra media es decidir quién la
 * ve. Mientras un empleado tenga alcance «todas», la separación no existe para
 * él: verá la caja y las órdenes de todos los locales, que es como funcionaba
 * el sistema entero antes de esta pantalla.
 */
export const BranchesSupabaseView: React.FC = () => {
  const { profile, phase } = useAuth();
  const canManage = ['propietario', 'administrador', 'superadmin'].includes(profile?.role ?? '');

  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = () => setNonce(n => n + 1);

  useEffect(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchBranches(), canManage ? fetchStaff() : Promise.resolve([])])
      .then(([b, s]) => { setBranches(b); setStaff(s); })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar las sucursales'))
      .finally(() => setLoading(false));
  }, [phase, canManage, nonce]);

  // --- Alta y edición
  const [modal, setModal] = useState<'create' | Branch | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openCreate = () => { setForm(emptyForm); setError(null); setModal('create'); };
  const openEdit = (b: Branch) => {
    setForm({ name: b.name, address: b.address ?? '', phone: b.phone ?? '', isMain: b.is_main });
    setError(null); setModal(b);
  };

  const submit = async () => {
    if (busy) return;
    if (!form.name.trim()) { setError('La sucursal necesita un nombre.'); return; }
    setBusy(true); setError(null);
    try {
      await upsertBranch({
        name: form.name,
        branchId: modal === 'create' ? null : modal?.id,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        isMain: form.isMain,
        isActive: modal === 'create' ? true : modal?.is_active
      });
      setModal(null);
      setNotice(`Sucursal ${form.name} guardada.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la sucursal');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (b: Branch) => {
    try {
      await upsertBranch({
        name: b.name, branchId: b.id, address: b.address, phone: b.phone,
        isMain: b.is_main, isActive: !b.is_active
      });
      setNotice(b.is_active ? `${b.name} quedó inactiva.` : `${b.name} quedó activa.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    }
  };

  // --- Alcance del personal
  const [scopeTarget, setScopeTarget] = useState<Profile | null>(null);
  const [scope, setScope] = useState<BranchScope>('sucursal');
  const [scopeBranch, setScopeBranch] = useState('');

  const openScope = (p: Profile) => {
    setScopeTarget(p);
    setScope(p.branch_scope);
    setScopeBranch(p.branch_id ?? branches.find(b => b.is_main)?.id ?? '');
    setError(null);
  };

  const saveScope = async () => {
    if (!scopeTarget || busy) return;
    if (scope === 'sucursal' && !scopeBranch) { setError('Indique la sucursal.'); return; }
    setBusy(true); setError(null);
    try {
      await setEmployeeBranch({
        profileId: scopeTarget.id,
        branchId: scopeBranch || null,
        scope
      });
      setScopeTarget(null);
      setNotice(scope === 'sucursal'
        ? `${scopeTarget.full_name} queda limitado a una sola sucursal.`
        : `${scopeTarget.full_name} ve todas las sucursales.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el alcance');
    } finally {
      setBusy(false);
    }
  };

  const branchName = (id: string | null) =>
    branches.find(b => b.id === id)?.name ?? '—';

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<Store className="w-5 h-5 text-brand" />}
          title="Sucursales" subtitle="Locales de la empresa y quién ve cada uno" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && branches.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={reload} title="No se pudieron cargar las sucursales" />;
  }

  const cols = canManage ? 5 : 4;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        icon={<Store className="w-5 h-5 text-brand" />}
        title="Sucursales"
        subtitle="Locales de la empresa y quién ve cada uno"
        actions={canManage ? (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nueva sucursal
          </button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite ver las sucursales, no administrarlas.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !modal && !scopeTarget && (
        <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>
      )}

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Sucursales</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">SUCURSAL</th>
                <th scope="col" className="p-3 font-semibold">DIRECCIÓN</th>
                <th scope="col" className="p-3 font-semibold">TELÉFONO</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? <SkeletonRows cols={cols} />
                : branches.length === 0 ? (
                  <EmptyRow cols={cols}>Todavía no hay sucursales registradas.</EmptyRow>
                ) : branches.map(b => (
                  <tr key={b.id} className="hover:bg-surface-2/40">
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 font-bold text-strong">
                        {b.name}
                        {b.is_main && <Star className="w-3.5 h-3.5 text-warning" aria-label="Principal" />}
                      </div>
                    </td>
                    <td className="p-3 text-muted">{b.address ?? '—'}</td>
                    <td className="p-3 text-muted">{b.phone ?? '—'}</td>
                    <td className="p-3">
                      {b.is_active
                        ? <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">Activa</span>
                        : <span className="bg-surface-3/50 text-muted font-bold px-2 py-0.5 rounded text-xs">Inactiva</span>}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(b)}
                          className="px-2 py-1 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body">
                          Editar
                        </button>
                        <button onClick={() => void toggleActive(b)}
                          className="ml-1 px-2 py-1 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body">
                          {b.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------------- Alcance del personal */}
      {canManage && (
        <section aria-label="Alcance del personal"
          className="bg-surface/80 border border-line rounded-2xl p-5 space-y-3">
          <header className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand" />
            <h2 className="text-base font-bold text-strong">Quién ve qué</h2>
          </header>
          <HelpNote summary="Qué cambia según el alcance">
            Con «todas», la separación no existe para esa persona: ve la caja y las
            órdenes de todos los locales. Al limitar a una sucursal, deja de ver —y de
            poder crear— nada fuera de ella. El catálogo y el directorio de clientes
            siguen siendo de la empresa: se buscan desde cualquier mostrador. Nadie
            puede cambiar su propio alcance, ni el propietario: es siempre una decisión
            sobre otra persona.
          </HelpNote>
          <ul className="divide-y divide-line/60">
            {staff.map(p => (
              <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-strong text-sm">{p.full_name}</div>
                  <div className="text-xs text-faint">
                    {p.branch_scope === 'todas'
                      ? 'Todas las sucursales'
                      : `Solo ${branchName(p.branch_id)}`}
                  </div>
                </div>
                {p.id !== profile?.id && (
                  <button onClick={() => openScope(p)}
                    className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body">
                    Cambiar alcance
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {modal && (
        <FormModal
          title={modal === 'create' ? 'Nueva sucursal' : `Editar — ${modal.name}`}
          submitLabel={modal === 'create' ? 'Crear sucursal' : 'Guardar cambios'}
          busy={busy}
          error={error}
          onSubmit={() => void submit()}
          onClose={() => setModal(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Nombre *" htmlFor="branch-name">
            <input id="branch-name" className={textInputClass} value={form.name} autoFocus
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Sucursal Autopista" />
          </Field>
          <Field label="Dirección" htmlFor="branch-address">
            <input id="branch-address" className={textInputClass} value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label="Teléfono" htmlFor="branch-phone">
            <input id="branch-phone" className={textInputClass} value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={form.isMain}
              onChange={e => setForm(f => ({ ...f, isMain: e.target.checked }))} />
            Es la sucursal principal
          </label>
          <p className="text-xs text-faint">
            Solo hay una principal: nombrar esta se la quita a la anterior. La
            principal no se puede desactivar.
          </p>
        </FormModal>
      )}

      {scopeTarget && (
        <FormModal
          title={`Alcance — ${scopeTarget.full_name}`}
          submitLabel="Guardar alcance"
          busy={busy}
          error={error}
          onSubmit={() => void saveScope()}
          onClose={() => setScopeTarget(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Qué puede ver" htmlFor="scope-kind">
            <select id="scope-kind" className={textInputClass} value={scope}
              onChange={e => setScope(e.target.value as BranchScope)}>
              <option value="sucursal">Solo una sucursal</option>
              <option value="todas">Todas las sucursales</option>
            </select>
          </Field>
          <Field label="Sucursal" htmlFor="scope-branch">
            <select id="scope-branch" className={textInputClass} value={scopeBranch}
              onChange={e => setScopeBranch(e.target.value)}>
              <option value="">Sin sucursal asignada</option>
              {branches.filter(b => b.is_active).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-faint">
            Con «todas» la sucursal sigue siendo la suya de trabajo, pero no limita
            lo que ve.
          </p>
        </FormModal>
      )}
    </div>
  );
};
