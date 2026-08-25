import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import {
  ShoppingBag, Plus, Minus, Trash2, CreditCard, Banknote, Building,
  Landmark, ClipboardList, X as XIcon, Search, UserCheck,
  CheckCircle2, Loader2, AlertCircle, RefreshCw, Receipt, BadgeCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents, centsToInput, desglosarItbis, bpsToPercent } from '../../lib/money';
import { validatePromotion, PromotionPreview } from '../../data/promotionRepository';
import {
  fetchServices, fetchProducts, fetchOpenCashSession, createInvoice, fetchFiscalStatus,
  fetchChargeableOrders, ChargeableOrder,
  lookupMembegoByPhone, fetchServicePricesForCategory, canjearEnMembego,
  ServiceWithPrice, Product, CashSession, CartLine, VehicleCategory, PaymentMethod, Invoice,
  FiscalStatus, MembegoBenefitSummary
} from '../../data/billingRepository';
import { fetchCreditStatus, CreditStatus } from '../../data/creditRepository';
import {
  fetchCustomerById, searchCustomers, fetchFichaMembego,
  CustomerMatch, FichaMembego, ErrorFichaMembego
} from '../../data/customersRepository';
import { fetchVehicleCategoryLevels, NivelesPorCategoria } from '../../data/adminRepository';
import { aplicarCobertura, categoriaTopeDelPlan } from '../../lib/coberturaMembego';
import { PanelFichaMembego } from '../common/FichaMembego';
import { useVehicleCategories } from '../../hooks/useVehicleCategories';

const ESTADO_ORDEN: Record<string, string> = {
  pendiente: 'Recién llegado', en_espera: 'En espera', asignada: 'Asignada',
  en_proceso: 'Lavándose', control_calidad: 'En revisión', listo: 'Listo para entregar',
  entregado: 'Entregado'
};

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
  { id: 'transferencia', label: 'Transfer', icon: Building },
  // Fiar exige cliente identificado: la base lo rechaza si no lo hay, y con
  // razón —una deuda sin deudor no se puede cobrar—. El botón se deshabilita
  // solo hasta que se elige la ficha.
  { id: 'credito', label: 'Crédito', icon: Landmark }
];

/**
 * Punto de venta sobre Supabase.
 *
 * Diferencias de fondo con la versión sobre localStorage:
 *  - Los importes son centavos enteros de principio a fin.
 *  - El cobro va por `create_invoice`, que es atómico e idempotente.
 *  - Los totales que se ven aquí son una PREVISUALIZACIÓN; el importe válido
 *    es el que devuelve el servidor tras emitir.
 *  - El botón se bloquea mientras hay una emisión en curso y la clave de
 *    idempotencia se genera una vez por operación, no por intento.
 */
