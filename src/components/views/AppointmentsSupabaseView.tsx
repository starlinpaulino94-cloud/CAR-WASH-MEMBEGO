import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Loader2, CheckCircle2,
  XCircle, CarFront, Clock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  fetchDayAppointments, bookAppointment, updateAppointmentStatus,
  convertAppointment, checkAvailability, Appointment, Availability
} from '../../data/appointmentRepository';
import { fetchServicesWithPrices, ServiceWithPrices, VehicleCategory } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const STATUS_TONE: Record<string, string> = {
  pendiente: 'bg-slate-700/60 text-slate-300',
  confirmada: 'bg-sky-500/20 text-sky-300',
  en_curso: 'bg-indigo-500/20 text-indigo-300',
  convertida: 'bg-emerald-500/20 text-emerald-400',
  cancelada: 'bg-rose-500/20 text-rose-400',
  ausente: 'bg-amber-500/20 text-amber-300'
};
const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente', confirmada: 'Confirmada', en_curso: 'En curso',
  convertida: 'En taller', cancelada: 'Cancelada', ausente: 'No asistió'
};

const CATEGORIES: { id: VehicleCategory; label: string }[] = [
  { id: 'sedan', label: 'Sedán' }, { id: 'suv', label: 'SUV' }, { id: 'jeep', label: 'Jeep' },
  { id: 'pickup', label: 'Pickup' }, { id: 'van', label: 'Van' }, { id: 'truck', label: 'Camión' },
  { id: 'motorcycle', label: 'Motor' }, { id: 'special', label: 'Especial' }
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Agenda del día.
 *
 * Para detallado, pulido o ceramic coating —trabajos de horas— reservar antes
 * evita que el taller se sature. La capacidad la marcan las bahías: el
 * servidor rechaza la reserva si la franja está llena.
 */
export const AppointmentsSupabaseView: React.FC = () => {
  const { branch, profile, phase } = useAuth();
  const canBook = ['propietario', 'administrador', 'supervisor', 'recepcionista', 'cajero', 'superadmin']
    .includes(profile?.role ?? '');

  const [day, setDay] = useState(() => isoDay(new Date()));
  const [rows, setRows] = useState<Appointment[]>([]);
  const [services, setServices] = useState<ServiceWithPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Alta de cita.
  const [showBook, setShowBook] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [category, setCategory] = useState<VehicleCategory>('sedan');
  const [serviceId, setServiceId] = useState('');
  const [time, setTime] = useState('09:00');
  const [bookDay, setBookDay] = useState(() => isoDay(new Date()));
  const [availability, setAvailability] = useState<Availability | null>(null);

  // Cancelación.
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const reload = useCallback(() => {
    if (phase !== 'ready' || !branch) { setLoading(false); return; }
    setLoading(true);
    fetchDayAppointments(branch.id, day)
      .then(setRows)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar la agenda'))
      .finally(() => setLoading(false));
  }, [phase, branch, day]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (phase !== 'ready') return;
    fetchServicesWithPrices().then(setServices).catch(() => setServices([]));
  }, [phase]);

  // Disponibilidad en vivo de la franja elegida.
  useEffect(() => {
    if (!showBook || !branch) return;
    const svc = services.find(s => s.id === serviceId);
    const minutes = svc?.estimated_minutes ?? 60;
    const startIso = new Date(`${bookDay}T${time}:00`).toISOString();
    let alive = true;
    checkAvailability(branch.id, startIso, minutes)
      .then(a => { if (alive) setAvailability(a); })
      .catch(() => { if (alive) setAvailability(null); });
    return () => { alive = false; };
  }, [showBook, branch, bookDay, time, serviceId, services]);

  const shiftDay = (delta: number) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDay(isoDay(d));
  };

  const submitBook = async () => {
    if (!branch || busy) return;
    if (!name.trim()) { setError('Indique el nombre del cliente.'); return; }
    setBusy(true); setError(null);
    try {
      await bookAppointment({
        branchId: branch.id,
        customerName: name.trim(),
        scheduledAt: new Date(`${bookDay}T${time}:00`).toISOString(),
        serviceId: serviceId || null,
        plate: plate.trim(),
        category,
        customerPhone: phone.trim() || null
      });
      setShowBook(false);
      setName(''); setPhone(''); setPlate(''); setServiceId('');
      setNotice('Cita agendada.');
      setDay(bookDay);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agendar la cita');
    } finally {
      setBusy(false);
    }
  };

  const mark = async (a: Appointment, status: 'confirmada' | 'ausente') => {
    setError(null);
    try {
      await updateAppointmentStatus(a.id, status);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la cita');
    }
  };

  const submitCancel = async () => {
    if (!cancelling || busy) return;
    if (!cancelReason.trim()) { setError('Indique el motivo de la cancelación.'); return; }
    setBusy(true); setError(null);
    try {
      await updateAppointmentStatus(cancelling.id, 'cancelada', cancelReason.trim());
      setCancelling(null); setCancelReason('');
      setNotice('Cita cancelada.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  };

  const toOrder = async (a: Appointment) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const order = await convertAppointment(a.id);
      setNotice(`Orden ${order.order_number} creada para ${a.customer_name}.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo convertir la cita');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<CalendarDays className="w-5 h-5 text-indigo-400" />}
          title="Agenda" subtitle="Citas y reservaciones" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !showBook && !cancelling) {
    return <ErrorState message={error} onRetry={reload} title="No se pudo cargar la agenda" />;
  }

  const dayLabel = new Date(`${day}T12:00:00`).toLocaleDateString('es-DO', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <ViewHeader
        icon={<CalendarDays className="w-5 h-5 text-indigo-400" />}
        title="Agenda"
        subtitle="Reservas del día · la capacidad la marcan las bahías"
        actions={canBook ? (
          <button onClick={() => { setBookDay(day); setError(null); setShowBook(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nueva cita
          </button>
        ) : undefined}
      />

      {!canBook && <ReadOnlyNotice>Su rol permite consultar la agenda, no reservar.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showBook && !cancelling && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      {/* Navegación del día */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl p-3">
        <button onClick={() => shiftDay(-1)} aria-label="Día anterior"
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="font-bold text-white capitalize">{dayLabel}</div>
          <button onClick={() => setDay(isoDay(new Date()))}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-bold">
            Ir a hoy
          </button>
        </div>
        <button onClick={() => shiftDay(1)} aria-label="Día siguiente"
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center">
          <Clock className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 italic">Sin citas para este día.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(a => {
            const start = new Date(a.scheduled_at);
            const done = ['convertida', 'cancelada', 'ausente'].includes(a.status);
            return (
              <li key={a.id}
                className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                  done ? 'opacity-60' : ''
                }`}>
                <div className="flex-shrink-0 text-center w-16">
                  <div className="text-lg font-black text-white tabular-nums">
                    {start.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-xs text-slate-500">{a.duration_minutes} min</div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white">{a.customer_name}</div>
                  <div className="text-sm text-slate-400">
                    {a.service_name || 'Sin servicio'}
                    {a.vehicle_plate && ` · ${a.vehicle_plate}`}
                    {a.customer_phone && ` · ${a.customer_phone}`}
                  </div>
                  {a.cancel_reason && (
                    <div className="text-xs text-rose-300 mt-0.5">Motivo: {a.cancel_reason}</div>
                  )}
                </div>

                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${STATUS_TONE[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>

                {canBook && !done && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {a.status === 'pendiente' && (
                      <button onClick={() => void mark(a, 'confirmada')}
                        className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar
                      </button>
                    )}
                    <button onClick={() => void toOrder(a)} disabled={busy || !a.vehicle_plate}
                      title={a.vehicle_plate ? 'Crear la orden de servicio' : 'La cita necesita placa'}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white inline-flex items-center gap-1">
                      <CarFront className="w-3.5 h-3.5" /> Llegó
                    </button>
                    <button onClick={() => void mark(a, 'ausente')}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300">
                      No asistió
                    </button>
                    <button onClick={() => { setCancelling(a); setCancelReason(''); setError(null); }}
                      aria-label={`Cancelar cita de ${a.customer_name}`}
                      className="p-1.5 text-slate-500 hover:text-rose-400">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showBook && (
        <FormModal
          title="Nueva cita"
          submitLabel="Agendar"
          busy={busy}
          error={error}
          onSubmit={() => void submitBook()}
          onClose={() => setShowBook(false)}
          onDismissError={() => setError(null)}
          wide
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cliente *" htmlFor="ap-name">
              <input id="ap-name" className={textInputClass} value={name} autoFocus
                onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" />
            </Field>
            <Field label="Teléfono" htmlFor="ap-phone">
              <input id="ap-phone" className={textInputClass} value={phone}
                onChange={e => setPhone(e.target.value)} placeholder="809-000-0000" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Placa" htmlFor="ap-plate" hint="Necesaria para convertirla en orden.">
              <input id="ap-plate" className={textInputClass} value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="A123456" />
            </Field>
            <Field label="Tipo de vehículo" htmlFor="ap-cat">
              <select id="ap-cat" className={textInputClass} value={category}
                onChange={e => setCategory(e.target.value as VehicleCategory)}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Servicio" htmlFor="ap-service" hint="Su duración estimada reserva la franja.">
            <select id="ap-service" className={textInputClass} value={serviceId}
              onChange={e => setServiceId(e.target.value)}>
              <option value="">— Sin servicio (1 hora) —</option>
              {services.filter(s => s.is_active).map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.estimated_minutes} min)</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Día *" htmlFor="ap-day">
              <input id="ap-day" type="date" className={textInputClass} value={bookDay}
                onChange={e => setBookDay(e.target.value)} min={isoDay(new Date())} />
            </Field>
            <Field label="Hora *" htmlFor="ap-time">
              <input id="ap-time" type="time" className={textInputClass} value={time}
                onChange={e => setTime(e.target.value)} />
            </Field>
          </div>

          {availability && (
            <div className={`rounded-xl p-3 text-sm border ${
              availability.free > 0
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
            }`}>
              {availability.free > 0
                ? <>Hay <strong>{availability.free}</strong> de {availability.capacity} bahías libres en esa franja.</>
                : <>Esa franja está llena ({availability.taken} de {availability.capacity} bahías). Elija otra hora.</>}
            </div>
          )}
        </FormModal>
      )}

      {cancelling && (
        <FormModal
          title={`Cancelar cita — ${cancelling.customer_name}`}
          submitLabel="Cancelar cita"
          busy={busy}
          error={error}
          onSubmit={() => void submitCancel()}
          onClose={() => setCancelling(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Motivo de la cancelación *" htmlFor="ap-cancel"
            hint="Queda registrado para el historial del cliente.">
            <input id="ap-cancel" className={textInputClass} value={cancelReason} autoFocus
              onChange={e => setCancelReason(e.target.value)}
              placeholder="El cliente reprogramó" />
          </Field>
        </FormModal>
      )}
    </div>
  );
};
