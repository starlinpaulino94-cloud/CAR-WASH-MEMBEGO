import React, { useEffect, useState } from 'react';
import { Fingerprint, LogIn, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RANGES, RangeId, rangeDates } from '../../lib/reportRanges';
import {
  fetchAttendance, fetchOpenAttendance, clockIn, clockOut,
  AttendanceRow, AttendanceRecord
} from '../../data/payrollRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, FilterChips,
  SkeletonRows, EmptyRow, StatCard
} from '../common/DataViewShell';

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' });

/** 195 → "3 h 15 min". */
const duracion = (minutes: number | null): string => {
  if (minutes === null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

/**
 * Asistencia: la jornada REAL.
 *
 * Cada quien marca su entrada y su salida. La tardanza no se opina: se mide
 * contra el turno planificado de ese día, y si no había turno no se inventa.
 * Los minutos trabajados que salen de aquí son los que paga la nómina de quien
 * cobra por hora.
 */
export const AttendanceSupabaseView: React.FC = () => {
  const { profile, phase } = useAuth();
  const canSeeAll = ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const [range, setRange] = useState<RangeId>('week');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'ready') return;
    const { from, to } = rangeDates(range);
    // El rango llega en fechas; la consulta necesita el instante final incluido.
    const toExclusive = new Date(`${to}T00:00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);

    setLoading(true);
    fetchAttendance(new Date(`${from}T00:00:00`).toISOString(), toExclusive.toISOString())
      .then(setRows)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar la asistencia'))
      .finally(() => setLoading(false));
  }, [phase, range, nonce]);

  useEffect(() => {
    if (phase !== 'ready' || !profile) return;
    fetchOpenAttendance(profile.id).then(setOpen).catch(() => setOpen(null));
  }, [phase, profile, nonce]);

  const marcar = async (entrada: boolean) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const rec = entrada ? await clockIn() : await clockOut();
      setNotice(entrada
        ? rec.late_minutes > 0
          ? `Entrada marcada a las ${hhmm(rec.checked_in_at)} · ${rec.late_minutes} min de retraso.`
          : `Entrada marcada a las ${hhmm(rec.checked_in_at)}. A tiempo.`
        : `Salida marcada. Jornada de ${duracion(rec.worked_minutes)}.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el marcaje');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<Fingerprint className="w-5 h-5 text-brand" />}
          title="Asistencia" subtitle="Entrada, salida y tardanzas" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudo cargar la asistencia" />;
  }

  const cerradas = rows.filter(r => r.worked_minutes !== null);
  const totalMin = cerradas.reduce((s, r) => s + (r.worked_minutes ?? 0), 0);
  const tarde = rows.filter(r => r.late_minutes > 0).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Fingerprint className="w-5 h-5 text-brand" />}
        title="Asistencia"
        subtitle="Lo que de verdad pasó; Horarios dice lo que estaba planificado"
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      {/* Marcaje propio: es lo primero que busca quien entra a esta pantalla. */}
      <section aria-label="Mi jornada"
        className="bg-surface/80 border border-line rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-strong">Mi jornada</h2>
          <p className="text-xs text-faint">
            {open
              ? `Abierta desde las ${hhmm(open.checked_in_at)}${open.late_minutes > 0 ? ` · ${open.late_minutes} min de retraso` : ''}`
              : 'Sin jornada abierta.'}
          </p>
        </div>
        {open ? (
          <button onClick={() => void marcar(false)} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-warning hover:bg-warning text-on-accent font-bold text-xs rounded-xl disabled:opacity-50">
            <LogOut className="w-4 h-4" /> Marcar salida
          </button>
        ) : (
          <button onClick={() => void marcar(true)} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-success hover:bg-success text-on-accent font-bold text-xs rounded-xl disabled:opacity-50">
            <LogIn className="w-4 h-4" /> Marcar entrada
          </button>
        )}
      </section>

      <FilterChips options={RANGES} value={range} onChange={setRange} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Jornadas cerradas" value={String(cerradas.length)} />
        <StatCard label="Horas trabajadas" value={duracion(totalMin)}
          hint="Base del pago por hora" />
        <StatCard label="Llegadas tarde" value={String(tarde)}
          tone={tarde > 0 ? 'text-warning' : undefined}
          hint="Medidas contra el turno" />
      </div>

      {!canSeeAll && (
        <ReadOnlyNotice>Su rol solo permite ver sus propios marcajes.</ReadOnlyNotice>
      )}

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Marcajes del periodo</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">EMPLEADO</th>
                <th scope="col" className="p-3 font-semibold">DÍA</th>
                <th scope="col" className="p-3 font-semibold">ENTRADA</th>
                <th scope="col" className="p-3 font-semibold">SALIDA</th>
                <th scope="col" className="p-3 font-semibold text-right">JORNADA</th>
                <th scope="col" className="p-3 font-semibold text-right">RETRASO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? <SkeletonRows cols={6} />
                : rows.length === 0 ? (
                  <EmptyRow cols={6}>No hay marcajes en este periodo.</EmptyRow>
                ) : rows.map(r => (
                  <tr key={r.id} className="hover:bg-surface-2/40">
                    <td className="p-3 font-bold text-strong">{r.full_name}</td>
                    <td className="p-3 text-muted tabular-nums">{fecha(r.checked_in_at)}</td>
                    <td className="p-3 text-body tabular-nums">{hhmm(r.checked_in_at)}</td>
                    <td className="p-3 text-body tabular-nums">
                      {r.checked_out_at
                        ? hhmm(r.checked_out_at)
                        : <span className="text-success font-bold">en curso</span>}
                    </td>
                    <td className="p-3 text-right text-body tabular-nums">
                      {duracion(r.worked_minutes)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.late_minutes > 0
                        ? <span className="text-warning font-bold">{r.late_minutes} min</span>
                        : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
