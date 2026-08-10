import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can, outranks } from '../../lib/auth';
import {
  fetchProfiles, updateProfileAccess, resetEmployeePassword, Profile, Role
} from '../../data/fiscalRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const ROLES: { id: Role; label: string; nota: string }[] = [
  { id: 'operario',      label: 'Operario',      nota: 'Lava. Ve sus comisiones y su turno.' },
  { id: 'recepcionista', label: 'Recepcionista', nota: 'Recibe vehículos y agenda citas.' },
  { id: 'cajero',        label: 'Cajero',        nota: 'Cobra y opera la caja.' },
  { id: 'contador',      label: 'Contador',      nota: 'Ve reportes, nómina y fiscal. No cobra.' },
  { id: 'supervisor',    label: 'Supervisor',    nota: 'Coordina el taller y anula facturas.' },
  { id: 'administrador', label: 'Administrador', nota: 'Todo salvo crear propietarios.' },
  { id: 'propietario',   label: 'Propietario',   nota: 'Sin techo. Solo otro propietario lo otorga.' }
];

/**
 * Usuarios y roles.
 *
 * El alta vive en Personal › Empleados —crear un usuario es crear credenciales—;
 * aquí se administra el acceso de quien ya existe: su rol, si sigue activo y el
 * reinicio de contraseña.
 *
 * Las reglas duras no están en esta pantalla sino en la base, desde 0007: nadie
 * cambia su propio rol —ni el propietario—, y para otorgar «propietario» hay que
 * serlo. Aquí solo se ocultan los botones que la base rechazaría.
 */
export const UsersSupabaseView: React.FC = () => {
  const { profile, phase } = useAuth();
  const canManage = can(profile, 'manageStaff');

  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    fetchProfiles()
      .then(setRows)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false));
  }, [phase, nonce]);

  const cambiarRol = async (p: Profile, role: Role) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await updateProfileAccess(p.id, { role });
      setNotice(`${p.full_name} ahora es ${ROLES.find(r => r.id === role)?.label}.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el rol');
    } finally {
      setBusy(false);
    }
  };

  const alternarActivo = async (p: Profile) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await updateProfileAccess(p.id, { is_active: !p.is_active });
      setNotice(p.is_active
        ? `${p.full_name} ya no puede entrar.`
        : `${p.full_name} vuelve a tener acceso.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    } finally {
      setBusy(false);
    }
  };

  // --- Reinicio de contraseña
  const [claveTarget, setClaveTarget] = useState<Profile | null>(null);
  const [clave, setClave] = useState('');

  const reiniciar = async () => {
    if (!claveTarget || busy) return;
    if (clave.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    setBusy(true); setError(null);
    try {
      await resetEmployeePassword(claveTarget.id, clave);
      setClaveTarget(null); setClave('');
      setNotice(`Contraseña de ${claveTarget.full_name} reiniciada. Dígasela en persona.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reiniciar la contraseña');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<ShieldCheck className="w-5 h-5 text-indigo-400" />}
          title="Usuarios y roles" subtitle="Quién entra y qué puede hacer" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudieron cargar los usuarios" />;
  }

  /** ¿Puede el usuario actual tocar a este otro? La base decide igual; esto solo
   *  evita ofrecer un botón que va a fallar. */
  const editable = (p: Profile) =>
    canManage
    && p.id !== profile?.id
    && (p.role !== 'propietario' && p.role !== 'superadmin'
        || ['propietario', 'superadmin'].includes(profile?.role ?? ''));

  const rolesOfrecidos = ROLES.filter(r =>
    r.id !== 'propietario' || ['propietario', 'superadmin'].includes(profile?.role ?? ''));

  const cols = canManage ? 5 : 4;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        icon={<ShieldCheck className="w-5 h-5 text-indigo-400" />}
        title="Usuarios y roles"
        subtitle="Quién entra y qué puede hacer. El alta de personal vive en Personal › Empleados"
      />

      {!canManage && <ReadOnlyNotice>Su rol permite ver el equipo, no administrar accesos.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !claveTarget && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <InlineAlert tone="warning">
        Nadie puede cambiar su propio rol, ni el propietario: ascender a alguien es
        siempre una acción sobre otra persona. Y para otorgar «propietario» hay que
        serlo. Estas reglas las aplica la base de datos, no esta pantalla.
      </InlineAlert>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Usuarios de la empresa</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">PERSONA</th>
                <th scope="col" className="p-3 font-semibold">CORREO</th>
                <th scope="col" className="p-3 font-semibold">ROL</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? <SkeletonRows cols={cols} />
                : rows.length === 0 ? (
                  <EmptyRow cols={cols}>Todavía no hay usuarios.</EmptyRow>
                ) : rows.map(p => (
                  <tr key={p.id} className="hover:bg-slate-800/40">
                    <td className="p-3">
                      <div className="font-bold text-white">
                        {p.full_name || '(sin nombre)'}
                        {p.id === profile?.id && (
                          <span className="ml-1.5 text-xs font-normal text-slate-500">(usted)</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {ROLES.find(r => r.id === p.role)?.nota ?? ''}
                      </div>
                    </td>
                    <td className="p-3 text-slate-400">{p.email ?? '—'}</td>
                    <td className="p-3">
                      {editable(p) ? (
                        <select
                          aria-label={`Rol de ${p.full_name}`}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white"
                          value={p.role ?? ''}
                          onChange={e => void cambiarRol(p, e.target.value as Role)}>
                          {rolesOfrecidos.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      ) : (
                        <span className="font-bold text-slate-300">
                          {ROLES.find(r => r.id === p.role)?.label ?? p.role ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {p.is_active
                        ? <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-xs">Activo</span>
                        : <span className="bg-slate-700/50 text-slate-400 font-bold px-2 py-0.5 rounded text-xs">Sin acceso</span>}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right whitespace-nowrap">
                        {editable(p) ? (
                          <>
                            <button onClick={() => { setClaveTarget(p); setClave(''); setError(null); }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                              <KeyRound className="w-3.5 h-3.5" /> Clave
                            </button>
                            <button onClick={() => void alternarActivo(p)}
                              className="ml-1 px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                              {p.is_active ? 'Quitar acceso' : 'Dar acceso'}
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-600">
                            {p.id === profile?.id ? 'usted mismo' : 'fuera de su alcance'}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {claveTarget && (
        <FormModal
          title={`Reiniciar clave — ${claveTarget.full_name}`}
          submitLabel="Reiniciar contraseña"
          busy={busy}
          error={error}
          onSubmit={() => void reiniciar()}
          onClose={() => setClaveTarget(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Contraseña nueva" htmlFor="user-pass">
            <input id="user-pass" className={textInputClass} value={clave} autoFocus
              onChange={e => setClave(e.target.value)}
              placeholder="Mínimo 6 caracteres" />
          </Field>
          <p className="text-xs text-slate-500">
            No se envía por ningún lado: dígasela en persona y pídale que la cambie
            al entrar. Queda constancia en la bitácora de quién la reinició.
          </p>
        </FormModal>
      )}
    </div>
  );
};
