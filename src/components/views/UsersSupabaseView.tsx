import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { KeyRound, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can, outranks } from '../../lib/auth';
import {
  fetchProfiles, updateProfileAccess, updateProfileIdentity, resetEmployeePassword, Profile, Role
} from '../../data/fiscalRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { ConfirmarEliminar } from '../common/ConfirmarEliminar';
import { eliminarEmpleado } from '../../data/adminRepository';

/**
 * Cómo nombrar a alguien que todavía no tiene nombre.
 *
 * Quien entra por Membego llega con `full_name` vacío, así que media pantalla
 * decía « ahora es Administrador» con un hueco delante. El correo identifica
 * igual y no deja frases mancas.
 */
const nombreDe = (p: { full_name?: string | null; email?: string | null }): string =>
  (p.full_name ?? '').trim() || p.email || 'este usuario';

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

  /*
   * Eliminar la ficha de un empleado.
   *
   * Quitar el acceso ya se podía; eliminar, no. Una ficha creada con el correo
   * mal escrito se quedaba en la lista para siempre marcada «sin acceso».
   *
   * En la práctica solo se borra a quien NUNCA trabajó: la base cuenta sus
   * acciones y se niega si tiene alguna, porque su nombre debe seguir en lo que
   * hizo. Aquí no se replica ese cálculo —sería una segunda verdad que se
   * desincroniza—: se intenta y se enseña lo que la base responda.
   */
  const puedeBorrar = can(profile, 'deleteRecords');
  const [borrando, setBorrando] = useState<Profile | null>(null);

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
      setNotice(`${nombreDe(p)} ahora es ${ROLES.find(r => r.id === role)?.label}.`);
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
        ? `${nombreDe(p)} ya no puede entrar.`
        : `${nombreDe(p)} vuelve a tener acceso.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    } finally {
      setBusy(false);
    }
  };

  // --- Corregir la ficha (nombre y teléfono)
  const [fichaTarget, setFichaTarget] = useState<Profile | null>(null);
  const [fichaNombre, setFichaNombre] = useState('');
  const [fichaTel, setFichaTel] = useState('');

  const abrirFicha = (p: Profile) => {
    setFichaTarget(p);
    setFichaNombre(p.full_name ?? '');
    setFichaTel(p.phone ?? '');
    setError(null);
  };

  const guardarFicha = async () => {
    if (!fichaTarget || busy) return;
    if (fichaNombre.trim().length < 2) {
      setError('Escriba el nombre de la persona.');
      return;
    }
    setBusy(true); setError(null);
    try {
      await updateProfileIdentity(fichaTarget.id, {
        full_name: fichaNombre.trim(),
        // Vacío va como nulo: «no tiene teléfono» y «tiene el teléfono ""» no
        // son lo mismo, y el segundo no significa nada.
        phone: fichaTel.trim() || null
      });
      setFichaTarget(null);
      setNotice(`Ficha de ${fichaNombre.trim()} actualizada.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la ficha');
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
      setNotice(`Contraseña de ${nombreDe(claveTarget)} reiniciada. Dígasela en persona.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reiniciar la contraseña');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
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

  /**
   * Corregir el NOMBRE no es lo mismo que cambiar el ROL, así que la regla no
   * puede ser la misma.
   *
   * `editable` excluye a uno mismo y a los propietarios: tiene sentido para los
   * permisos —nadie se asciende solo— pero no para escribir cómo se llama
   * alguien. La base ya lo dice: `profiles_admin_manage` deja a un
   * administrador corregir cualquier ficha de su empresa, la suya incluida,
   * mientras no toque el rol ni la empresa. Y TIENE que dejarlo: quien entra
   * por Membego llega sin nombre, y el primero que se topa con eso suele ser el
   * propio administrador mirando su propia fila.
   *
   * Poner aquí una regla más estricta que la de la base sería inventarse una
   * segunda verdad y esconder un botón que sí habría funcionado.
   */
  const puedeCorregirFicha = canManage;

  const rolesOfrecidos = ROLES.filter(r =>
    r.id !== 'propietario' || ['propietario', 'superadmin'].includes(profile?.role ?? ''));

  const cols = canManage ? 5 : 4;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
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

      {/* Hasta la 20260922140000, cada entrada por el enlace de Membego
          reescribía el rol con el del token: el ascenso dado aquí se deshacía
          solo, sin aviso ni rastro. Ahora manda el de aquí, y se dice en la
          pantalla donde se asignan los roles para que nadie tenga que
          descubrirlo por su cuenta. */}
      <InlineAlert tone="info">
        El rol que se asigna aquí manda. Quien entra por Membego estrena el rol que
        traiga de allá la primera vez; a partir de ahí, lo que usted ponga en esta
        pantalla se queda, aunque vuelva a entrar por el enlace. Dar de baja a
        alguien aquí tampoco se deshace al volver a entrar.
      </InlineAlert>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <caption className="sr-only">Usuarios de la empresa</caption>
            <TableHeader>
              <TableRow className="border-b border-line text-muted bg-canvas/50">
                <TableHead scope="col" className="p-3 font-semibold">PERSONA</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">CORREO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">ROL</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">ESTADO</TableHead>
                {canManage && <TableHead scope="col" className="p-3 font-semibold text-right">ACCIONES</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <SkeletonRows cols={cols} />
                : rows.length === 0 ? (
                  <EmptyRow cols={cols}>Todavía no hay usuarios.</EmptyRow>
                ) : rows.map(p => (
                  <TableRow key={p.id} className="hover:bg-surface-2/40">
                    <TableCell className="p-3">
                      <div className="font-bold text-strong">
                        {(p.full_name ?? '').trim() || '(sin nombre)'}
                        {p.id === profile?.id && (
                          <span className="ml-1.5 text-xs font-normal text-faint">(usted)</span>
                        )}
                      </div>
                      <div className="text-xs text-faint">
                        {ROLES.find(r => r.id === p.role)?.nota ?? ''}
                      </div>
                    </TableCell>
                    <TableCell className="p-3 text-muted">{p.email ?? '—'}</TableCell>
                    <TableCell className="p-3">
                      {editable(p) ? (
                        <select
                          aria-label={`Rol de ${nombreDe(p)}`}
                          className="bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-strong"
                          value={p.role ?? ''}
                          onChange={e => void cambiarRol(p, e.target.value as Role)}>
                          {rolesOfrecidos.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      ) : (
                        <span className="font-bold text-body">
                          {ROLES.find(r => r.id === p.role)?.label ?? p.role ?? '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="p-3">
                      {p.is_active
                        ? <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">Activo</span>
                        : <span className="bg-surface-3/50 text-muted font-bold px-2 py-0.5 rounded text-xs">Sin acceso</span>}
                    </TableCell>
                    {canManage && (
                      <TableCell className="p-3 text-right whitespace-nowrap">
                        {/* Corregir la ficha va FUERA del `editable(p)`: su
                            regla es otra —ver `puedeCorregirFicha`— y el caso
                            más común es un administrador arreglando su propia
                            fila, que `editable` excluye. */}
                        {puedeCorregirFicha && (
                          <Button variant="secondary" size="xs" className="mr-1"
                            onClick={() => abrirFicha(p)}
                            aria-label={`Editar la ficha de ${nombreDe(p)}`}>
                            <Pencil /> Ficha
                          </Button>
                        )}
                        {editable(p) ? (
                          <>
                            <Button variant="secondary" size="xs" onClick={() => { setClaveTarget(p); setClave(''); setError(null); }}>
                              <KeyRound /> Clave
                            </Button>
                            <Button variant="secondary" size="xs" className="ml-1" onClick={() => void alternarActivo(p)}>
                              {p.is_active ? 'Quitar acceso' : 'Dar acceso'}
                            </Button>
                            {puedeBorrar && (
                              <Button variant="ghost" size="icon-xs" className="ml-1 text-muted hover:text-danger"
                                onClick={() => setBorrando(p)}
                                aria-label={`Eliminar la ficha de ${nombreDe(p)}`}
                                title="Solo se puede si nunca trabajó">
                                <Trash2 />
                              </Button>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-faint">
                            {p.id === profile?.id ? 'usted mismo' : 'fuera de su alcance'}
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {borrando && (
        <ConfirmarEliminar
          queEs="la ficha de"
          nombre={nombreDe(borrando)}
          onEliminar={() => eliminarEmpleado(borrando.id)}
          onCerrar={() => setBorrando(null)}
          onHecho={() => { setNonce(n => n + 1); setNotice(
            `Ficha de ${nombreDe(borrando)} eliminada. Su credencial de acceso sigue existiendo ` +
            'en Supabase Auth: bórrela también en Authentication › Users si quiere quitarla del todo.'
          ); }}
        />
      )}

      {fichaTarget && (
        <FormModal
          title={`Ficha — ${nombreDe(fichaTarget)}`}
          submitLabel="Guardar ficha"
          busy={busy}
          error={error}
          onSubmit={() => void guardarFicha()}
          onClose={() => setFichaTarget(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Nombre completo *" htmlFor="ficha-nombre">
            <input id="ficha-nombre" className={textInputClass} value={fichaNombre} autoFocus
              onChange={e => setFichaNombre(e.target.value)}
              placeholder="Juan Pérez" />
          </Field>
          <Field label="Teléfono (opcional)" htmlFor="ficha-tel">
            <input id="ficha-tel" className={textInputClass} value={fichaTel}
              onChange={e => setFichaTel(e.target.value)}
              placeholder="809-555-0000" />
          </Field>
          <Field label="Correo" htmlFor="ficha-correo"
            hint="No se edita aquí: es con lo que inicia sesión y con lo que Membego lo reconoce en cada entrada. Cambiarlo solo en esta pantalla dejaría el acceso funcionando con el correo viejo.">
            <p id="ficha-correo" className={`${textInputClass} text-muted`}>
              {fichaTarget.email ?? 'sin correo'}
            </p>
          </Field>
          <p className="text-xs text-faint">
            El rol y el acceso se cambian en esta misma lista. La sucursal se asigna en
            Configuración › Sucursales, y el sueldo y la comisión en Personal › Nómina.
          </p>
        </FormModal>
      )}

      {claveTarget && (
        <FormModal
          title={`Reiniciar clave — ${nombreDe(claveTarget)}`}
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
          <p className="text-xs text-faint">
            No se envía por ningún lado: dígasela en persona y pídale que la cambie
            al entrar. Queda constancia en la bitácora de quién la reinició.
          </p>
        </FormModal>
      )}
    </div>
  );
};
