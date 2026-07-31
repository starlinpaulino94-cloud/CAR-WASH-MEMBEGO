import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Car, Loader2, AlertCircle, PlusCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import {
  createWorkOrder, fetchServicesForCategory, VehicleCategory, WorkOrder
} from '../../data/ordersRepository';

const CATEGORIES: { id: VehicleCategory; label: string }[] = [
  { id: 'sedan', label: 'Sedán' },
  { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' },
  { id: 'motorcycle', label: 'Moto' }
];

interface Props {
  onClose: () => void;
  onCreated: (order: WorkOrder) => void;
}

interface ServiceOption {
  id: string;
  name: string;
  price_cents: number;
  estimated_minutes: number;
}

/**
 * Registro de llegada.
 *
 * Versión sobre Supabase del asistente de nueva llegada. Deja fuera, de
 * momento, la verificación de beneficios Membego: esa integración sigue siendo
 * un simulador en el cliente y migrarla exige resolver antes su contrato real
 * (§6.2 de la auditoría). Lo que sí hace —crear cliente, vehículo, orden y
 * líneas— ocurre en una sola transacción del servidor.
 */
export const NewArrivalSupabaseModal: React.FC<Props> = ({ onClose, onCreated }) => {
  const { branch, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [plate, setPlate] = useState('');
  const [category, setCategory] = useState<VehicleCategory>('sedan');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Clave de idempotencia de ESTA llegada: se conserva entre reintentos para
  // que un fallo de red no acabe registrando el mismo vehículo dos veces.
  const requestId = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchServicesForCategory(category)
      .then(rows => { if (active) { setServices(rows as ServiceOption[]); setSelected(new Set()); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category]);

  // Diálogo accesible: foco inicial, Escape y foco atrapado.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const f = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose, busy]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const preview = useMemo(() => {
    const chosen = services.filter(s => selected.has(s.id));
    return {
      subtotal: chosen.reduce((acc, s) => acc + s.price_cents, 0),
      minutes: chosen.reduce((acc, s) => acc + s.estimated_minutes, 0)
    };
  }, [services, selected]);

  const canSubmit = plate.trim().length > 0 && selected.size > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit || !branch) return;
    setBusy(true);
    setError(null);
    try {
      const order = await createWorkOrder({
        branchId: branch.id,
        clientRequestId: requestId.current,
        plate: plate.trim(),
        category,
        services: services.filter(s => selected.has(s.id))
          .map(s => ({ serviceId: s.id, name: s.name, quantity: 1 })),
        // null = visitante anónimo. El servidor solo crea ficha de cliente si
        // hay nombre o teléfono, para no llenar el directorio de duplicados.
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        make: make.trim(),
        model: model.trim(),
        color: color.trim(),
        notes: notes.trim() || null
      });
      onCreated(order);
    } catch (err) {
      // La clave NO se renueva: reintentar debe reconocerse como el mismo registro.
      setError(err instanceof Error ? err.message : 'No se pudo registrar la llegada');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar llegada de vehículo"
        className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="bg-gradient-to-r from-indigo-900/50 to-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/30 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Registrar llegada</h2>
              <p className="text-xs text-slate-400">{branch?.name}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar"
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="na-plate" className="text-xs font-semibold text-slate-400 uppercase">Placa *</label>
              <input
                id="na-plate" ref={firstFieldRef} type="text" value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())}
                disabled={busy}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold tracking-wider text-white uppercase focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-cat" className="text-xs font-semibold text-slate-400 uppercase">Categoría *</label>
              <select
                id="na-cat" value={category} disabled={busy}
                onChange={e => setCategory(e.target.value as VehicleCategory)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-cust" className="text-xs font-semibold text-slate-400 uppercase">Cliente</label>
              <input id="na-cust" type="text" value={customerName} disabled={busy}
                onChange={e => setCustomerName(e.target.value)} placeholder="Cliente General"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-phone" className="text-xs font-semibold text-slate-400 uppercase">Teléfono</label>
              <input id="na-phone" type="tel" value={customerPhone} disabled={busy}
                onChange={e => setCustomerPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-make" className="text-xs font-semibold text-slate-400 uppercase">Marca</label>
              <input id="na-make" type="text" value={make} disabled={busy}
                onChange={e => setMake(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-model" className="text-xs font-semibold text-slate-400 uppercase">Modelo</label>
              <input id="na-model" type="text" value={model} disabled={busy}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase">
              Servicios para {CATEGORIES.find(c => c.id === category)?.label} *
            </span>
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-slate-950 border border-slate-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : services.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                No hay servicios con precio para esta categoría.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {services.map(s => {
                  const on = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      aria-pressed={on}
                      disabled={busy}
                      className={`p-3 rounded-xl border text-left transition-all disabled:opacity-50 ${
                        on
                          ? 'bg-indigo-950/50 border-indigo-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-bold text-sm">{s.name}</span>
                        <span className="text-sm font-bold text-indigo-300 whitespace-nowrap">
                          {formatCents(s.price_cents, symbol)}
                        </span>
                      </span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        ~{s.estimated_minutes} min
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="na-notes" className="text-xs font-semibold text-slate-400 uppercase">Observaciones</label>
            <textarea id="na-notes" rows={2} value={notes} disabled={busy}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: cuidado con la pintura de la puerta izquierda…"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <p>{error}</p>
                <p className="text-[10px] text-rose-300/80">
                  Puede reintentar: la llegada conserva su identificador y no se registrará dos veces.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-950/60 px-6 py-4 border-t border-slate-800 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-400">
            {selected.size > 0 ? (
              <>
                <strong className="text-white">{formatCents(preview.subtotal, symbol)}</strong>
                <span className="text-slate-500"> · ~{preview.minutes} min</span>
              </>
            ) : (
              <span className="text-slate-600">Seleccione al menos un servicio</span>
            )}
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            {busy ? 'Registrando…' : 'Registrar llegada'}
          </button>
        </div>
      </div>
    </div>
  );
};
