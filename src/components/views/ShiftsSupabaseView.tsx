import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  fetchStaff, fetchShifts, scheduleShift, deleteShift,
  Profile, ShiftRow
} from '../../data/payrollRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

/** Lunes de la semana que contiene la fecha dada. */
const mondayOf = (d: Date): Date => {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  // getDay(): 0 = domingo. Se retrocede al lunes anterior.
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

const DAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });

/** "2026-08-10T07:00" (valor de un input datetime-local) → ISO con zona local. */
const localToIso = (value: string): string => new Date(value).toISOString();

/** Fecha para el valor por defecto de un datetime-local. */
const isoToLocal = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Horarios: el turno PLANIFICADO, semana a semana.
 *
 * Es la contraparte de Asistencia, que registra lo que de verdad pasó. Sin el
 * turno no hay forma de decir que alguien llegó tarde: la tardanza se mide
 * contra esto.
 */
export const ShiftsSupabaseView: React.FC = () => {
  const { profile, phase, branch } = useAuth();
  const canManage = ['propietario', 'administrador', 'supervisor', 'superadmin']
    .includes(profile?.role ?? '');

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  useEffect(() => {
    if (phase !== 'ready') return;
    setLoading(true);
    fetchShifts(weekStart.toISOString(), weekEnd.toISOString())
      .then(setShifts)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar los turnos'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, weekStart.getTime(), nonce]);

  useEffect(() => {
    if (phase !== 'ready' || !canManage) return;
    fetchStaff().then(setStaff).catch(() => setStaff([]));
  }, [phase, canManage]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ profileId: '', startsAt: '', endsAt: '', notes: '' });

  const openForm = (day: Date) => {
    const start = new Date(day); start.setHours(8, 0, 0, 0);
    const end = new Date(day); end.setHours(17, 0, 0, 0);
    setForm({
      profileId: staff[0]?.id ?? '',
      startsAt: isoToLocal(start), endsAt: isoToLocal(end), notes: ''
    });
    setError(null); setShowForm(true);
  };

  const submit = async () => {
    if (busy) return;
    if (!form.profileId) { setError('Elija al empleado.'); return; }
    if (!form.startsAt || !form.endsAt) { setError('Indique la entrada y la salida.'); return; }
    setBusy(true); setError(null);
    try {
      await scheduleShift({
        profileId: form.profileId,
        startsAt: localToIso(form.startsAt),
        endsAt: localToIso(form.endsAt),
        branchId: branch?.id ?? null,
        notes: form.notes.trim() || null
      });
      setShowForm(false);
      setNotice('Turno programado.');
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo programar el turno');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: ShiftRow) => {
    try {
      await deleteShift(s.id);
      setNotice(`Turno de ${s.full_name} retirado.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo retirar el turno');
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<CalendarClock className="w-5 h-5 text-indigo-400" />}
          title="Horarios" subtitle="Turnos planificados por empleado" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && !showForm && shifts.length === 0 && !loading) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudieron cargar los turnos" />;
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const shiftsOf = (day: Date) => shifts.filter(s => {
    const start = new Date(s.starts_at);
    return start.getFullYear() === day.getFullYear()
      && start.getMonth() === day.getMonth()
      && start.getDate() === day.getDate();
  });

  const shiftWeek = (delta: number) => {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + delta * 7);
    setWeekStart(next);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<CalendarClock className="w-5 h-5 text-indigo-400" />}
        title="Horarios"
        subtitle="Lo que está planificado; Asistencia registra lo que pasó"
      />

      {!canManage && <ReadOnlyNotice>Su rol permite ver los turnos, no programarlos.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showForm && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="flex items-center gap-2">
        <button onClick={() => shiftWeek(-1)} aria-label="Semana anterior"
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-white tabular-nums">
          {weekStart.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}
          {' — '}
          {days[6].toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
        <button onClick={() => shiftWeek(1)} aria-label="Semana siguiente"
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button onClick={() => setWeekStart(mondayOf(new Date()))}
          className="ml-1 px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
          Esta semana
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {days.map((day, i) => {
          const dayShifts = shiftsOf(day);
          return (
            <section key={day.toISOString()} aria-label={DAY_LABELS[i]}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-2">
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">{DAY_LABELS[i]}</h2>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {day.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' })}
                  </p>
                </div>
                {canManage && (
                  <button onClick={() => openForm(day)} aria-label={`Programar turno el ${DAY_LABELS[i]}`}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </header>

              {loading ? (
                <div className="h-12 bg-slate-800/50 rounded-lg animate-pulse" />
              ) : dayShifts.length === 0 ? (
                <p className="text-xs text-slate-500">Sin turnos.</p>
              ) : (
                <ul className="space-y-1.5">
                  {dayShifts.map(s => (
                    <li key={s.id}
                      className="flex items-center justify-between gap-2 bg-slate-950/50 rounded-lg px-2.5 py-2">
                      <div>
                        <div className="text-sm font-bold text-white">{s.full_name}</div>
                        <div className="text-xs text-slate-400 tabular-nums">
                          {hhmm(s.starts_at)} – {hhmm(s.ends_at)}
                        </div>
                        {s.notes && <div className="text-xs text-slate-500">{s.notes}</div>}
                      </div>
                      {canManage && (
                        <button onClick={() => void remove(s)} aria-label={`Retirar turno de ${s.full_name}`}
                          className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {showForm && (
        <FormModal
          title="Programar turno"
          submitLabel="Programar"
          busy={busy}
          error={error}
          onSubmit={() => void submit()}
          onClose={() => setShowForm(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Empleado" htmlFor="shift-profile">
            <select id="shift-profile" className={textInputClass} value={form.profileId}
              onChange={e => setForm(f => ({ ...f, profileId: e.target.value }))}>
              <option value="">Elija al empleado…</option>
              {staff.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field label="Entrada" htmlFor="shift-start">
            <input id="shift-start" type="datetime-local" className={textInputClass}
              value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
          </Field>
          <Field label="Salida" htmlFor="shift-end">
            <input id="shift-end" type="datetime-local" className={textInputClass}
              value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
          </Field>
          <Field label="Notas" htmlFor="shift-notes">
            <input id="shift-notes" className={textInputClass} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Cubre a Juan, media jornada…" />
          </Field>
          <p className="text-xs text-slate-500">
            Dos turnos encima de la misma persona se rechazan: es un error de
            planificación, no un dato.
          </p>
        </FormModal>
      )}
    </div>
  );
};
