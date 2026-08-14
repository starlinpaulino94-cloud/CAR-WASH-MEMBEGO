import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Car, Loader2, AlertCircle, PlusCircle, Search, UserCheck, History, BadgeCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import {
  createWorkOrder, fetchServicesForCategory, VehicleCategory, WorkOrder
} from '../../data/ordersRepository';
import {
  lookupVehicleByPlate, normalizePlate, searchCustomers, fetchFichaMembego,
  CustomerMatch, VehicleMatch, FichaMembego, ErrorFichaMembego
} from '../../data/customersRepository';

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

/** Distintivo corto de la ficha del cliente. Texto, no solo color. */
const Etiqueta: React.FC<{ children: React.ReactNode; tono?: 'ok' | 'info' }> = ({ children, tono }) => (
  <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${
    tono === 'ok'   ? 'bg-success/15 border-success/40 text-success'
    : tono === 'info' ? 'bg-info/15 border-info/40 text-info'
    : 'bg-surface-2 border-line text-muted'
  }`}>
    {children}
  </span>
);

/**
 * Registro de llegada.
 *
 * Versión sobre Supabase del asistente de nueva llegada. Crear cliente,
 * vehículo, orden y líneas ocurre en una sola transacción del servidor.
 *
 * Al elegir un cliente que viene de Membego se le pregunta a Membego, en vivo,
 * qué tiene: su membresía con los lavados que le quedan y cuándo se le vence,
 * sus promociones disponibles y sus vehículos. Y si ya hay placa, si esa
 * membresía cubre ESE carro.
 *
 * Nada de eso se guarda. Los beneficios NO se proyectan —lo dice el contrato de
 * Membego— porque una copia desfasada regala un lavado ya consumido. Y si
 * Membego no contesta, el aviso va al lado del cliente y no sobre el botón: un
 * lavadero no deja de recibir carros porque la fidelización esté caída.
 *
 * El cliente puede ser uno de tres:
 *
 *   1. Uno ya registrado, elegido en el buscador (o propuesto por la placa).
 *   2. Uno nuevo, escribiendo nombre y teléfono.
 *   3. Nadie: visitante anónimo, sin ficha.
 *
 * El caso 1 es el que faltaba y el que más se usa: sin él, cada visita de un
 * cliente conocido creaba otra ficha con el mismo nombre, y las visitas, el
 * crédito y el histórico de facturas quedaban repartidos entre duplicados que
 * ya nadie podía volver a juntar.
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

  // Cliente ya registrado. Mientras haya uno elegido, nombre y teléfono son los
  // de su ficha y no se escriben a mano: editarlos aquí daría la ilusión de
  // estar corrigiendo el directorio cuando solo cambiaría el rótulo de la orden.
  const [cliente, setCliente] = useState<CustomerMatch | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<CustomerMatch[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [conocido, setConocido] = useState<VehicleMatch | null>(null);

  // Lo que Membego sabe del cliente elegido: sus vehículos y sus beneficios.
  // Se pide al elegirlo y se vuelve a pedir si cambia la placa, porque la
  // respuesta depende del carro: la misma membresía cubre un sedán y no una SUV.
  const [ficha, setFicha] = useState<FichaMembego | null>(null);
  const [fichaBuscando, setFichaBuscando] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  /** Si la recepción eligió categoría a mano, la placa ya no la cambia. */
  const categoriaTocada = useRef(false);

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

  /**
   * Reconocer el vehículo por la placa.
   *
   * La placa es única por empresa: si aparece, es el mismo carro que ya vino.
   * Se rellenan marca, modelo y color SOLO si están vacíos —nunca se pisa lo que
   * alguien acaba de escribir— y la categoría solo mientras no la hayan tocado a
   * mano. Al dueño NO se le selecciona solo: los carros se venden, y colgar la
   * venta del propietario anterior sin que nadie lo confirme es un error que
   * después nadie encuentra. Se propone con un botón.
   */
  useEffect(() => {
    const p = plate.trim();
    if (normalizePlate(p).length < 4) { setConocido(null); return; }

    let active = true;
    const t = setTimeout(() => {
      lookupVehicleByPlate(p)
        .then(v => {
          if (!active) return;
          setConocido(v);
          if (!v) return;
          setMake(m => m.trim() || v.make);
          setModel(m => m.trim() || v.model);
          setColor(c => c.trim() || v.color);
          if (!categoriaTocada.current) setCategory(v.category);
        })
        .catch(() => { /* el reconocimiento es una ayuda, no un requisito */ });
    }, 350);

    return () => { active = false; clearTimeout(t); };
  }, [plate]);

  // Búsqueda de cliente ya registrado, con espera para no consultar por letra.
  useEffect(() => {
    if (cliente || busqueda.trim().length < 2) { setResultados([]); setBuscando(false); return; }

    let active = true;
    setBuscando(true);
    const t = setTimeout(() => {
      searchCustomers(busqueda)
        .then(rows => { if (active) setResultados(rows); })
        .catch(() => { if (active) setResultados([]); })
        .finally(() => { if (active) setBuscando(false); });
    }, 300);

    return () => { active = false; clearTimeout(t); };
  }, [busqueda, cliente]);

  const elegirCliente = useCallback((c: CustomerMatch) => {
    setCliente(c);
    setCustomerName(c.name);
    setCustomerPhone(c.phone ?? '');
    setBusqueda('');
    setResultados([]);
  }, []);

  const soltarCliente = useCallback(() => {
    setCliente(null);
    setCustomerName('');
    setCustomerPhone('');
    setFicha(null);
    setFichaError(null);
  }, []);

  /**
   * La ficha de Membego del cliente elegido.
   *
   * Depende de la placa: la misma membresía cubre un sedán y no una SUV, así
   * que cambiar el carro cambia la respuesta y hay que volver a preguntar.
   *
   * Si Membego no contesta, se avisa y se sigue. Un lavadero no puede dejar de
   * recibir carros porque un servicio de fidelización esté caído: el error se
   * enseña al lado del cliente, no encima del botón de registrar.
   */
  useEffect(() => {
    const idMembego = cliente?.membego_customer_id;
    if (!idMembego) { setFicha(null); setFichaError(null); return; }

    let active = true;
    setFichaBuscando(true);
    setFichaError(null);
    const t = setTimeout(() => {
      fetchFichaMembego(idMembego, { placa: plate || null })
        .then(f => { if (active) setFicha(f); })
        .catch(err => {
          if (!active) return;
          setFicha(null);
          setFichaError(err instanceof ErrorFichaMembego
            ? err.message
            : 'No se pudo consultar Membego.');
        })
        .finally(() => { if (active) setFichaBuscando(false); });
    }, 300);

    return () => { active = false; clearTimeout(t); };
  }, [cliente, plate]);

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
        // Con ficha elegida el servidor no crea nada: enlaza la orden a ella.
        customerId: cliente?.id ?? null,
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
                onChange={e => { categoriaTocada.current = true; setCategory(e.target.value as VehicleCategory); }}
                className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
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

          {/* ------------------------------------------------------ Cliente */}
          <div className="space-y-3 rounded-xl border border-line bg-canvas/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted uppercase">Cliente</span>
              {cliente && (
                <button onClick={soltarCliente} disabled={busy}
                  className="text-xs font-bold text-muted hover:text-strong underline disabled:opacity-40">
                  Cambiar cliente
                </button>
              )}
            </div>

            {/* El vehículo ya vino antes: se ofrece su dueño, no se impone. */}
            {!cliente && conocido && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info/40 bg-info/10 p-3">
                <p className="text-xs text-body flex items-start gap-2">
                  <History className="w-4 h-4 flex-shrink-0 text-info mt-0.5" />
                  <span>
                    Este vehículo ya está registrado
                    {conocido.make || conocido.model
                      ? ` (${[conocido.make, conocido.model].filter(Boolean).join(' ')})`
                      : ''}
                    {conocido.customer
                      ? <> a nombre de <strong className="text-strong">{conocido.customer.name}</strong>.</>
                      : <>, pero sin cliente asociado.</>}
                  </span>
                </p>
                {conocido.customer && (
                  <button
                    onClick={() => elegirCliente(conocido.customer!)}
                    disabled={busy}
                    className="px-3 py-1.5 bg-brand text-on-accent font-bold rounded-lg text-xs disabled:opacity-40"
                  >
                    Usar este cliente
                  </button>
                )}
              </div>
            )}

            {cliente ? (
              <div className="rounded-xl border border-brand/40 bg-brand-soft/40 p-3">
                <p className="text-sm font-bold text-strong flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-brand-hi" />
                  {cliente.name}
                </p>
                <p className="text-xs text-muted mt-0.5">{cliente.phone || 'Sin teléfono registrado'}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Etiqueta>{cliente.origin === 'membego' ? 'Viene de Membego' : 'Del car wash'}</Etiqueta>
                  {cliente.membego_status === 'active' && <Etiqueta tono="ok">Membresía activa</Etiqueta>}
                  {cliente.credit_enabled && <Etiqueta tono="info">Con crédito</Etiqueta>}
                  <Etiqueta>{cliente.total_visits} {cliente.total_visits === 1 ? 'visita' : 'visitas'}</Etiqueta>
                </div>


                {/* Lo que Membego sabe de él. Aparece solo, sin pedirlo. */}
                {cliente.membego_customer_id && (
                  <div className="mt-3 pt-3 border-t border-brand/30 space-y-2">
                    {fichaBuscando && (
                      <p className="text-xs text-muted flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> Consultando Membego…
                      </p>
                    )}

                    {/* Si Membego no contesta se avisa y se sigue: un lavadero
                        no deja de recibir carros porque la fidelización esté
                        caída. Por eso el aviso vive aquí y no sobre el botón. */}
                    {fichaError && !fichaBuscando && (
                      <p className="text-xs text-warning flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>Membego no respondió ({fichaError}). Puede registrar la llegada igual.</span>
                      </p>
                    )}

                    {ficha?.memberships.map(m => {
                      const cubre = m.coverage?.covers;
                      return (
                        <div key={m.id} className="space-y-1">
                          <p className="text-sm font-bold text-strong flex items-center gap-1.5">
                            <BadgeCheck className="w-4 h-4 text-warning flex-shrink-0" />
                            {m.nombre}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <Etiqueta tono={m.usesLeft > 0 ? 'ok' : undefined}>
                              {m.coverage?.unlimited
                                ? 'Lavados ilimitados'
                                : `${m.usesLeft} ${m.usesLeft === 1 ? 'lavado' : 'lavados'} restantes`}
                            </Etiqueta>
                            {m.expiresAt && (
                              <Etiqueta>
                                Vence {new Date(m.expiresAt).toLocaleDateString('es-DO',
                                  { day: '2-digit', month: 'short', year: 'numeric' })}
                              </Etiqueta>
                            )}
                          </div>

                          {/* El veredicto sobre ESTE carro. `null` es «no se
                              preguntó» —todavía no hay placa— y no se pinta:
                              enseñarlo como «no cubre» sería cobrar de más. */}
                          {cubre === true && (
                            <p className="text-xs text-success font-bold">
                              Cubre este vehículo.
                            </p>
                          )}
                          {cubre === false && (
                            <p className="text-xs text-warning">
                              {m.coverage?.reason === 'VEHICLE_LEVEL_ABOVE_PLAN'
                                ? 'Este vehículo es de categoría superior a la del plan: la diferencia se cobra.'
                                : m.coverage?.reason === 'VEHICLE_NOT_IN_MEMBERSHIP'
                                  ? 'Esta placa no está en su membresía: el lavado se cobra completo.'
                                  : 'Sin lavados disponibles: el lavado se cobra completo.'}
                            </p>
                          )}
                        </div>
                      );
                    })}

                    {ficha && ficha.memberships.length === 0 && !fichaError && (
                      <p className="text-xs text-faint">Sin membresía activa en Membego.</p>
                    )}

                    {ficha && ficha.promotions.filter(p => p.eligible).length > 0 && (
                      <p className="text-xs text-body">
                        <strong>{ficha.promotions.filter(p => p.eligible).length}</strong>{' '}
                        {ficha.promotions.filter(p => p.eligible).length === 1
                          ? 'promoción disponible' : 'promociones disponibles'}
                        : {ficha.promotions.filter(p => p.eligible).map(p => p.nombre).join(' · ')}
                      </p>
                    )}

                    {/* Sus carros en Membego. Tocar uno pone su placa: es lo que
                        la recepción iba a teclear mirando la matrícula. */}
                    {ficha && ficha.vehicles.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-muted uppercase">Sus vehículos</span>
                        <div className="flex flex-wrap gap-1.5">
                          {ficha.vehicles.map(v => (
                            <button key={v.id} type="button" disabled={busy}
                              onClick={() => setPlate(v.placa ?? '')}
                              className={`px-2 py-1 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                                v.placa && normalizePlate(v.placa) === normalizePlate(plate)
                                  ? 'bg-brand text-on-accent border-brand font-bold'
                                  : 'bg-surface border-line text-body hover:border-brand'
                              }`}>
                              <strong>{v.placa ?? 'sin placa'}</strong>
                              {(v.marca || v.modelo) && (
                                <span className="font-normal opacity-80"> · {[v.marca, v.modelo].filter(Boolean).join(' ')}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* El carro figura a nombre de otro. Puede ser correcto —lo trae
                    un familiar, se vendió— pero se avisa: colgar la venta de
                    quien no es sin que nadie lo vea es lo que hay que evitar. */}
                {conocido?.customer && conocido.customer.id !== cliente.id && (
                  <p role="status" className="mt-2 text-xs text-warning flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Ojo: la placa {conocido.plate} figura a nombre de{' '}
                      <strong>{conocido.customer.name}</strong>. La orden se cobrará a{' '}
                      <strong>{cliente.name}</strong>.
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="na-buscar" className="text-xs font-semibold text-muted uppercase">
                    Buscar cliente registrado
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      id="na-buscar" type="search" value={busqueda} disabled={busy}
                      onChange={e => setBusqueda(e.target.value)}
                      placeholder="Nombre o teléfono…"
                      autoComplete="off"
                      className="w-full bg-canvas border border-line rounded-xl pl-9 pr-4 py-2.5 text-sm text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50"
                    />
                  </div>

                  {/* Lo que salga se anuncia: quien usa lector de pantalla no ve
                      aparecer la lista debajo del campo. */}
                  <div aria-live="polite" className="space-y-1.5">
                    {buscando && (
                      <p className="text-xs text-faint flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> Buscando…
                      </p>
                    )}
                    {!buscando && busqueda.trim().length >= 2 && resultados.length === 0 && (
                      <p className="text-xs text-faint italic">
                        Ningún cliente coincide. Puede registrarlo abajo como nuevo.
                      </p>
                    )}
                    {resultados.map(c => (
                      <button
                        key={c.id}
                        onClick={() => elegirCliente(c)}
                        disabled={busy}
                        className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-line bg-surface hover:border-brand text-left transition-colors disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-strong truncate">{c.name}</span>
                          <span className="block text-xs text-muted">
                            {c.phone || 'Sin teléfono'} · {c.total_visits} {c.total_visits === 1 ? 'visita' : 'visitas'}
                          </span>
                        </span>
                        <span className="flex flex-wrap justify-end gap-1.5">
                          {c.origin === 'membego' && <Etiqueta>Membego</Etiqueta>}
                          {c.credit_enabled && <Etiqueta tono="info">Crédito</Etiqueta>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 border-t border-line">
                  <div className="space-y-1.5 pt-3">
                    {/* «Cliente nuevo» y no «Cliente» a secas: con un buscador
                        justo encima, dos campos llamados igual no se distinguen
                        —ni a la vista ni con lector de pantalla—. */}
                    <label htmlFor="na-cust" className="text-xs font-semibold text-muted uppercase">
                      Cliente nuevo
                    </label>
                    <input id="na-cust" type="text" value={customerName} disabled={busy}
                      onChange={e => setCustomerName(e.target.value)} placeholder="Cliente General"
                      className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50" />
                  </div>
                  <div className="space-y-1.5 md:pt-3">
                    <label htmlFor="na-phone" className="text-xs font-semibold text-muted uppercase">Teléfono</label>
                    <input id="na-phone" type="tel" value={customerPhone} disabled={busy}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50" />
                  </div>
                </div>
                <p className="text-xs text-faint">
                  Si no pone nada, la orden queda como visitante sin ficha.
                </p>
              </>
            )}
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