export const PosSupabaseView: React.FC = () => {
  const { profile, company, branch } = useAuth();

  const CATEGORIES = useVehicleCategories();
  const [category, setCategory] = useState<VehicleCategory>('sedan');
  const [tab, setTab] = useState<'services' | 'products'>('services');
  // Buscador del catálogo. Con decenas de servicios cargados, recorrer la
  // cuadrícula a ojo es lento; el cajero teclea parte del nombre y filtra.
  const [catalogSearch, setCatalogSearch] = useState('');

  const [services, setServices] = useState<ServiceWithPrice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [session, setSession] = useState<CashSession | null>(null);
  // Facturación fiscal: mientras no haya rangos NCF cargados, el cobro queda
  // desactivado y se avisa. Se enciende solo en cuanto existan (ver fiscal_status).
  const [fiscal, setFiscal] = useState<FiscalStatus>({ ready: false, types: [] });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [customerTaxId, setCustomerTaxId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [tenderedInput, setTenderedInput] = useState('');
  const [wantsNcf, setWantsNcf] = useState(false);

  // --- Cobro de una orden de trabajo ya registrada
  const [orden, setOrden] = useState<ChargeableOrder | null>(null);
  const [ordenes, setOrdenes] = useState<ChargeableOrder[]>([]);
  const [buscarOrden, setBuscarOrden] = useState('');
  const [ordenesBusy, setOrdenesBusy] = useState(false);
  // La ficha del cliente, no su nombre escrito a mano: sin ella no hay historial
  // de facturas ni se puede fiar.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [credito, setCredito] = useState<CreditStatus | null>(null);

  // --- Cliente ya registrado, para la venta de mostrador
  // Antes la ficha solo podía llegar por una orden. En una venta suelta el campo
  // «Cliente» era texto que no enlazaba con nada: la factura no entraba en su
  // historial y fiar era imposible aunque tuviera cupo autorizado.
  const [cliente, setCliente] = useState<CustomerMatch | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<CustomerMatch[]>([]);
  const [buscando, setBuscando] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);

  // --- La membresía del cliente, aplicada al cobro
  // Esto es lo que convierte el aviso en dinero: hasta aquí la caja sabía que
  // el cliente tenía membresía y le cobraba igual. El cajero tenía que marcar
  // la línea a mano, y nadie lo hacía siempre.
  const [ficha, setFicha] = useState<FichaMembego | null>(null);
  const [fichaError, setFichaError] = useState<string | null>(null);
  const [fichaBuscando, setFichaBuscando] = useState(false);
  const [niveles, setNiveles] = useState<NivelesPorCategoria>({});
  /** Precios del catálogo en la categoría tope del plan, para la diferencia. */
  const [preciosTope, setPreciosTope] = useState<Record<string, number> | null>(null);
  /** El identificador en Membego, venga de la ficha elegida o de la orden. */
  const [membegoCustomerId, setMembegoCustomerId] = useState<string | null>(null);
  /** Resultado del último canje, para enseñárselo al cajero tras cobrar. */
  const [avisoCanje, setAvisoCanje] = useState<{ ok: boolean; texto: string } | null>(null);

  // Búsqueda de beneficios Membego por teléfono (aviso al cajero).
  const [membegoPhone, setMembegoPhone] = useState('');
  const [membegoSummary, setMembegoSummary] = useState<MembegoBenefitSummary | null>(null);
  const [membegoBusy, setMembegoBusy] = useState(false);
  const [membegoSearched, setMembegoSearched] = useState(false);

  /**
   * Trae la ficha al cobro.
   *
   * Lo que importa no es el nombre —eso ya se escribía— sino el enlace: con él
   * la factura entra en el historial del cliente, cuenta como visita suya y,
   * si tiene cupo autorizado, se le puede fiar. El cupo se consulta aquí para
   * poder explicar por qué el botón de crédito está o no disponible.
   */
  const elegirCliente = useCallback(async (c: CustomerMatch) => {
    setCliente(c);
    setCustomerId(c.id);
    setCustomerName(c.name);
    setBusqueda('');
    setResultados([]);
    setCredito(null);
    try { setCredito(await fetchCreditStatus(c.id)); } catch { setCredito(null); }
  }, []);

  const soltarCliente = useCallback(() => {
    setCliente(null);
    setCustomerId(null);
    setCredito(null);
    setCustomerName('');
    if (method === 'credito') setMethod('efectivo');
  }, [method]);

  // Búsqueda con espera, para no consultar por cada letra tecleada.
  useEffect(() => {
    if (cliente || orden || busqueda.trim().length < 2) {
      setResultados([]); setBuscando(false); return;
    }
    let active = true;
    setBuscando(true);
    const t = setTimeout(() => {
      searchCustomers(busqueda)
        .then(rows => { if (active) setResultados(rows); })
        .catch(() => { if (active) setResultados([]); })
        .finally(() => { if (active) setBuscando(false); });
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [busqueda, cliente, orden]);

  const checkMembego = async () => {
    if (!membegoPhone.trim() || membegoBusy) return;
    setMembegoBusy(true);
    setMembegoSummary(null);
    try {
      const s = await lookupMembegoByPhone(membegoPhone);
      setMembegoSummary(s);
      // Encontrarlo y quedarse solo con el nombre era desperdiciar el hallazgo:
      // se adopta la ficha entera, igual que si se hubiera elegido a mano.
      if (s && !orden) {
        const ficha = await fetchCustomerById(s.customerId);
        if (ficha) await elegirCliente(ficha);
        else setCustomerName(s.customerName);
      } else if (s) {
        setCustomerName(s.customerName);
      }
    } catch {
      setMembegoSummary(null);
    } finally {
      setMembegoSearched(true);
      setMembegoBusy(false);
    }
  };

  /**
   * Clave de idempotencia de la venta EN CURSO.
   *
   * Se crea al añadir el primer artículo y solo se renueva cuando la venta se
   * cierra. Así, si el cobro falla por red y el cajero reintenta, el servidor
   * reconoce la misma operación en lugar de emitir una segunda factura. El
   * error del código auditado fue meter Date.now() en la clave, lo que la
   * cambiaba en cada intento y anulaba la protección.
   */
  const requestIdRef = useRef<string | null>(null);
  const ensureRequestId = () => {
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    return requestIdRef.current;
  };

  const taxRateBps = company?.tax_rate_bps ?? 1800;
  const itbisIncluido = company?.prices_include_tax ?? false;
  const symbol = company?.currency_symbol ?? 'RD$';

  /**
   * Filtro del catálogo por texto.
   *
   * Se normaliza (minúsculas y sin acentos) en ambos lados para que "basico"
   * encuentre "Cuidado Básico" y "cera" encuentre "Cera a máquina". Busca en el
   * nombre y en la descripción del servicio / categoría del producto, que es
   * donde el cajero espera acertar.
   */
  const normalizar = (t: string) =>
    t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = normalizar(catalogSearch.trim());

  const serviciosFiltrados = useMemo(() => {
    if (!q) return services;
    return services.filter(s => normalizar(`${s.name} ${s.description}`).includes(q));
  }, [services, q]);

  const productosFiltrados = useMemo(() => {
    if (!q) return products;
    return products.filter(p => normalizar(`${p.name} ${p.category}`).includes(q));
  }, [products, q]);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [srv, prd, cash, fisc, nvl] = await Promise.all([
        fetchServices(category),
        fetchProducts(),
        fetchOpenCashSession(branch.id),
        fetchFiscalStatus(),
        // Sin niveles no se puede calcular ninguna diferencia. Si falla, se
        // sigue vendiendo: se cobra completo y se dice por qué.
        fetchVehicleCategoryLevels().catch(() => ({} as NivelesPorCategoria))
      ]);
      setServices(srv);
      setProducts(prd);
      setSession(cash);
      setFiscal(fisc);
      setNiveles(nvl);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo');
    } finally {
      setLoading(false);
    }
  }, [branch, category]);

  useEffect(() => { void load(); }, [load]);

  // ------------------------------------------------- La membresía en la caja

  /**
   * Quién es este cliente en Membego.
   *
   * Se resuelve por separado porque la ficha puede llegar por dos caminos —el
   * buscador del mostrador o la orden de trabajo— y el segundo solo deja el
   * identificador del cliente, no su ficha entera. Sin esto, cobrar una orden
   * registrada no aplicaba ninguna membresía: justo el caso más común.
   */
  useEffect(() => {
    if (!customerId) { setMembegoCustomerId(null); return; }
    if (cliente?.id === customerId) {
      setMembegoCustomerId(cliente.membego_customer_id ?? null);
      return;
    }
    let active = true;
    fetchCustomerById(customerId)
      .then(c => { if (active) setMembegoCustomerId(c?.membego_customer_id ?? null); })
      .catch(() => { if (active) setMembegoCustomerId(null); });
    return () => { active = false; };
  }, [customerId, cliente]);

  /**
   * Qué cubre su membresía para ESTE carro.
   *
   * Depende de la placa y de la categoría: la misma membresía cubre un sedán y
   * no una camioneta, así que cambiar cualquiera de las dos cambia la respuesta
   * y hay que volver a preguntar.
   */
  useEffect(() => {
    if (!membegoCustomerId) { setFicha(null); setFichaError(null); return; }

    let active = true;
    setFichaBuscando(true);
    setFichaError(null);
    const t = setTimeout(() => {
      fetchFichaMembego(membegoCustomerId, {
        placa: vehiclePlate.trim() || null,
        // `null` si esa categoría no tiene nivel: mandar un 1 inventado haría
        // que Membego diera por cubierto un camión.
        nivelVehiculo: niveles[category] ?? null
      })
        .then(f => { if (active) setFicha(f); })
        .catch(err => {
          if (!active) return;
          setFicha(null);
          setFichaError(err instanceof ErrorFichaMembego ? err.message : 'No se pudo consultar Membego.');
        })
        .finally(() => { if (active) setFichaBuscando(false); });
    }, 300);

    return () => { active = false; clearTimeout(t); };
  }, [membegoCustomerId, vehiclePlate, category, niveles]);

  /**
   * La tarifa de la categoría que el plan sí cubre.
   *
   * Solo hace falta cuando el carro se sale del plan, que es cuando hay
   * diferencia que calcular. Pedirla siempre sería una consulta por venta que
   * casi nunca se usa.
   */
  useEffect(() => {
    const tope = ficha?.memberships.find(m => m.coverage?.covers === false &&
      m.coverage.reason === 'VEHICLE_LEVEL_ABOVE_PLAN')?.coverage?.vehicleLevelMax;

    if (tope === undefined || tope === null) { setPreciosTope(null); return; }
    const categoriaTope = categoriaTopeDelPlan(niveles, tope);
    if (!categoriaTope) { setPreciosTope(null); return; }

    let active = true;
    fetchServicePricesForCategory(categoriaTope)
      .then(p => { if (active) setPreciosTope(p); })
      .catch(() => { if (active) setPreciosTope(null); });
    return () => { active = false; };
  }, [ficha, niveles]);

  // ------------------------------------------- Cobrar una orden registrada

  const cargarOrdenes = useCallback(async () => {
    if (!branch) return;
    setOrdenesBusy(true);
    try { setOrdenes(await fetchChargeableOrders(branch.id, buscarOrden)); }
    catch { setOrdenes([]); }
    finally { setOrdenesBusy(false); }
  }, [branch, buscarOrden]);

  useEffect(() => {
    if (!branch) return;
    const t = setTimeout(() => void cargarOrdenes(), 300);
    return () => clearTimeout(t);
  }, [branch, cargarOrdenes]);

  /**
   * Trae la orden al cobro.
   *
   * Las líneas se copian tal como se pactaron al recibir el vehículo y NO se
   * pueden editar: si el cajero pudiera cambiarlas, volveríamos al problema que
   * esto resuelve —cobrar un importe distinto al que dice la orden—. Para añadir
   * algo (una bebida, un servicio extra) se usa el catálogo, y esa línea sí es
   * suya. Los precios, como siempre, los vuelve a resolver el servidor al
   * emitir; aquí solo se previsualizan.
   */
  const elegirOrden = async (o: ChargeableOrder) => {
    ensureRequestId();
    setOrden(o);
    setCategory(o.vehicle_category);
    // Manda la orden: el cliente es el que recibió el vehículo, no el que
    // estuviera elegido en el mostrador. Dos fuentes para el mismo dato acaban
    // discrepando, y la que vale es la que firmó la llegada.
    setCliente(null);
    setBusqueda('');
    setCustomerId(o.customer_id);
    setCustomerName(o.customer_name ?? '');
    setVehiclePlate(o.vehicle_plate ?? '');
    setLines((o.work_order_items ?? []).map(i => ({
      key: crypto.randomUUID(),
      itemType: i.item_type,
      serviceId: i.service_id,
      productId: i.product_id,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      discountCents: i.discount_cents,
      isMembegoCovered: i.is_membego_covered,
      // Marca de origen: distingue lo pactado de lo que añade el cajero.
      deLaOrden: true
    } as CartLine & { deLaOrden?: boolean })));
    setCredito(null);
    if (o.customer_id) {
      try { setCredito(await fetchCreditStatus(o.customer_id)); } catch { setCredito(null); }
    }
  };

  const soltarOrden = () => {
    setOrden(null);
    setCliente(null);
    setCustomerId(null);
    setCredito(null);
    setLines([]);
    setCustomerName('');
    setVehiclePlate('');
    if (method === 'credito') setMethod('efectivo');
    requestIdRef.current = null;
  };

  // --------------------------------------------------------------- Carrito

  const addService = (s: ServiceWithPrice) => {
    ensureRequestId();
    setLines(prev => {
      const found = prev.find(l => l.serviceId === s.id);
      if (found) return prev.map(l => l === found ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, {
        key: crypto.randomUUID(), itemType: 'service', serviceId: s.id, productId: null,
        name: s.name, quantity: 1, unitPriceCents: s.price_cents,
        discountCents: 0, isMembegoCovered: false
      }];
    });
  };

  const addProduct = (p: Product) => {
    ensureRequestId();
    setLines(prev => {
      const found = prev.find(l => l.productId === p.id);
      if (found) return prev.map(l => l === found ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, {
        key: crypto.randomUUID(), itemType: 'product', serviceId: null, productId: p.id,
        name: p.name, quantity: 1, unitPriceCents: p.price_cents,
        discountCents: 0, isMembegoCovered: false
      }];
    });
  };

  const changeQty = (key: string, delta: number) =>
    setLines(prev => prev.map(l =>
      l.key === key ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l));

  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key));

  // ----------------------------------------------------------- Promoción
  const [promoCode, setPromoCode] = useState('');
  const [promoPreview, setPromoPreview] = useState<PromotionPreview | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const aplicarPromo = async () => {
    if (!promoCode.trim() || promoBusy) return;
    setPromoBusy(true);
    try {
      const subtotal = lines.reduce((acc, l) => acc + l.unitPriceCents * l.quantity, 0);
      setPromoPreview(await validatePromotion({
        code: promoCode,
        subtotalCents: subtotal,
        lines: lines.map(l => ({
          service_id: l.serviceId,
          category,
          amount_cents: l.unitPriceCents * l.quantity - l.discountCents
        }))
      }));
    } catch {
      setPromoPreview({ valid: false, reason: 'No se pudo comprobar el código.' });
    } finally {
      setPromoBusy(false);
    }
  };

  const quitarPromo = () => { setPromoCode(''); setPromoPreview(null); };

  /**
   * Qué absorbe la membresía en esta venta.
   *
   * Se calcula, no se marca a mano. El cajero no tiene por qué saber qué plan
   * cubre qué categoría, y cuando tenía que acordarse, no se acordaba.
   *
   * Si la venta viene de una orden que YA trae líneas marcadas, manda la orden:
   * el beneficio se pactó al recibir el vehículo y volver a decidirlo aquí sería
   * cobrar distinto a lo que se le dijo al cliente en la puerta.
   */
  const cobertura = useMemo(() => {
    if (!ficha || lines.length === 0) return null;
    if (lines.some(l => l.isMembegoCovered)) return null;

    return aplicarCobertura({
      membresias: ficha.memberships,
      lineas: lines.map(l => ({
        serviceId: l.serviceId,
        incluidoEnMembego: l.serviceId
          ? (services.find(s => s.id === l.serviceId)?.included_in_membego ?? false)
          : false,
        unitPriceCents: l.unitPriceCents,
        quantity: l.quantity
      })),
      precioEnCategoriaTope: id => preciosTope?.[id] ?? null
    });
  }, [ficha, lines, services, preciosTope]);

  /**
   * Las líneas tal como van a facturarse, con el beneficio ya aplicado.
   *
   * `lines` se queda intacto a propósito: el carrito es lo que el cajero tecleó
   * y la cobertura es una consecuencia. Mezclarlos obligaría a deshacer el
   * beneficio a mano cada vez que cambia la placa o el vehículo.
   */
  const lineasEfectivas = useMemo<CartLine[]>(() => {
    if (!cobertura || cobertura.lineaIndex === null || cobertura.coveredCents === 0) return lines;

    return lines.map((l, i) => {
      if (i !== cobertura.lineaIndex) return l;

      // Una membresía cubre UN lavado. Marcar la línea entera cuando la cantidad
      // es 2 regalaría el segundo, así que solo se usa la marca cuando coincide
      // con lo que de verdad cubre; si no, va como importe.
      if (l.quantity === 1 && cobertura.differenceCents === 0) {
        return { ...l, isMembegoCovered: true };
      }
      const tope = l.unitPriceCents * l.quantity;
      return { ...l, discountCents: Math.min(tope, l.discountCents + cobertura.coveredCents) };
    });
  }, [lines, cobertura]);

  /** Lo que la membresía absorbe como importe y no como línea marcada. */
  const cubiertoComoImporte =
    cobertura && cobertura.lineaIndex !== null &&
    !lineasEfectivas[cobertura.lineaIndex]?.isMembegoCovered
      ? cobertura.coveredCents
      : 0;

  // Previsualización. La cifra que vale es la que devuelve create_invoice().
  const preview = useMemo(() => {
    const subtotal = lineasEfectivas.reduce((acc, l) => acc + l.unitPriceCents * l.quantity, 0);
    // Lo que absorbe Membego se resta de los descuentos manuales: viaja como
    // descuento por el contrato del servidor, pero no es un descuento del
    // cajero y contarlo ahí mentiría en el informe de descuentos.
    const manual = lineasEfectivas.reduce(
      (acc, l) => acc + (l.isMembegoCovered ? 0 : l.discountCents), 0) - cubiertoComoImporte;
    const membego = lineasEfectivas.reduce(
      (acc, l) => acc + (l.isMembegoCovered ? l.unitPriceCents * l.quantity : 0), 0
    ) + cubiertoComoImporte;
    // El descuento promocional lo calculó el servidor al validar el código; aquí
    // solo se pinta. Al emitir, create_invoice lo vuelve a calcular.
    const promo = promoPreview?.valid ? (promoPreview.discount_cents ?? 0) : 0;
    const discount = manual + promo;
    const taxable = Math.max(0, subtotal - discount - membego);
    // Respeta si la empresa vende con ITBIS incluido en el precio.
    const { tax, total } = desglosarItbis(taxable, taxRateBps, itbisIncluido);
    return { subtotal, discount, manual, promo, membego, tax, total };
  }, [lineasEfectivas, cubiertoComoImporte, taxRateBps, itbisIncluido, promoPreview]);

  const tenderedCents = parseAmountToCents(tenderedInput);
  const effectiveTendered = method === 'efectivo'
    ? (tenderedCents ?? 0)
    : preview.total;
  const change = Math.max(0, effectiveTendered - preview.total);

  const needsCashSession = method === 'efectivo';
  // El cobro NO depende de la facturación fiscal: sin NCF configurado se emite un
  // recibo interno (sin comprobante fiscal). Si hay rangos NCF, se ofrece además
  // emitir el comprobante fiscal.
  // Fiar exige ficha de cliente, cupo suficiente y ninguna factura vencida. La
  // base lo comprueba otra vez al emitir: esto solo evita ofrecer un botón que
  // va a fallar, y explicar por qué.
  const creditoDisponible = credito?.available_cents ?? 0;
  const motivoSinCredito =
    !customerId                 ? 'Elija el cliente (o una orden con cliente) para poder fiar'
    : !credito?.credit_enabled  ? 'Este cliente no tiene crédito autorizado'
    : credito.blocked           ? 'Tiene facturas vencidas: el crédito está cortado'
    : creditoDisponible < preview.total
        ? `Cupo disponible insuficiente (${formatCents(creditoDisponible, symbol)})`
    : null;

  const canCheckout =
    lines.length > 0 &&
    !submitting &&
    can(profile, 'issueInvoice') &&
    (!needsCashSession || session !== null) &&
    (method !== 'credito' || motivoSinCredito === null) &&
    effectiveTendered >= preview.total;

  // -------------------------------------------------------------- Checkout

  const handleCheckout = async () => {
    if (!canCheckout || !branch) return;
    setSubmitting(true);
    setSubmitError(null);
    setAvisoCanje(null);

    try {
      const invoice = await createInvoice({
        branchId: branch.id,
        clientRequestId: ensureRequestId(),
        // Con el beneficio ya aplicado: lo que se factura es lo que se cobra.
        lines: lineasEfectivas,
        /*
         * Una factura de cero no lleva pagos.
         *
         * Es lo que pasa cuando la membresía cubre el lavado entero: no hay
         * nada que cobrar. Mandando un pago de 0 el servidor la rechazaba
         * —«Importe de pago inválido»— y el lavado cubierto era justo el único
         * que no se podía facturar. Sin pagos, `create_invoice` compara 0
         * recibido contra 0 de total y la emite.
         */
        payments: preview.total > 0 ? [{ method, amountCents: effectiveTendered }] : [],
        vehicleCategory: category,
        // Lo que faltaba: sin la orden, `create_invoice` no puede marcarla
        // pagada ni enlazar el comprobante con el lavado.
        workOrderId: orden?.id ?? null,
        customerId,
        customerName: customerName.trim() || 'Consumidor Final',
        customerTaxId: customerTaxId.trim() || null,
        vehiclePlate: vehiclePlate.trim().toUpperCase() || null,
        ncfType: wantsNcf ? (customerTaxId.trim() ? 'B01' : 'B02') : null,
        cashSessionId: session?.id ?? null,
        // Solo el código: el importe lo recalcula el servidor con sus reglas.
        promotionCode: promoPreview?.valid ? promoCode.trim() : null
      });

      setLastInvoice(invoice);

      /*
       * Avisar a Membego DESPUÉS de facturar, y nunca antes.
       *
       * Son dos sistemas sin transacción común: uno de los dos pasos queda
       * primero y el otro puede fallar. Canjeando primero, un fallo al facturar
       * le quita un lavado al cliente sin dejarle comprobante — pierde él y no
       * se entera. Facturando primero, un fallo al canjear le cuesta un lavado
       * al negocio, que sabe cuánto y puede reintentarlo.
       *
       * Por eso el canje va aquí, con la factura ya emitida, y su fallo NO tira
       * el cobro: se anota en la factura y se le enseña al cajero.
       */
      if (cobertura?.membershipId && cobertura.coveredCents > 0) {
        const servicio = lines[cobertura.lineaIndex ?? 0]?.name ?? 'Lavado';
        const r = await canjearEnMembego({
          invoiceId: invoice.id,
          membershipId: cobertura.membershipId,
          servicio,
          coveredCents: cobertura.coveredCents,
          sucursalId: branch.id
        });
        setAvisoCanje(r.ok
          ? {
              ok: true,
              texto: r.usesLeft === null
                ? `Lavado descontado de ${cobertura.membershipNombre}.`
                : `Lavado descontado. Le quedan ${r.usesLeft}.`
            }
          : {
              ok: false,
              texto: `La factura salió bien, pero Membego no descontó el lavado (${r.motivo}). ` +
                     'Queda anotado en la factura para reintentarlo.'
            });
      }

      // La orden acaba de dejar de estar pendiente: fuera del panel.
      setOrden(null); setCustomerId(null); setCredito(null);
      setCliente(null); setBusqueda(''); setResultados([]);
      void cargarOrdenes();
      // La venta terminó: a partir de aquí, la siguiente es otra operación.
      requestIdRef.current = null;
      setLines([]);
      setCustomerName('');
      setVehiclePlate('');
      setCustomerTaxId('');
      setTenderedInput('');
      setMembegoPhone(''); setMembegoSummary(null); setMembegoSearched(false);
      setFicha(null); setFichaError(null); setPreciosTope(null);
      quitarPromo();
      void load();     // refresca stock y caja
    } catch (err) {
      // NO se limpia requestIdRef: un reintento debe llevar la MISMA clave.
      setSubmitError(err instanceof Error ? err.message : 'No se pudo emitir la factura');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------- Render

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4" aria-busy="true">
        <div className="h-8 w-64 bg-surface-2/60 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 bg-surface border border-line rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="lg:col-span-5 h-96 bg-surface border border-line rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-danger/40 border border-danger/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-danger font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar el punto de venta
          </div>
          <p className="text-xs text-body">{loadError}</p>
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-brand" /> Punto de Venta
          </h2>
          <p className="text-xs text-muted">
            {branch?.name} · Cajero: <strong className="text-body">{profile?.full_name}</strong>
          </p>
        </div>
        {/* Estado de la pantalla, todo en una fila y una línea por cosa.
            La caja aparecía dos veces —esta insignia y un párrafo debajo— y lo
            fiscal ocupaba tres renglones para decir que no hay NCF. Un aviso
            permanente que hay que leer entero cada vez se deja de leer a la
            segunda semana: dice lo justo, y el detalle está donde se arregla. */}
        <div className="flex flex-wrap items-center gap-2">
          {!fiscal.ready && (
            <span role="status" title="No hay rangos NCF cargados: se emiten recibos internos."
              className="text-xs px-3 py-1.5 rounded-xl border border-line-strong bg-surface-2/60 text-body font-semibold">
              Recibo interno · sin NCF
            </span>
          )}
          <span role="status" className={`text-xs px-3 py-1.5 rounded-xl border font-semibold ${
            session
              ? 'bg-success/40 border-success/40 text-success'
              : 'bg-warning/40 border-warning/40 text-warning'
          }`}>
            {session
              ? `Caja abierta · ${formatCents(session.expected_cash_cents, symbol)}`
              : 'Caja cerrada · sin efectivo'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Catálogo */}
        <div className="lg:col-span-7 space-y-5">
          <div className="space-y-2">
            <span className="text-xs font-extrabold text-muted uppercase tracking-wider">
              1. Categoría de vehículo
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  aria-pressed={category === c.id}
                  className={`py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                    category === c.id
                      ? 'bg-primary text-primary-foreground border-transparent'
                      : 'bg-transparent text-muted border-line hover:bg-surface-2 hover:text-strong'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex border-b border-line gap-4 text-xs font-bold" role="tablist">
            {(['services', 'products'] as const).map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`pb-2 border-b-2 transition-colors ${
                  tab === t ? 'border-brand text-brand' : 'border-transparent text-faint'
                }`}
              >
                {t === 'services' ? 'Servicios' : 'Productos'}
              </button>
            ))}
          </div>

          {/* Buscador del catálogo: filtra la pestaña activa por nombre. */}
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={catalogSearch}
              onChange={e => setCatalogSearch(e.target.value)}
              placeholder={tab === 'services' ? 'Buscar servicio por nombre…' : 'Buscar producto por nombre…'}
              aria-label={tab === 'services' ? 'Buscar servicio' : 'Buscar producto'}
              autoComplete="off"
              className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-input bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            {catalogSearch && (
              <button type="button" onClick={() => setCatalogSearch('')} aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-faint hover:text-strong">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {tab === 'services' ? (
              serviciosFiltrados.length === 0 ? (
                <p className="text-xs text-faint italic col-span-full py-8 text-center">
                  {q
                    ? `Ningún servicio coincide con «${catalogSearch.trim()}».`
                    : `No hay servicios con precio para ${CATEGORIES.find(c => c.id === category)?.label}.`}
                </p>
              ) : serviciosFiltrados.map(s => (
                <button
                  key={s.id}
                  onClick={() => addService(s)}
                  className="p-3.5 bg-surface border border-line hover:border-ring rounded-xl text-left transition-all space-y-1.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex justify-between font-bold text-xs text-strong gap-2">
                    <span>{s.name}</span>
                    <span className="text-brand font-extrabold whitespace-nowrap">
                      {formatCents(s.price_cents, symbol)}
                    </span>
                  </span>
                  <span className="block text-xs text-muted line-clamp-2">{s.description}</span>
                </button>
              ))
            ) : (
              productosFiltrados.length === 0 ? (
                <p className="text-xs text-faint italic col-span-full py-8 text-center">
                  {q
                    ? `Ningún producto coincide con «${catalogSearch.trim()}».`
                    : 'No hay productos a la venta.'}
                </p>
              ) : productosFiltrados.map(p => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={p.stock <= 0}
                  className="p-3.5 bg-surface border border-line hover:border-ring disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-left transition-all space-y-1.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex justify-between font-bold text-xs text-strong gap-2">
                    <span>{p.name}</span>
                    <span className="text-brand font-extrabold whitespace-nowrap">
                      {formatCents(p.price_cents, symbol)}
                    </span>
                  </span>
                  <span className={`block text-xs ${p.stock <= p.min_stock ? 'text-warning' : 'text-muted'}`}>
                    Stock: {p.stock} {p.unit}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Carrito y cobro */}
        <div className="lg:col-span-5 bg-surface/90 border border-line rounded-2xl p-5 space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h3 className="font-bold text-strong text-sm">Venta</h3>
            <span className="text-xs bg-brand-soft text-brand-hi px-2 py-0.5 rounded font-bold">
              {lines.length} {lines.length === 1 ? 'ítem' : 'ítems'}
            </span>
          </div>

          {/* ---------------------------------------- Cobrar una orden ya registrada
              El vehículo se recibe en Operaciones; aquí se cobra. Sin esto el
              cajero teclea la venta otra vez y la orden no se entera de que se
              pagó. */}
          {orden ? (
            <div className="bg-brand-soft/40 border border-brand/40 rounded-xl p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-strong text-sm flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4 text-brand flex-shrink-0" />
                    Orden {orden.order_number}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {orden.vehicle_plate} · {orden.customer_name || 'Sin cliente'}
                  </div>
                </div>
                <Button variant="ghost" size="icon-xs" className="flex-shrink-0" onClick={soltarOrden} aria-label="Quitar la orden y cobrar una venta suelta"
                  >
                  <XIcon className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted">
                Las líneas del lavado vienen de la orden y no se editan. Puede
                añadir del catálogo lo que consuma además.
              </p>
            </div>
          ) : (
            <details className="bg-canvas/60 border border-line rounded-xl">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-bold text-body flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-brand" />
                Cobrar una orden
                {ordenes.length > 0 && (
                  <span className="ml-auto bg-warning/20 text-warning px-2 py-0.5 rounded font-bold text-xs">
                    {ordenes.length} sin cobrar
                  </span>
                )}
              </summary>
              <div className="px-3 pb-3 space-y-2">
                <label htmlFor="pos-orden-buscar" className="sr-only">Buscar orden pendiente</label>
                <input
                  id="pos-orden-buscar" type="search" value={buscarOrden}
                  onChange={e => setBuscarOrden(e.target.value)}
                  placeholder="Buscar por placa, número o cliente…"
                  className="w-full p-2 text-sm rounded-lg border border-input bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                />
                <div className="max-h-52 overflow-y-auto space-y-1.5">
                  {ordenesBusy ? (
                    <p className="text-xs text-faint italic py-3 text-center">Buscando…</p>
                  ) : ordenes.length === 0 ? (
                    <p className="text-xs text-faint italic py-3 text-center">
                      {buscarOrden ? 'Ninguna orden coincide.' : 'No hay órdenes sin cobrar.'}
                    </p>
                  ) : ordenes.map(o => (
                    <button key={o.id} onClick={() => void elegirOrden(o)}
                      className="w-full text-left p-2.5 bg-surface border border-line hover:border-ring rounded-lg flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-bold text-sm text-strong">
                          {o.vehicle_plate || 'sin placa'}
                          <span className="ml-1.5 font-normal text-xs text-faint">{o.order_number}</span>
                        </span>
                        <span className="block text-xs text-muted truncate">
                          {o.customer_name || 'Sin cliente'} · {ESTADO_ORDEN[o.status] ?? o.status}
                        </span>
                      </span>
                      <span className="font-extrabold text-sm text-brand whitespace-nowrap">
                        {formatCents(o.total_cents, symbol)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </details>
          )}

          {/* ------------------------------------------------- Cliente
              Sin ficha, la venta se cobra igual pero no entra en el historial
              de nadie y no se puede fiar. El buscador es lo que convierte un
              nombre escrito en un cliente de verdad. La orden, cuando la hay,
              ya trae el suyo: entonces esto no se ofrece. */}
          {cliente ? (
            <div className="bg-brand-soft/40 border border-brand/40 rounded-xl p-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-strong text-sm flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-brand-hi flex-shrink-0" />
                  <span className="truncate">{cliente.name}</span>
                </div>
                <div className="text-xs text-muted">
                  {cliente.phone || 'Sin teléfono'} · {cliente.total_visits}{' '}
                  {cliente.total_visits === 1 ? 'visita' : 'visitas'}
                  {cliente.origin === 'membego' && <> · de Membego</>}
                </div>
                {credito?.credit_enabled && (
                  <div className={`text-xs font-bold mt-0.5 ${credito.blocked ? 'text-warning' : 'text-success'}`}>
                    {credito.blocked
                      ? 'Crédito cortado: tiene facturas vencidas'
                      : `Cupo disponible ${formatCents(creditoDisponible, symbol)}`}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="icon-xs" className="flex-shrink-0" onClick={soltarCliente} aria-label="Quitar el cliente y cobrar sin ficha"
                >
                <XIcon className="w-4 h-4" />
              </Button>
            </div>
          ) : !orden && (
            <div className="space-y-1.5">
              <label htmlFor="pos-cliente-buscar" className="sr-only">Buscar cliente registrado</label>
              <div className="relative">
                <Search className="w-4 h-4 text-faint absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  id="pos-cliente-buscar" type="search" value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar cliente registrado por nombre o teléfono…"
                  autoComplete="off"
                  className="w-full pl-8 pr-2 py-2 text-xs rounded-lg border border-input bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                />
              </div>
              <div aria-live="polite" className="space-y-1.5 max-h-44 overflow-y-auto">
                {buscando && (
                  <p className="text-xs text-faint italic py-1">Buscando…</p>
                )}
                {!buscando && busqueda.trim().length >= 2 && resultados.length === 0 && (
                  <p className="text-xs text-faint italic py-1">
                    Ningún cliente coincide. Puede cobrar poniendo solo el nombre.
                  </p>
                )}
                {resultados.map(c => (
                  <button key={c.id} onClick={() => void elegirCliente(c)}
                    className="w-full text-left p-2 bg-surface border border-line hover:border-ring rounded-lg flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-strong truncate">{c.name}</span>
                      <span className="block text-xs text-muted truncate">
                        {c.phone || 'Sin teléfono'} · {c.total_visits}{' '}
                        {c.total_visits === 1 ? 'visita' : 'visitas'}
                      </span>
                    </span>
                    {c.credit_enabled && (
                      <span className="px-1.5 py-0.5 rounded bg-info/15 border border-info/40 text-info text-xs font-bold whitespace-nowrap">
                        Crédito
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Su membresía, en la caja y sin pedirla.
              Va fuera del bloque del cliente elegido a propósito: cuando la
              venta viene de una orden no hay ficha en pantalla, y es justo la
              venta que más veces lleva membresía. */}
          {membegoCustomerId && (
            <div className="bg-surface-2/50 border border-line rounded-xl p-3">
              <PanelFichaMembego
                ficha={ficha} error={fichaError} buscando={fichaBuscando}
                placa={vehiclePlate} onElegirPlaca={setVehiclePlate}
                disabled={submitting}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              {/* Con un buscador de clientes justo encima, un campo llamado
                  «Cliente» no se distingue de él. Y este es literalmente lo que
                  se imprime en el comprobante. */}
              <label htmlFor="pos-cust" className="text-xs font-semibold text-muted uppercase">
                Nombre en la factura
              </label>
              <input
                id="pos-cust" type="text" value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                disabled={cliente !== null}
                placeholder="Consumidor Final"
                className="w-full bg-canvas border border-line rounded-lg p-2 text-strong placeholder-faint disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="pos-plate" className="text-xs font-semibold text-muted uppercase">Placa</label>
              <input
                id="pos-plate" type="text" value={vehiclePlate}
                onChange={e => setVehiclePlate(e.target.value.toUpperCase())}
                className="w-full bg-canvas border border-line rounded-lg p-2 text-strong uppercase font-bold"
              />
            </div>
          </div>

          {/* Consulta de beneficios Membego por teléfono */}
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <input
                type="tel" value={membegoPhone}
                onChange={e => { setMembegoPhone(e.target.value); setMembegoSearched(false); }}
                onKeyDown={e => { if (e.key === 'Enter') void checkMembego(); }}
                placeholder="Teléfono para ver beneficios Membego"
                aria-label="Teléfono para buscar beneficios Membego"
                className="flex-1 p-2 text-xs rounded-lg border border-input bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <Button variant="ghost" size="sm" className="bg-warning/20 text-warning hover:bg-warning/30 hover:text-warning" onClick={() => void checkMembego()} disabled={membegoBusy || !membegoPhone.trim()}
                >
                {membegoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                Membego
              </Button>
            </div>
            {membegoSummary && (
              <div role="status" className="flex items-center gap-2 p-2 bg-warning/30 border border-warning/40 rounded-lg text-xs text-warning">
                <BadgeCheck className="w-4 h-4 flex-shrink-0 text-warning" />
                <span>
                  <strong>{membegoSummary.customerName}</strong>
                  {membegoSummary.tier && <> · {membegoSummary.tier}</>}
                  {' · '}{membegoSummary.activeMemberships} membresía(s)
                  {' · '}<strong>{membegoSummary.availablePromotions} oferta(s) disponible(s)</strong>
                </span>
              </div>
            )}
            {membegoSearched && !membegoSummary && !membegoBusy && (
              <p className="text-xs text-faint">Sin beneficios de Membego para ese teléfono.</p>
            )}
          </div>

          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 flex-1">
            {lines.length === 0 ? (
              <p className="text-center py-8 text-xs text-faint italic">
                Toque un servicio o producto para añadirlo
              </p>
            ) : lines.map(l => {
              // Lo que viene de la orden se cobra como se pactó al recibir el
              // vehículo. Si se pudiera editar aquí, volvería el problema que
              // esta pantalla resuelve: cobrar algo distinto a lo acordado.
              const deLaOrden = (l as CartLine & { deLaOrden?: boolean }).deLaOrden === true;
              return (
              <div key={l.key} className={`p-2.5 rounded-xl border flex items-center justify-between text-xs gap-2 ${
                deLaOrden ? 'bg-brand-soft/25 border-brand/30' : 'bg-canvas border-line/80'}`}>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="font-bold text-strong truncate">{l.name}</div>
                  <div className="text-xs text-muted">
                    {formatCents(l.unitPriceCents, symbol)} c/u
                    {deLaOrden && <span className="ml-1.5 text-brand font-bold">· de la orden</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {deLaOrden ? (
                    <span className="px-2 font-bold text-strong tabular-nums">×{l.quantity}</span>
                  ) : (
                    <div className="flex items-center bg-surface border border-line rounded-lg">
                      <Button variant="ghost" size="icon-xs" onClick={() => changeQty(l.key, -1)} aria-label={`Quitar uno de ${l.name}`} >
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="px-2 font-bold text-strong">{l.quantity}</span>
                      <Button variant="ghost" size="icon-xs" onClick={() => changeQty(l.key, 1)} aria-label={`Añadir uno de ${l.name}`} >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                  <span className="font-bold text-brand-hi w-20 text-right">
                    {formatCents(l.unitPriceCents * l.quantity, symbol)}
                  </span>
                  {deLaOrden ? (
                    <span className="w-6" aria-hidden="true" />
                  ) : (
                    <Button variant="ghost" size="icon-xs" className="text-faint hover:text-danger" onClick={() => removeLine(l.key)} aria-label={`Eliminar ${l.name}`} >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          <div className="space-y-4 pt-4 border-t border-line">
            <div className="space-y-1.5 text-xs">
              <div className="flex gap-1.5 pb-1.5">
                <input
                  aria-label="Código promocional"
                  className="flex-1 px-2.5 py-1.5 text-sm uppercase rounded-lg border border-input bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  value={promoCode}
                  onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoPreview(null); }}
                  placeholder="Código promocional" />
                {promoPreview?.valid
                  ? <Button type="button" variant="secondary" size="sm" onClick={quitarPromo}>
                      Quitar
                    </Button>
                  : <Button type="button" variant="secondary" size="sm" onClick={() => void aplicarPromo()} disabled={promoBusy || !promoCode.trim()}>
                      Aplicar
                    </Button>}
              </div>
              {promoPreview && !promoPreview.valid && (
                <p className="text-xs text-warning pb-1.5">{promoPreview.reason}</p>
              )}
              <div className="flex justify-between text-muted">
                <span>Subtotal</span><span>{formatCents(preview.subtotal, symbol)}</span>
              </div>
              {preview.promo > 0 && (
                <div className="flex justify-between text-success">
                  <span>Promoción {promoPreview?.code}</span>
                  <span>−{formatCents(preview.promo, symbol)}</span>
                </div>
              )}

              {/* Lo que pone la membresía. Se enseña como línea propia y no
                  mezclado con los descuentos: el cajero tiene que poder decirle
                  al cliente «esto lo pone su plan» y señalar la cifra. */}
              {preview.membego > 0 && (
                <div className="flex justify-between text-success">
                  <span className="flex items-center gap-1.5">
                    <BadgeCheck className="w-3.5 h-3.5" />
                    {cobertura?.membershipNombre ?? 'Membresía Membego'}
                  </span>
                  <span>−{formatCents(preview.membego, symbol)}</span>
                </div>
              )}
              {/* La diferencia a pagar, dicha con todas las letras. Sin esto el
                  cliente ve un total que no cuadra con «tengo membresía» y la
                  discusión la aguanta el cajero. */}
              {cobertura && cobertura.differenceCents > 0 && (
                <p className="text-xs text-warning pb-0.5">
                  Su plan no llega a esta categoría: paga la diferencia de{' '}
                  <strong>{formatCents(cobertura.differenceCents, symbol)}</strong>.
                </p>
              )}
              {cobertura && cobertura.coveredCents === 0 && ficha && ficha.memberships.length > 0 && (
                <p className="text-xs text-faint pb-0.5">{cobertura.explicacion}</p>
              )}

              <div className="flex justify-between text-muted">
                <span>ITBIS ({bpsToPercent(taxRateBps)})</span><span>{formatCents(preview.tax, symbol)}</span>
              </div>
              <div className="flex justify-between font-black text-base text-strong border-t border-line pt-1.5">
                <span>Total</span>
                <span className="text-brand">{formatCents(preview.total, symbol)}</span>
              </div>
              <p className="text-xs text-faint pt-1">
                Cifras de referencia: el importe definitivo lo calcula el servidor al emitir.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-muted uppercase">Método de pago</span>
              <div className="grid grid-cols-4 gap-2 text-xs font-bold">
                {METHODS.map(m => {
                  const Icon = m.icon;
                  // Fiar se bloquea con su motivo escrito: un botón apagado sin
                  // explicación deja al cajero adivinando delante del cliente.
                  const blocked = (m.id === 'efectivo' && !session)
                               || (m.id === 'credito' && motivoSinCredito !== null);
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      disabled={blocked}
                      aria-pressed={method === m.id}
                      title={!blocked ? undefined
                        : m.id === 'credito' ? motivoSinCredito! : 'Requiere caja abierta'}
                      className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        method === m.id
                          ? 'bg-primary text-primary-foreground border-transparent'
                          : 'bg-transparent text-muted border-line hover:bg-surface-2 hover:text-strong'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />{m.label}
                    </button>
                  );
                })}
              </div>

              {method === 'efectivo' && (
                <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                  <label htmlFor="pos-tendered" className="text-muted">Recibido</label>
                  <input
                    id="pos-tendered"
                    type="text"
                    inputMode="decimal"
                    value={tenderedInput}
                    onChange={e => setTenderedInput(e.target.value)}
                    placeholder={centsToInput(preview.total)}
                    className="w-28 bg-canvas border border-line rounded-lg p-1.5 text-right font-bold text-strong placeholder-faint"
                  />
                  <span className="text-muted">
                    Cambio <strong className="text-success">{formatCents(change, symbol)}</strong>
                  </span>
                </div>
              )}

              {fiscal.ready && (
              <label className="flex items-center gap-2 text-xs text-muted pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wantsNcf}
                  onChange={e => setWantsNcf(e.target.checked)}
                  className="accent-brand"
                />
                Emitir comprobante fiscal (NCF)
              </label>
              )}

              {fiscal.ready && wantsNcf && (
                <input
                  type="text"
                  value={customerTaxId}
                  onChange={e => setCustomerTaxId(e.target.value)}
                  placeholder="RNC / Cédula (opcional: sin él se emite B02)"
                  className="w-full bg-canvas border border-line rounded-lg p-2 text-xs text-strong placeholder-faint"
                />
              )}
            </div>

            {submitError && (
              <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" />
                <div className="space-y-1">
                  <p>{submitError}</p>
                  <p className="text-xs text-danger/80">
                    Puede reintentar sin miedo a cobrar dos veces: la operación conserva su
                    identificador y el servidor la reconoce.
                  </p>
                </div>
              </div>
            )}

            {lastInvoice && (
              <div role="status" className="flex items-start gap-2 p-3 bg-success/40 border border-success/40 rounded-xl text-xs text-success">
                <Receipt className="w-4 h-4 flex-shrink-0 text-success mt-0.5" />
                <span>
                  Emitida <strong>{lastInvoice.invoice_number}</strong>
                  {lastInvoice.ncf && <> · NCF <strong>{lastInvoice.ncf}</strong></>}
                  {' · '}{formatCents(lastInvoice.total_cents, symbol)}
                  {lastInvoice.change_cents > 0 && <> · Cambio {formatCents(lastInvoice.change_cents, symbol)}</>}
                </span>
              </div>
            )}

            {/* El resultado del canje se enseña, no se traga. Si Membego no
                descontó el lavado, el cajero tiene que saberlo AHORA —con el
                cliente delante— y no descubrirlo en un informe la semana que
                viene. */}
            {avisoCanje && (
              <div role="status"
                className={`rounded-xl p-2.5 text-xs flex items-start gap-2 border ${
                  avisoCanje.ok
                    ? 'bg-success/10 border-success/40 text-success'
                    : 'bg-warning/10 border-warning/40 text-warning'
                }`}>
                {avisoCanje.ok
                  ? <BadgeCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                <span>{avisoCanje.texto}</span>
              </div>
            )}

            <button
              onClick={() => void handleCheckout()}
              disabled={!canCheckout}
              className="w-full py-3 bg-success hover:bg-success disabled:bg-surface-2 disabled:text-faint text-on-accent font-black text-sm rounded-xl shadow-xl shadow-success/30 transition-all flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Emitiendo…</>
                : <><CheckCircle2 className="w-5 h-5" /> Cobrar {formatCents(preview.total, symbol)}</>}
            </button>

            {!can(profile, 'issueInvoice') && (
              <p className="text-xs text-warning text-center">
                Su rol no permite emitir facturas.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
