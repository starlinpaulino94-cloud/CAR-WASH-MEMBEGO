import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, UserCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, bpsToPercent } from '../../lib/money';
import {
  fetchTeam, fetchCommissionSummary, fetchBranches, createEmployee,
  Profile, CommissionSummary, Branch, UserRole
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, StatCard, FilterChips, ReadOnlyNotice, InlineAlert
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

type RangeId = 'month' | 'week' | 'all';

const ROLE_OPTIONS: { id: UserRole; label: string }[] = [
  { id: 'cajero', label: 'Cajero' },
  { id: 'operario', label: 'Operario (lavador)' },
  { id: 'recepcionista', label: 'Recepcionista' },
  { id: 'supervisor', label: 'Supervisor' },
  { id: 'contador', label: 'Contador' },
  { id: 'administrador', label: 'Administrador' }
];

const emptyEmployeeForm = {
  fullName: '', email: '', password: '', role: 'cajero' as UserRole,
  branchId: '', phone: '', commission: ''
};

const RANGES: { id: RangeId; label: string }[] = [
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'all', label: 'Últimos 12 meses' }
];

function bounds(id: RangeId): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(now);
  if (id === 'week') return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to };
  if (id === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  return { from: iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())), to };
}

/**
 * Equipo y comisiones.
 *
 * Las comisiones son datos de nómina: RLS solo las muestra al mando y a cada
 * operario las suyas. Esta vista respeta lo mismo — un operario ve su fila y
 * nada más.
 */
