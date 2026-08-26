import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { X, Pencil, Loader2, AlertCircle, Save, Minus, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import {
  editWorkOrder, fetchOrderItems, fetchServicesForCategory,
  VehicleCategory, WorkOrder, WorkOrderItem
} from '../../data/ordersRepository';
import { useVehicleCategories } from '../../hooks/useVehicleCategories';

interface Props {
  order: WorkOrder;
  onClose: () => void;
  onSaved: (order: WorkOrder) => void;
}

interface ServiceOption {
  id: string;
  name: string;
  price_cents: number;
  estimated_minutes: number;
}

/** Marca, modelo y color salen del texto guardado «Marca Modelo». */
function splitMakeModel(makeModel: string): { make: string; model: string } {
  const parts = (makeModel ?? '').trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return { make: '', model: '' };
  return { make: parts[0], model: parts.slice(1).join(' ') };
}

/**
 * Editor de una orden en el taller.
 *
 * Corrige lo que se registró mal: servicios y cantidades, categoría del
 * vehículo, datos del carro, cliente, prioridad y observaciones. El importe lo
 * recalcula el servidor —el navegador nunca fija precios— y el cambio queda en
 * la bitácora con el total de antes y el de después.
 *
 * No aparece para órdenes entregadas, canceladas ni ya facturadas: el servidor
 * las rechaza y aquí ni se ofrece el botón. Cambiar la categoría vuelve a cargar
 * el catálogo de esa categoría y a tarifar sobre él.
 */
export const EditOrderSupabaseModal: React.FC<Props> = ({ order, onClose, onSaved }) => {
  const { company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const CATEGORIES = useVehicleCategories();

  const initialMM = splitMakeModel(order.vehicle_make_model);
  const [category, setCategory] = useState<VehicleCategory>(order.vehicle_category);
  const [make, setMake] = useState(initialMM.make);
  const [model, setModel] = useState(initialMM.model);
  const [color, setColor] = useState(order.vehicle_color ?? '');
  const [customerName, setCustomerName] = useState(order.customer_name ?? '');
  const [customerPhone, setCustomerPhone] = useState(order.customer_phone ?? '');
  const [priority, setPriority] = useState<'normal' | 'alta' | 'vip_membego'>(
    (order.priority as 'normal' | 'alta' | 'vip_membego') ?? 'normal'
  );
  const [notes, setNotes] = useState(order.notes ?? '');

  // Cantidad elegida por servicio. 0 (o ausente) = no incluido.
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // Los servicios que la orden ya tenía, para pre-seleccionarlos. Se leen una
  // sola vez: son el punto de partida, no algo que cambie mientras se edita.
  const initialItems = useRef<WorkOrderItem[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchOrderItems(order.id)
      .then(items => {
        if (!active) return;
        const services = items.filter(i => i.item_type === 'service' && i.service_id);
        initialItems.current = services;
        const map = new Map<string, number>();
        for (const it of services) if (it.service_id) map.set(it.service_id, it.quantity);
        setQuantities(map);
      })
      .catch(() => { /* si no cargan, se parte de cero: no es un fallo bloqueante */ });
    return () => { active = false; };
  }, [order.id]);

  // El catálogo de la categoría actual. Al cambiar de categoría se recarga y se
  // avisa si algún servicio ya elegido no existe con precio en la nueva.
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchServicesForCategory(category)
      .then(rows => {
        if (!active) return;
        const list = rows as ServiceOption[];
        setServices(list);
        setQuantities(prev => {
          const disponibles = new Set(list.map(s => s.id));
          const next = new Map<string, number>();
          let perdidos = 0;
          for (const [id, qty] of prev) {
            if (disponibles.has(id)) next.set(id, qty);
            else perdidos++;
          }
          setWarn(perdidos > 0
            ? `${perdidos} servicio(s) no tienen precio en esta categoría y se quitaron.`
            : null);
          return next;
        });
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category]);

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

  const setQty = (id: string, qty: number) => {
    setQuantities(prev => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  };

  const preview = useMemo(() => {
    let subtotal = 0, minutes = 0, count = 0;
    for (const s of services) {
      const qty = quantities.get(s.id) ?? 0;
      if (qty > 0) { subtotal += s.price_cents * qty; minutes += s.estimated_minutes * qty; count += 1; }
    }
    return { subtotal, minutes, count };
  }, [services, quantities]);

  const canSubmit = preview.count > 0 && !busy && customerName.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = services
        .filter(s => (quantities.get(s.id) ?? 0) > 0)
        .map(s => ({ serviceId: s.id, name: s.name, quantity: quantities.get(s.id) ?? 1 }));
      const updated = await editWorkOrder({
        orderId: order.id,
        category,
        services: chosen,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        make: make.trim(),
        model: model.trim(),
        color: color.trim(),
        priority,
        notes: notes.trim() || null
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la orden');
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Editar la orden ${order.order_number}`}
        className="bg-surface border border-line w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="bg-gradient-to-r from-brand-soft/50 to-surface px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/30 text-brand rounded-xl border border-brand/30">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-strong">Editar orden {order.order_number}</h2>
              <p className="text-xs text-muted">{order.vehicle_plate}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="eo-cat" className="text-xs font-semibold text-muted uppercase">Categoría *</label>
              <select
                id="eo-cat" ref={firstFieldRef} value={category} disabled={busy}
                onChange={e => setCategory(e.target.value as VehicleCategory)}
                className={inputClass}
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eo-priority" className="text-xs font-semibold text-muted uppercase">Prioridad</label>
              <select
                id="eo-priority" value={priority} disabled={busy}
                onChange={e => setPriority(e.target.value as 'normal' | 'alta' | 'vip_membego')}
                className={inputClass}
              >
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="vip_membego">VIP Membego</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eo-make" className="text-xs font-semibold text-muted uppercase">Marca</label>
              <input id="eo-make" type="text" value={make} disabled={busy}
                onChange={e => setMake(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eo-model" className="text-xs font-semibold text-muted uppercase">Modelo</label>
              <input id="eo-model" type="text" value={model} disabled={busy}
                onChange={e => setModel(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eo-color" className="text-xs font-semibold text-muted uppercase">Color</label>
              <input id="eo-color" type="text" value={color} disabled={busy}
                onChange={e => setColor(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="eo-cust" className="text-xs font-semibold text-muted uppercase">Cliente *</label>
              <input id="eo-cust" type="text" value={customerName} disabled={busy}
                onChange={e => setCustomerName(e.target.value)} placeholder="Cliente General"
                className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eo-phone" className="text-xs font-semibold text-muted uppercase">Teléfono</label>
              <input id="eo-phone" type="tel" value={customerPhone} disabled={busy}
                onChange={e => setCustomerPhone(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted uppercase">
              Servicios para {CATEGORIES.find(c => c.id === category)?.label} *
            </span>
            {warn && (
              <p role="status" className="text-xs text-warning bg-warning/20 border border-warning/40 rounded-lg p-2">
                {warn}
              </p>
            )}
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
                  const qty = quantities.get(s.id) ?? 0;
                  const on = qty > 0;
                  return (
                    <div
                      key={s.id}
                      className={`p-3 rounded-xl border transition-all ${
                        on ? 'bg-brand-soft/50 border-brand' : 'bg-canvas/60 border-line'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setQty(s.id, on ? 0 : 1)}
                          aria-pressed={on}
                          disabled={busy}
                          className="min-w-0 text-left flex-1 disabled:opacity-50"
                        >
                          <span className="block font-bold text-sm text-strong truncate">{s.name}</span>
                          <span className="block text-xs text-faint mt-0.5">
                            {formatCents(s.price_cents, symbol)} · ~{s.estimated_minutes} min
                          </span>
                        </button>
                        {on && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button type="button" variant="outline" size="icon-sm" disabled={busy}
                              aria-label={`Quitar uno de ${s.name}`}
                              onClick={() => setQty(s.id, qty - 1)}>
                              <Minus className="w-3.5 h-3.5" />
                            </Button>
                            <span className="w-6 text-center text-sm font-bold text-strong">{qty}</span>
                            <Button type="button" variant="outline" size="icon-sm" disabled={busy}
                              aria-label={`Agregar uno de ${s.name}`}
                              onClick={() => setQty(s.id, qty + 1)}>
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="eo-notes" className="text-xs font-semibold text-muted uppercase">Observaciones</label>
            <textarea id="eo-notes" rows={2} value={notes} disabled={busy}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-canvas border border-line rounded-xl p-3 text-xs text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50" />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" />
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="bg-canvas/60 px-6 py-4 border-t border-line flex items-center justify-between gap-4">
          <div className="text-xs text-muted">
            {preview.count > 0 ? (
              <>
                <strong className="text-strong">{formatCents(preview.subtotal, symbol)}</strong>
                <span className="text-faint"> + ITBIS · ~{preview.minutes} min</span>
              </>
            ) : (
              <span className="text-faint">Elija al menos un servicio</span>
            )}
          </div>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />}
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </div>
  );
};
