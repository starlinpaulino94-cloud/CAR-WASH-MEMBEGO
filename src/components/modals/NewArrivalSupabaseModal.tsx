import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import {
  X, Car, Loader2, AlertCircle, Search, UserCheck, History, Check, ChevronDown, ChevronUp, Printer, UserPlus
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import { accionDeTecla, conservarSeleccion, duenoPropuesto } from '../../lib/llegada';
import {
  createWorkOrder, fetchOperators, fetchServicesForCategory, VehicleCategory, WorkOrder
} from '../../data/ordersRepository';
import { fetchVehicleCategoryLevels, NivelesPorCategoria } from '../../data/adminRepository';
import { useVehicleCategories } from '../../hooks/useVehicleCategories';
import { useCategoriasServicio } from '../../hooks/useCategoriasServicio';
import { filtrarServicios, categoriasConServicios, TODAS } from '../../lib/filtroServicios';
import { FiltroCategoriaServicio } from '../common/FiltroCategoriaServicio';
import {
  lookupVehicleByPlate, normalizePlate, searchCustomers, fetchFichaMembego,
  CustomerMatch, VehicleMatch, FichaMembego, ErrorFichaMembego
} from '../../data/customersRepository';
import { PanelFichaMembego } from '../common/FichaMembego';
import { ComandaOrdenModal } from './ComandaOrdenModal';

interface Props {
  onClose: () => void;
  onCreated: (order: WorkOrder) => void;
}

interface ServiceOption {
  id: string;
  name: string;
  /** El `code` de su categoría de servicio. Vacío = sin clasificar. */
  category: string;
  description: string;
  price_cents: number;
  estimated_minutes: number;
}

/** Distintivo corto de la ficha del cliente. Texto, no solo color. */
const Etiqueta: React.FC<{ children: React.ReactNode; tono?: 'ok' | 'info' | 'brand' }> = ({ children, tono }) => (
  <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${
    tono === 'ok'   ? 'bg-success/15 border-success/40 text-success'
    : tono === 'info' ? 'bg-info/15 border-info/40 text-info'
    : tono === 'brand' ? 'bg-brand/15 border-brand/40 text-brand-hi'
    : 'bg-surface-2 border-line text-muted'
  }`}>
    {children}
  </span>
);

/** Título de cada zona del formulario: número, nombre y lo que ya se sabe. */
const Zona: React.FC<{ n: number; titulo: string; resumen?: React.ReactNode; children: React.ReactNode }> =
  ({ n, titulo, resumen, children }) => (
    <section aria-label={titulo} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-brand/20 text-brand-hi text-[11px] flex items-center justify-center">{n}</span>
          {titulo}
        </h3>
        {resumen && <span className="text-xs text-faint truncate">{resumen}</span>}
      </div>
      {children}
    </section>
  );

const CAMPO =
  'w-full bg-canvas border border-line rounded-xl px-4 py-3 text-sm text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50';

/**
 * Registro de llegada.
 *
 * Crear cliente, vehículo, orden y líneas ocurre en una sola transacción del
 * servidor. El formulario está ordenado como ocurre la llegada, no como está
 * la base de datos:
 *
 *   1. EL CARRO — la placa primero y en grande. Con ella se reconoce el carro
 *      que ya vino: marca, modelo, color, categoría y dueño salen solos.
 *   2. EL CLIENTE — plegado. La mayoría de las llegadas son «Cliente General»
 *      y no tiene sentido cruzar un buscador y dos campos para dejarlos vacíos.
 *      Se abre cuando la placa trae dueño o cuando el mostrador lo pide.
 *   3. EL SERVICIO — qué se lava, quién lo lava y alguna observación.
 *
 * Y un pie fijo con el total y el botón que registra e imprime la comanda:
 * el camino corto es placa → servicio → registrar, tres toques en la tablet o
 * placa, Enter, servicio, Ctrl+Enter en la caja.
 *
 * Al elegir un cliente que viene de Membego se le pregunta a Membego, en vivo,
 * qué tiene: membresía, promociones, vehículos y si cubre ESTE carro. Nada de
 * eso se guarda —los beneficios no se proyectan— y si Membego no contesta, el
 * aviso va al lado del cliente y no sobre el botón: un lavadero no deja de
 * recibir carros porque la fidelización esté caída.
 */
export const NewArrivalSupabaseModal: React.FC<Props> = ({ onClose, onCreated }) => {
  const { branch, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [plate, setPlate] = useState('');
  const CATEGORIES = useVehicleCategories();
  const { categorias: catsServicio } = useCategoriasServicio();
  /** Tipo de trabajo por el que está filtrada la rejilla de servicios. */
  const [filtroTipo, setFiltroTipo] = useState<string>(TODAS);
  const [category, setCategory] = useState<VehicleCategory>('sedan');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Los lavadores de la sucursal y los elegidos para este carro. */
  const [operarios, setOperarios] = useState<{ id: string; full_name: string }[]>([]);
  const [lavadores, setLavadores] = useState<Set<string>>(new Set());
  /** La orden recién registrada: mientras exista se enseña su comanda. */
  const [creada, setCreada] = useState<WorkOrder | null>(null);
  /** Aviso cuando la llegada entró pero el lavador no se pudo asignar. */
  const [avisoLavador, setAvisoLavador] = useState<string | null>(null);

  // Qué partes secundarias están abiertas. Cerradas por defecto: el camino
  // corto no las necesita y en una tablet cada bloque abierto es un scroll.
  const [detallesCarro, setDetallesCarro] = useState(false);
  const [clienteAbierto, setClienteAbierto] = useState(false);
  const [notasAbiertas, setNotasAbiertas] = useState(false);

  // Cliente ya registrado. Mientras haya uno elegido, nombre y teléfono son los
  // de su ficha y no se escriben a mano: editarlos aquí daría la ilusión de
  // estar corrigiendo el directorio cuando solo cambiaría el rótulo de la orden.
  const [cliente, setCliente] = useState<CustomerMatch | null>(null);
  /** `true` si lo eligió el mostrador; `false` si lo propuso la placa. */
  const clienteAMano = useRef(false);
  /** `true` mientras el cliente en pantalla sea el que propuso la placa. */
  const [duenoPorPlaca, setDuenoPorPlaca] = useState(false);
  /** Placa cuyo dueño propuesto se quitó con «Sin cliente». */
  const placaRechazada = useRef<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<CustomerMatch[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [conocido, setConocido] = useState<VehicleMatch | null>(null);
  const [buscandoPlaca, setBuscandoPlaca] = useState(false);

  // Lo que Membego sabe del cliente elegido: sus vehículos y sus beneficios.
  // Se pide al elegirlo y se vuelve a pedir si cambia la placa, porque la
  // respuesta depende del carro: la misma membresía cubre un sedán y no una SUV.
  const [ficha, setFicha] = useState<FichaMembego | null>(null);
  const [fichaBuscando, setFichaBuscando] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);
  // El nivel tarifario de cada categoría, configurado en Ajustes › Membego. Sin
  // él la cobertura no se puede decidir por categoría, solo por placa.
  const [niveles, setNiveles] = useState<NivelesPorCategoria>({});

  useEffect(() => {
    fetchVehicleCategoryLevels()
      .then(setNiveles)
      .catch(() => { /* sin niveles se decide solo por placa: no es un fallo */ });
  }, []);

  // Los lavadores de la sucursal. Si falla, la llegada se registra igual sin
  // asignar: recibir el carro no puede depender de esta lista.
  useEffect(() => {
    if (!branch) return;
    let activo = true;
    fetchOperators(branch.id)
      .then(rows => { if (activo) setOperarios(rows.map(r => ({ id: r.id, full_name: r.full_name }))); })
      .catch(() => { if (activo) setOperarios([]); });
    return () => { activo = false; };
  }, [branch]);

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const serviciosRef = useRef<HTMLDivElement>(null);
  /** Si la recepción eligió categoría a mano, la placa ya no la cambia. */
  const categoriaTocada = useRef(false);
  /** `true` mientras la categoría en pantalla sea la que reconoció la placa. */
  const [categoriaPorPlaca, setCategoriaPorPlaca] = useState(false);

  // Clave de idempotencia de ESTA llegada: se conserva entre reintentos para
  // que un fallo de red no acabe registrando el mismo vehículo dos veces.
  const requestId = useRef<string>(crypto.randomUUID());

  // El catálogo de la categoría. Al cambiar, lo marcado se CONSERVA si sigue
  // existiendo: la placa cambia la categoría sola medio segundo después de
  // escribirla, y borrar la selección ahí era perder lo que el mostrador acababa
  // de marcar sin que nadie lo viera.
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchServicesForCategory(category)
      .then(rows => {
        if (!active) return;
        setServices(rows as ServiceOption[]);
        setSelected(prev => conservarSeleccion(prev, rows));
      })
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
   * mano. El dueño se propone en otro efecto, con sus propias reglas.
   */
  useEffect(() => {
    const p = plate.trim();
    if (normalizePlate(p).length < 4) { setConocido(null); setBuscandoPlaca(false); return; }

    let active = true;
    setBuscandoPlaca(true);
    const t = setTimeout(() => {
      lookupVehicleByPlate(p)
        .then(v => {
          if (!active) return;
          setConocido(v);
          if (!v) return;
          setMake(m => m.trim() || v.make);
          setModel(m => m.trim() || v.model);
          setColor(c => c.trim() || v.color);
          if (!categoriaTocada.current) { setCategory(v.category); setCategoriaPorPlaca(true); }
        })
        .catch(() => { /* el reconocimiento es una ayuda, no un requisito */ })
        .finally(() => { if (active) setBuscandoPlaca(false); });
    }, 350);

    return () => { active = false; clearTimeout(t); };
  }, [plate]);

  /**
   * El dueño de la placa se elige SOLO.
   *
   * Y se suelta solo también: si la placa cambia y el cliente en pantalla lo
   * había puesto la placa anterior, se quita con su nombre y teléfono — ese
   * cliente era de OTRO carro y dejarlo crearía una ficha nueva a su nombre.
   * Lo que eligió o escribió el mostrador a mano no se toca nunca.
   */
  useEffect(() => {
    if (clienteAMano.current) return;
    const propuesto = duenoPropuesto(conocido, {
      elegidoAMano: false,
      // Si el nombre en pantalla lo puso la placa anterior, no cuenta como escrito.
      nombreEscrito: duenoPorPlaca ? '' : customerName,
      telefonoEscrito: duenoPorPlaca ? '' : customerPhone,
      placaRechazada: placaRechazada.current
    });
    if (propuesto) {
      setCliente(propuesto);
      setCustomerName(propuesto.name);
      setCustomerPhone(propuesto.phone ?? '');
      setDuenoPorPlaca(true);
    } else if (duenoPorPlaca) {
      setCliente(null);
      setCustomerName('');
      setCustomerPhone('');
      setDuenoPorPlaca(false);
    }
    // Solo reacciona al carro reconocido: nombre y teléfono se leen en ese
    // momento y no deben volver a disparar la propuesta al escribirlos.
  }, [conocido]); // eslint-disable-line react-hooks/exhaustive-deps

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
    clienteAMano.current = true;
    setDuenoPorPlaca(false);
    setCliente(c);
    setCustomerName(c.name);
    setCustomerPhone(c.phone ?? '');
    setBusqueda('');
    setResultados([]);
  }, []);

  /** Quitar el cliente. Si era el propuesto por la placa, no se vuelve a proponer. */
  const soltarCliente = useCallback((abrirBuscador: boolean) => {
    if (!clienteAMano.current && conocido) placaRechazada.current = conocido.plate;
    clienteAMano.current = false;
    setDuenoPorPlaca(false);
    setCliente(null);
    setCustomerName('');
    setCustomerPhone('');
    setFicha(null);
    setFichaError(null);
    setClienteAbierto(abrirBuscador);
  }, [conocido]);

  /**
   * La ficha de Membego del cliente elegido.
   *
   * Depende de la placa: la misma membresía cubre un sedán y no una SUV, así
   * que cambiar el carro cambia la respuesta y hay que volver a preguntar.
   */
  useEffect(() => {
    const idMembego = cliente?.membego_customer_id;
    if (!idMembego) { setFicha(null); setFichaError(null); return; }

    let active = true;
    setFichaBuscando(true);
    setFichaError(null);
    const t = setTimeout(() => {
      fetchFichaMembego(idMembego, {
        placa: plate || null,
        // `undefined` si esa categoría no tiene nivel: mandar un 1 inventado
        // haría que Membego diera por cubierto un camión.
        nivelVehiculo: niveles[category] ?? null
      })
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
  }, [cliente, plate, category, niveles]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Lo filtrado, MÁS lo que ya esté marcado aunque sea de otro tipo. Si el
  // filtro escondiera un servicio ya elegido, el pie sumaría un importe cuya
  // línea no se ve por ninguna parte: el mostrador no podría quitarla.
  const serviciosVisibles = useMemo(() => {
    const filtrados = filtrarServicios(services, { categoria: filtroTipo });
    const dentro = new Set(filtrados.map(s => s.id));
    return [...filtrados, ...services.filter(s => selected.has(s.id) && !dentro.has(s.id))];
  }, [services, filtroTipo, selected]);

  const tiposDeServicio = useMemo(
    () => categoriasConServicios(services, catsServicio),
    [services, catsServicio]
  );

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
      const { order, lavadoresOmitidos } = await createWorkOrder({
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
        notes: notes.trim() || null,
        assignees: [...lavadores]
      });
      // Si la base aún no acepta lavadores, la llegada entró igual pero SIN
      // asignar. Se dice claramente, porque la comanda va a salir sin nombre y
      // el mostrador tiene que saber por qué antes de entregársela al cliente.
      if (lavadoresOmitidos) {
        setAvisoLavador(
          'La llegada se registró, pero el lavador no quedó asignado: falta aplicar ' +
          'una actualización pendiente en la base de datos. Asígnalo en el tablero.'
        );
      }
      // La comanda sale SOLA al registrar: si hubiera que ir a buscarla a
      // otro sitio, el carro entraría al patio sin papel y el lavador sin
      // saber que es suyo. El padre se entera al cerrarla.
      setCreada(order);
    } catch (err) {
      // La clave NO se renueva: reintentar debe reconocerse como el mismo registro.
      setError(err instanceof Error ? err.message : 'No se pudo registrar la llegada');
    } finally {
      setBusy(false);
    }
  };
  // Para que el atajo de teclado llame siempre a la versión actual sin volver
  // a registrar el oyente en cada tecleo.
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;

  const irAServicios = useCallback(() => {
    const primero = serviciosRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    primero?.focus();
  }, []);

  // Diálogo accesible: foco inicial, Escape, foco atrapado y atajos de la caja.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { onClose(); return; }
      const accion = accionDeTecla(e, document.activeElement === firstFieldRef.current);
      if (accion === 'registrar') { e.preventDefault(); void submitRef.current(); return; }
      if (accion === 'irAServicios') { e.preventDefault(); irAServicios(); return; }
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
  }, [onClose, busy, irAServicios]);

  if (creada) {
    return (
      <ComandaOrdenModal
        aviso={avisoLavador}
        order={creada}
        company={company}
        branch={branch}
        lavadores={operarios.filter(o => lavadores.has(o.id)).map(o => o.full_name)}
        onClose={() => onCreated(creada)}
      />
    );
  }

  const categoriaLabel = CATEGORIES.find(c => c.id === category)?.label ?? category;
  const carroTexto = [make, model].filter(s => s.trim()).join(' ');
  const placaLista = normalizePlate(plate).length >= 4;
  const lavadoresElegidos = operarios.filter(o => lavadores.has(o.id)).map(o => o.full_name);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-canvas/80 backdrop-blur-md p-0 sm:p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar llegada de vehículo"
        className="bg-surface border-0 sm:border border-line w-full sm:max-w-2xl rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[100dvh] sm:h-auto sm:max-h-[92vh]"
      >
        <div className="bg-gradient-to-r from-brand-soft/50 to-surface px-4 sm:px-6 py-3 sm:py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/30 text-brand rounded-xl border border-brand/30">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-strong">Registrar llegada</h2>
              <p className="text-xs text-muted">{branch?.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 sm:p-6 space-y-6 overflow-y-auto flex-1">
          {/* ================================================== 1 · EL CARRO */}
          <Zona n={1} titulo="El carro">
            <div className="space-y-1.5">
              <label htmlFor="na-plate" className="text-xs font-semibold text-muted uppercase">Placa *</label>
              <input
                id="na-plate" ref={firstFieldRef} type="text" value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())}
                disabled={busy}
                autoComplete="off" autoCapitalize="characters" enterKeyHint="next" spellCheck={false}
                placeholder="A123456"
                className="w-full bg-canvas border-2 border-line rounded-xl px-4 py-3 text-2xl font-black tracking-[0.2em] text-strong uppercase placeholder-faint/60 focus:outline-none focus:border-brand disabled:opacity-50"
              />
              {/* Qué se sabe de ese carro. Se anuncia: es lo que decide si hay
                  que escribir algo más o pasar directo al servicio. */}
              <div aria-live="polite" className="min-h-[1.25rem]">
                {placaLista && buscandoPlaca && (
                  <p className="text-xs text-faint flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Buscando la placa…
                  </p>
                )}
                {placaLista && !buscandoPlaca && conocido && (
                  <p className="text-xs text-info flex items-start gap-1.5">
                    <History className="w-4 h-4 flex-shrink-0 mt-px" />
                    <span>
                      Ya vino antes
                      {(conocido.make || conocido.model || conocido.color)
                        ? <>: <strong className="text-strong">{[conocido.make, conocido.model, conocido.color].filter(Boolean).join(' ')}</strong></>
                        : ''}
                      {conocido.customer
                        ? <>, de <strong className="text-strong">{conocido.customer.name}</strong>.</>
                        : <>, sin cliente asociado.</>}
                    </span>
                  </p>
                )}
                {placaLista && !buscandoPlaca && !conocido && (
                  <p className="text-xs text-faint">Carro nuevo: primera visita con esta placa.</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase">
                Categoría
                {categoriaPorPlaca && !categoriaTocada.current && (
                  <span className="ml-1 normal-case font-normal text-faint">(según la placa)</span>
                )}
              </span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Categoría del vehículo">
                {CATEGORIES.map(c => {
                  const on = c.id === category;
                  return (
                    <button key={c.id} type="button" disabled={busy} aria-pressed={on}
                      onClick={() => { categoriaTocada.current = true; setCategoriaPorPlaca(false); setCategory(c.id); }}
                      className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-50 ${
                        on ? 'bg-brand text-on-accent border-brand'
                           : 'bg-surface border-line text-body hover:border-brand'
                      }`}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Marca, modelo y color: opcionales y plegados. Si la placa los
                trajo se ven en el resumen sin abrir nada. */}
            <div>
              <button type="button" disabled={busy}
                onClick={() => setDetallesCarro(v => !v)}
                aria-expanded={detallesCarro}
                className="text-xs font-semibold text-muted hover:text-strong flex items-center gap-1.5 disabled:opacity-50">
                {detallesCarro ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Marca, modelo y color
                {!detallesCarro && (carroTexto || color) && (
                  <span className="font-normal text-faint">· {[carroTexto, color].filter(Boolean).join(' · ')}</span>
                )}
                {!detallesCarro && !carroTexto && !color && (
                  <span className="font-normal text-faint">· opcional</span>
                )}
              </button>
              {detallesCarro && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <div className="space-y-1.5">
                    <label htmlFor="na-make" className="text-xs font-semibold text-muted uppercase">Marca</label>
                    <input id="na-make" type="text" value={make} disabled={busy}
                      onChange={e => setMake(e.target.value)} className={CAMPO} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="na-model" className="text-xs font-semibold text-muted uppercase">Modelo</label>
                    <input id="na-model" type="text" value={model} disabled={busy}
                      onChange={e => setModel(e.target.value)} className={CAMPO} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="na-color" className="text-xs font-semibold text-muted uppercase">Color</label>
                    <input id="na-color" type="text" value={color} disabled={busy}
                      onChange={e => setColor(e.target.value)} className={CAMPO} />
                  </div>
                </div>
              )}
            </div>
          </Zona>

          {/* ================================================ 2 · EL CLIENTE */}
          <Zona n={2} titulo="El cliente">
            {cliente ? (
              <div className="rounded-xl border border-brand/40 bg-brand-soft/40 p-3 sm:p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-strong flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-brand-hi flex-shrink-0" />
                      <span className="truncate">{cliente.name}</span>
                    </p>
                    <p className="text-xs text-muted mt-0.5">{cliente.phone || 'Sin teléfono registrado'}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => soltarCliente(true)} disabled={busy}>
                      Cambiar
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted" onClick={() => soltarCliente(false)} disabled={busy}>
                      Sin cliente
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {duenoPorPlaca && <Etiqueta tono="brand">Dueño según la placa</Etiqueta>}
                  <Etiqueta>{cliente.origin === 'membego' ? 'Viene de Membego' : 'Del car wash'}</Etiqueta>
                  {cliente.membego_status === 'active' && <Etiqueta tono="ok">Membresía activa</Etiqueta>}
                  {cliente.credit_enabled && <Etiqueta tono="info">Con crédito</Etiqueta>}
                  <Etiqueta>{cliente.total_visits} {cliente.total_visits === 1 ? 'visita' : 'visitas'}</Etiqueta>
                </div>

                {/* Lo que Membego sabe de él. Aparece solo, sin pedirlo.
                    El panel es el mismo que ve la caja: el que recibe y el que
                    cobra no pueden ver saldos distintos del mismo cliente. */}
                {cliente.membego_customer_id && (
                  <div className="pt-3 border-t border-brand/30">
                    <PanelFichaMembego
                      ficha={ficha} error={fichaError} buscando={fichaBuscando}
                      placa={plate} onElegirPlaca={setPlate} disabled={busy}
                    />
                  </div>
                )}

                {/* El carro figura a nombre de otro. Puede ser correcto —lo trae
                    un familiar, se vendió— pero se avisa: colgar la venta de
                    quien no es sin que nadie lo vea es lo que hay que evitar. */}
                {conocido?.customer && conocido.customer.id !== cliente.id && (
                  <p role="status" className="text-xs text-warning flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Ojo: la placa {conocido.plate} figura a nombre de{' '}
                      <strong>{conocido.customer.name}</strong>. La orden se cobrará a{' '}
                      <strong>{cliente.name}</strong>.
                    </span>
                  </p>
                )}
              </div>
            ) : !clienteAbierto ? (
              // Plegado: el caso más común es no poner a nadie. Una línea que
              // dice cómo queda y un botón para quien sí quiera buscar.
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/40 p-3">
                <p className="text-sm text-body">
                  {customerName.trim()
                    ? <><strong className="text-strong">{customerName.trim()}</strong>{customerPhone.trim() ? ` · ${customerPhone.trim()}` : ''} <span className="text-faint">(cliente nuevo)</span></>
                    : <><strong className="text-strong">Cliente General</strong> <span className="text-faint">· sin ficha</span></>}
                </p>
                <div className="flex gap-1.5">
                  {conocido?.customer && (
                    <Button variant="outline" size="sm" onClick={() => elegirCliente(conocido.customer!)} disabled={busy}>
                      Usar a {conocido.customer.name.split(' ')[0]}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setClienteAbierto(true)} disabled={busy}>
                    <UserPlus className="w-3.5 h-3.5" /> {customerName.trim() ? 'Editar' : 'Buscar o registrar'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-line bg-canvas/40 p-3 sm:p-4">
                <div className="space-y-1.5">
                  <label htmlFor="na-buscar" className="text-xs font-semibold text-muted uppercase">
                    Buscar cliente registrado
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      id="na-buscar" type="search" value={busqueda} disabled={busy} autoFocus
                      onChange={e => setBusqueda(e.target.value)}
                      placeholder="Nombre o teléfono…"
                      autoComplete="off"
                      className={`${CAMPO} pl-9`}
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
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-surface hover:border-brand text-left transition-colors disabled:opacity-50"
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-line">
                  <div className="space-y-1.5">
                    {/* «Cliente nuevo» y no «Cliente» a secas: con un buscador
                        justo encima, dos campos llamados igual no se distinguen
                        —ni a la vista ni con lector de pantalla—. */}
                    <label htmlFor="na-cust" className="text-xs font-semibold text-muted uppercase">
                      Cliente nuevo
                    </label>
                    <input id="na-cust" type="text" value={customerName} disabled={busy}
                      onChange={e => setCustomerName(e.target.value)} placeholder="Nombre"
                      className={CAMPO} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="na-phone" className="text-xs font-semibold text-muted uppercase">Teléfono</label>
                    <input id="na-phone" type="tel" value={customerPhone} disabled={busy}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className={CAMPO} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-faint">
                    Si no pone nada, la orden queda como Cliente General.
                  </p>
                  <Button variant="ghost" size="xs" className="text-muted" onClick={() => setClienteAbierto(false)} disabled={busy}>
                    <ChevronUp className="w-3.5 h-3.5" /> Cerrar
                  </Button>
                </div>
              </div>
            )}
          </Zona>

          {/* =============================================== 3 · EL SERVICIO */}
          <Zona n={3} titulo="El servicio" resumen={`Precios de ${categoriaLabel}`}>
            {!loading && services.length > 0 && (
              <FiltroCategoriaServicio
                categorias={tiposDeServicio}
                valor={filtroTipo}
                onCambiar={setFiltroTipo}
                total={services.length}
                disabled={busy}
                grande
              />
            )}

            <div ref={serviciosRef}>
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-16 bg-canvas border border-line rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : services.length === 0 ? (
                <p className="text-xs text-faint italic py-6 text-center">
                  No hay servicios con precio para {categoriaLabel}.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="group" aria-label="Servicios">
                  {serviciosVisibles.map(s => {
                    const on = selected.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggle(s.id)}
                        aria-pressed={on}
                        disabled={busy}
                        className={`min-h-[64px] p-3.5 rounded-xl border-2 text-left transition-all disabled:opacity-50 ${
                          on
                            ? 'bg-brand-soft/50 border-brand text-strong'
                            : 'bg-canvas/60 border-line text-body hover:border-line-strong'
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-bold text-sm flex items-center gap-1.5">
                            <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                              on ? 'bg-brand border-brand text-on-accent' : 'border-line-strong'
                            }`} aria-hidden="true">
                              {on && <Check className="w-3.5 h-3.5" />}
                            </span>
                            {s.name}
                          </span>
                          <span className="text-sm font-bold text-brand-hi whitespace-nowrap">
                            {formatCents(s.price_cents, symbol)}
                          </span>
                        </span>
                        <span className="block text-xs text-faint mt-1 pl-6">
                          ~{s.estimated_minutes} min
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Lavador. Se elige aquí, en la llegada, porque es lo que va impreso
                en la comanda que el cliente le entrega. Es opcional: recibir el
                carro no puede quedarse bloqueado porque aún no se sepa quién lo
                lava — el tablero permite decidirlo al iniciar. */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase">
                Lavador
                <span className="ml-1 normal-case font-normal text-faint">(opcional)</span>
              </span>
              {operarios.length === 0 ? (
                <p className="text-xs text-faint italic">
                  Todavía no hay lavadores. Se dan de alta en <strong>Personal →
                  Empleados</strong>, con el botón «Nuevo empleado» y el rol
                  «Operario (lavador)».
                </p>
              ) : (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Lavador asignado">
                  {operarios.map(o => {
                    const on = lavadores.has(o.id);
                    return (
                      <button key={o.id} type="button" disabled={busy}
                        aria-pressed={on}
                        onClick={() => setLavadores(prev => {
                          const next = new Set(prev);
                          if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                          return next;
                        })}
                        className={`px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-50 ${
                          on ? 'bg-brand text-on-accent border-brand'
                             : 'bg-surface border-line text-body hover:border-brand'
                        }`}>
                        {o.full_name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <button type="button" disabled={busy}
                onClick={() => setNotasAbiertas(v => !v)}
                aria-expanded={notasAbiertas}
                className="text-xs font-semibold text-muted hover:text-strong flex items-center gap-1.5 disabled:opacity-50">
                {notasAbiertas ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Observaciones
                {!notasAbiertas && (
                  <span className="font-normal text-faint truncate max-w-[16rem]">
                    · {notes.trim() || 'opcional'}
                  </span>
                )}
              </button>
              {notasAbiertas && (
                <textarea id="na-notes" rows={2} value={notes} disabled={busy} autoFocus
                  aria-label="Observaciones"
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Ej: cuidado con la pintura de la puerta izquierda…"
                  className={`${CAMPO} mt-2 text-xs`} />
              )}
            </div>
          </Zona>

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

        {/* Pie fijo: lo que va a quedar registrado y el botón. Siempre a la
            vista, se esté donde se esté del formulario. */}
        <div className="bg-canvas/60 px-4 sm:px-6 py-3 sm:py-4 border-t border-line flex items-center justify-between gap-3">
          <div className="text-xs text-muted min-w-0">
            {selected.size > 0 ? (
              <>
                <p className="text-strong font-bold text-base leading-tight">
                  {formatCents(preview.subtotal, symbol)}
                  <span className="text-faint font-normal text-xs"> · ~{preview.minutes} min</span>
                </p>
                <p className="text-faint truncate">
                  {plate.trim() || 'Sin placa'} · {categoriaLabel} · {selected.size} {selected.size === 1 ? 'servicio' : 'servicios'}
                  {lavadoresElegidos.length > 0 ? ` · ${lavadoresElegidos.join(', ')}` : ''}
                </p>
              </>
            ) : (
              <p className="text-faint">
                {plate.trim() ? 'Marque al menos un servicio' : 'Escriba la placa y marque un servicio'}
                <span className="hidden md:inline"> · Ctrl+Enter registra</span>
              </p>
            )}
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex-shrink-0 px-5 py-3 bg-success hover:bg-success disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold rounded-xl text-sm shadow-lg shadow-success/30 transition-all flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {busy ? 'Registrando…' : 'Registrar e imprimir'}
          </button>
        </div>
      </div>
    </div>
  );
};