export const TeamSupabaseView: React.FC = () => {
  const { company, branch, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const seesAll = can(profile, 'viewAllCommissions');
  const canManageStaff = can(profile, 'manageStaff');

  const [range, setRange] = useState<RangeId>('month');
  const [team, setTeam] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Map<string, CommissionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyEmployeeForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const period = useMemo(() => bounds(range), [range]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [people, commissions] = await Promise.all([
        fetchTeam(),
        fetchCommissionSummary(period.from, period.to)
      ]);
      setTeam(people);
      setSummary(commissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el equipo');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (canManageStaff) fetchBranches().then(setBranches).catch(() => { /* no bloquea la vista */ });
  }, [canManageStaff]);

  const openCreate = () => {
    setForm({ ...emptyEmployeeForm, branchId: branch?.id ?? '' });
    setCreateError(null);
    setShowCreate(true);
  };

  const submitCreate = async () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.password) {
      setCreateError('Nombre, correo y contraseña son obligatorios.'); return;
    }
    if (form.password.length < 6) { setCreateError('La contraseña debe tener al menos 6 caracteres.'); return; }
    const commissionPct = form.commission.trim() ? Number(form.commission) : null;
    if (commissionPct !== null && (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100)) {
      setCreateError('La comisión debe estar entre 0 y 100 %.'); return;
    }
    setCreateBusy(true); setCreateError(null);
    try {
      const created = await createEmployee({
        email: form.email.trim(), password: form.password, fullName: form.fullName,
        role: form.role, branchId: form.branchId || null,
        phone: form.phone.trim() || null,
        commissionBps: commissionPct !== null ? Math.round(commissionPct * 100) : null
      });
      setShowCreate(false);
      setNotice(`${created.full_name} dado de alta como ${created.role}. Ya puede iniciar sesión con su correo y contraseña.`);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo dar de alta al empleado');
    } finally {
      setCreateBusy(false);
    }
  };

  const totals = useMemo(() => {
    let total = 0, unpaid = 0;
    for (const s of summary.values()) { total += s.totalCents; unpaid += s.unpaidCents; }
    return { total, unpaid };
  }, [summary]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} title="No se pudo cargar el equipo" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Equipo y comisiones"
        subtitle="Personal de la sucursal y comisiones generadas al entregar"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChips options={RANGES} value={range} onChange={setRange} />
            {canManageStaff && (
              <button onClick={openCreate}
                className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl">
                <Plus className="w-4 h-4" /> Nuevo empleado
              </button>
            )}
          </div>
        }
      />

      {notice && (
        <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>
      )}

      {!seesAll && (
        <ReadOnlyNotice>
          Su rol solo permite ver sus propias comisiones. Las de sus compañeros están
          restringidas por la base de datos, no solo por esta pantalla.
        </ReadOnlyNotice>
      )}

      {seesAll && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Comisiones del periodo" value={formatCents(totals.total, symbol)} tone="text-brand" />
          <StatCard label="Pendientes de pago" value={formatCents(totals.unpaid, symbol)}
            tone={totals.unpaid > 0 ? 'text-warning' : 'text-faint'} />
          <StatCard label="Personal activo" value={String(team.filter(t => t.is_active).length)} />
        </div>
      )}

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Personal y comisiones</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">PERSONA</th>
                <th scope="col" className="p-3 font-semibold">ROL</th>
                <th scope="col" className="p-3 font-semibold text-right">TASA</th>
                <th scope="col" className="p-3 font-semibold text-right">SERVICIOS</th>
                <th scope="col" className="p-3 font-semibold text-right">COMISIÓN</th>
                <th scope="col" className="p-3 font-semibold text-right">POR PAGAR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} aria-hidden="true">
                    <td colSpan={6} className="p-3"><div className="h-5 bg-surface-2/60 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : team.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center text-faint italic">
                  No hay personal registrado.
                </td></tr>
              ) : team.map(person => {
                const s = summary.get(person.id);
                return (
                  <tr key={person.id} className={`hover:bg-surface-2/40 ${person.is_active ? '' : 'opacity-50'}`}>
                    <td className="p-3">
                      <div className="font-bold text-strong">{person.full_name || person.email}</div>
                      <div className="text-xs text-faint">{person.email}</div>
                    </td>
                    <td className="p-3">
                      <span className="bg-brand-soft text-brand-hi font-bold px-2 py-0.5 rounded text-xs uppercase">
                        {person.role ?? 'sin rol'}
                      </span>
                      {!person.is_active && <span className="ml-1 text-xs text-faint">inactivo</span>}
                    </td>
                    <td className="p-3 text-right text-success font-bold">
                      {person.commission_bps ? bpsToPercent(person.commission_bps) : '—'}
                    </td>
                    <td className="p-3 text-right text-body tabular-nums">{s?.count ?? 0}</td>
                    <td className="p-3 text-right font-bold text-brand-hi whitespace-nowrap">
                      {formatCents(s?.totalCents ?? 0, symbol)}
                    </td>
                    <td className={`p-3 text-right font-bold whitespace-nowrap ${
                      (s?.unpaidCents ?? 0) > 0 ? 'text-warning' : 'text-faint'
                    }`}>
                      {formatCents(s?.unpaidCents ?? 0, symbol)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-faint flex items-center gap-1.5">
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        Las comisiones se generan al entregar el vehículo, repartiendo cada servicio entre
        los operarios asignados con la tasa de cada uno.
      </p>

      {showCreate && (
        <FormModal
          title="Nuevo empleado"
          submitLabel="Dar de alta"
          busy={createBusy}
          error={createError}
          onSubmit={() => void submitCreate()}
          onClose={() => setShowCreate(false)}
          onDismissError={() => setCreateError(null)}
        >
          <div className="flex items-start gap-2 p-3 bg-surface-2/50 border border-line-strong rounded-xl text-xs text-body">
            <UserCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-brand" />
            <span>
              Se crea el acceso del empleado (correo y contraseña) y su rol dentro de tu
              empresa. Podrá iniciar sesión de inmediato con esos datos.
            </span>
          </div>

          <Field label="Nombre completo *" htmlFor="emp-name">
            <input id="emp-name" className={textInputClass} value={form.fullName} autoFocus
              onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
              placeholder="María Pérez" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Correo *" htmlFor="emp-email" hint="Con esto inicia sesión.">
              <input id="emp-email" type="email" className={textInputClass} value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="maria@correo.com" />
            </Field>
            <Field label="Contraseña *" htmlFor="emp-pass" hint="Mínimo 6 caracteres.">
              <input id="emp-pass" type="text" className={textInputClass} value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="clave temporal" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol" htmlFor="emp-role">
              <select id="emp-role" className={textInputClass} value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}>
                {ROLE_OPTIONS.map(r => (
                  <option key={r.id} value={r.id} className="bg-surface">{r.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Sucursal" htmlFor="emp-branch">
              <select id="emp-branch" className={textInputClass} value={form.branchId}
                onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}>
                <option value="" className="bg-surface">Sin asignar</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id} className="bg-surface">{b.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono" htmlFor="emp-phone">
              <input id="emp-phone" className={textInputClass} value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="809-555-0000" />
            </Field>
            <Field label="Comisión (%)" htmlFor="emp-com" hint="Para lavadores; opcional.">
              <input id="emp-com" type="number" min={0} max={100} step="0.5" className={textInputClass} value={form.commission}
                onChange={e => setForm(f => ({ ...f, commission: e.target.value }))}
                placeholder="0" />
            </Field>
          </div>
        </FormModal>
      )}
    </div>
  );
};
