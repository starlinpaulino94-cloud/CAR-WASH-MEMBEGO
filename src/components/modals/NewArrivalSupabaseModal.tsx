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
 * Versión sobre Supabase del asistente de nueva llegada. Deja fuera el canje de
 * beneficios Membego: las membresías y promociones ENTRAN solas por webhook y se
 * pueden consultar, pero aplicarlas a una venta exige avisar a Membego de que se
 * consumieron, y ese contrato no lo tenemos. Antes eso lo tapaba un simulador en
 * el cliente; se retiró, porque fingir la respuesta del proveedor no acerca la
 * integración, solo esconde que falta. Lo que sí hace esta pantalla —crear
 * cliente, vehículo, orden y líneas— ocurre en una sola transacción del
 * servidor.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar llegada de vehículo"
        className="bg-surface border border-line w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="bg-gradient-to-r from-brand-soft/50 to-surface px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/30 text-brand rounded-xl border border-brand/30">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-strong">Registrar llegada</h2>
              <p className="text-xs text-muted">{branch?.name}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar"
            className="text-muted hover:text-strong p-2 rounded-xl hover:bg-surface-2 transition-colors disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="na-plate" className="text-xs font-semibold text-muted uppercase">Placa *</label>
              <input
                id="na-plate" ref={firstFieldRef} type="text" value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())}
                disabled={busy}
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm font-bold tracking-wider text-strong uppercase focus:outline-none focus:border-brand disabled:opacity-50"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-cat" className="text-xs font-semibold text-muted uppercase">Categoría *</label>
              <select
                id="na-cat" value={category} disabled={busy}
                onChange={e => setCategory(e.target.value as VehicleCategory)}
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-cust" className="text-xs font-semibold text-muted uppercase">Cliente</label>
              <input id="na-cust" type="text" value={customerName} disabled={busy}
                onChange={e => setCustomerName(e.target.value)} placeholder="Cliente General"
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-phone" className="text-xs font-semibold text-muted uppercase">Teléfono</label>
              <input id="na-phone" type="tel" value={customerPhone} disabled={busy}
                onChange={e => setCustomerPhone(e.target.value)}
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-make" className="text-xs font-semibold text-muted uppercase">Marca</label>
              <input id="na-make" type="text" value={make} disabled={busy}
                onChange={e => setMake(e.target.value)}
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="na-model" className="text-xs font-semibold text-muted uppercase">Modelo</label>
              <input id="na-model" type="text" value={model} disabled={busy}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted uppercase">
              Servicios para {CATEGORIES.find(c => c.id === category)?.label} *
            </span>
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-canvas border border-line rounded-xl animate-pulse" />
                ))}
              </div>
            ) : services.length === 0 ? (
              <p className="text-xs text-faint italic py-6 text-center">
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
                          ? 'bg-brand-soft/50 border-brand text-strong'
                          : 'bg-canvas/60 border-line text-body hover:border-line-strong'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-bold text-sm">{s.name}</span>
                        <span className="text-sm font-bold text-brand-hi whitespace-nowrap">
                          {formatCents(s.price_cents, symbol)}
                        </span>
                      </span>
                      <span className="block text-xs text-faint mt-0.5">
                        ~{s.estimated_minutes} min
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="na-notes" className="text-xs font-semibold text-muted uppercase">Observaciones</label>
            <textarea id="na-notes" rows={2} value={notes} disabled={busy}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: cuidado con la pintura de la puerta izquierda…"
              className="w-full bg-canvas border border-line rounded-xl p-3 text-xs text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50" />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" />
              <div className="space-y-1">
                <p>{error}</p>
                <p className="text-xs text-danger/80">
                  Puede reintentar: la llegada conserva su identificador y no se registrará dos veces.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-canvas/60 px-6 py-4 border-t border-line flex items-center justify-between gap-4">
          <div className="text-xs text-muted">
            {selected.size > 0 ? (
              <>
                <strong className="text-strong">{formatCents(preview.subtotal, symbol)}</strong>
                <span className="text-faint"> · ~{preview.minutes} min</span>
              </>
            ) : (
              <span className="text-faint">Seleccione al menos un servicio</span>
            )}
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="px-5 py-2.5 bg-success hover:bg-success disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold rounded-xl text-xs shadow-lg shadow-success/30 transition-all flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            {busy ? 'Registrando…' : 'Registrar llegada'}
          </button>
        </div>
      </div>
    </div>
  );
};
