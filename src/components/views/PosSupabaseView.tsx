import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingBag, Plus, Minus, Trash2, CreditCard, Banknote, Building,
  Landmark, ClipboardList, X as XIcon,
  CheckCircle2, Loader2, AlertCircle, RefreshCw, Receipt, BadgeCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents, centsToInput, taxFromBps, bpsToPercent } from '../../lib/money';
import { validatePromotion, PromotionPreview } from '../../data/promotionRepository';
import {
  fetchServices, fetchProducts, fetchOpenCashSession, createInvoice, fetchFiscalStatus,
  fetchChargeableOrders, ChargeableOrder,
  lookupMembegoByPhone,
  ServiceWithPrice, Product, CashSession, CartLine, VehicleCategory, PaymentMethod, Invoice,
  FiscalStatus, MembegoBenefitSummary
} from '../../data/billingRepository';
import { fetchCreditStatus, CreditStatus } from '../../data/creditRepository';

const CATEGORIES: { id: VehicleCategory; label: string }[] = [
  { id: 'sedan', label: 'Sedán' },
  { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep 4x4' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' },
  { id: 'motorcycle', label: 'Moto' }
];

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

  const [category, setCategory] = useState<VehicleCategory>('sedan');
  const [tab, setTab] = useState<'services' | 'products'>('services');

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

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);

  // Búsqueda de beneficios Membego por teléfono (aviso al cajero).
  const [membegoPhone, setMembegoPhone] = useState('');
  const [membegoSummary, setMembegoSummary] = useState<MembegoBenefitSummary | null>(null);
  const [membegoBusy, setMembegoBusy] = useState(false);
  const [membegoSearched, setMembegoSearched] = useState(false);

  const checkMembego = async () => {
    if (!membegoPhone.trim() || membegoBusy) return;
    setMembegoBusy(true);
    setMembegoSummary(null);
    try {
      const s = await lookupMembegoByPhone(membegoPhone);
      setMembegoSummary(s);
      if (s) setCustomerName(s.customerName);
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
  const symbol = company?.currency_symbol ?? 'RD$';

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [srv, prd, cash, fisc] = await Promise.all([
        fetchServices(category),
        fetchProducts(),
        fetchOpenCashSession(branch.id),
        fetchFiscalStatus()
      ]);
      setServices(srv);
      setProducts(prd);
      setSession(cash);
      setFiscal(fisc);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo');
    } finally {
      setLoading(false);
    }
  }, [branch, category]);

  useEffect(() => { void load(); }, [load]);

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

  // Previsualización. La cifra que vale es la que devuelve create_invoice().
  const preview = useMemo(() => {
    const subtotal = lines.reduce((acc, l) => acc + l.unitPriceCents * l.quantity, 0);
    const manual = lines.reduce((acc, l) => acc + (l.isMembegoCovered ? 0 : l.discountCents), 0);
    const membego = lines.reduce((acc, l) => acc + (l.isMembegoCovered ? l.unitPriceCents * l.quantity : 0), 0);
    // El descuento promocional lo calculó el servidor al validar el código; aquí
    // solo se pinta. Al emitir, create_invoice lo vuelve a calcular.
    const promo = promoPreview?.valid ? (promoPreview.discount_cents ?? 0) : 0;
    const discount = manual + promo;
    const taxable = Math.max(0, subtotal - discount - membego);
    const tax = taxFromBps(taxable, taxRateBps);
    return { subtotal, discount, manual, promo, membego, tax, total: taxable + tax };
  }, [lines, taxRateBps, promoPreview]);

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
    !customerId                 ? 'Elija una orden con cliente para poder fiar'
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

    try {
      const invoice = await createInvoice({
        branchId: branch.id,
        clientRequestId: ensureRequestId(),
        lines,
        payments: [{ method, amountCents: effectiveTendered }],
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
      // La orden acaba de dejar de estar pendiente: fuera del panel.
      setOrden(null); setCustomerId(null); setCredito(null);
      void cargarOrdenes();
      // La venta terminó: a partir de aquí, la siguiente es otra operación.
      requestIdRef.current = null;
      setLines([]);
      setCustomerName('');
      setVehiclePlate('');
      setCustomerTaxId('');
      setTenderedInput('');
      setMembegoPhone(''); setMembegoSummary(null); setMembegoSearched(false);
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
          <button
            onClick={() => void load()}
            className="px-4 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
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
        <div className={`text-xs px-3 py-1.5 rounded-xl border font-semibold ${
          session
            ? 'bg-success/40 border-success/40 text-success'
            : 'bg-warning/40 border-warning/40 text-warning'
        }`}>
          {session
            ? `Caja abierta · ${formatCents(session.expected_cash_cents, symbol)}`
            : 'Caja cerrada'}
        </div>
      </div>

      {!fiscal.ready && (
        <div role="status" className="bg-surface-2/60 border border-line-strong rounded-xl px-4 py-3 text-xs text-body flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted" />
          <span>
            <strong>Modo recibo interno.</strong> Las ventas se cobran y registran con
            normalidad (inventario y caja incluidos), pero <strong>sin comprobante fiscal
            (NCF)</strong>. Si algún día cargas rangos NCF autorizados por la DGII, aquí
            aparecerá la opción de emitir el comprobante fiscal.
          </span>
        </div>
      )}

      {!session && (
        <div role="status" className="bg-warning/40 border border-warning/40 rounded-xl px-4 py-3 text-xs text-warning flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-warning" />
          <span>
            No hay una caja abierta en esta sucursal. Puede cobrar con tarjeta o transferencia,
            pero <strong>no en efectivo</strong> hasta abrir el turno en Control de Caja.
          </span>
        </div>
      )}

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
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                    category === c.id
                      ? 'bg-brand text-on-accent shadow-lg shadow-brand/30'
                      : 'bg-surface text-muted border border-line hover:border-line-strong'
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {tab === 'services' ? (
              services.length === 0 ? (
                <p className="text-xs text-faint italic col-span-full py-8 text-center">
                  No hay servicios con precio para {CATEGORIES.find(c => c.id === category)?.label}.
                </p>
              ) : services.map(s => (
                <button
                  key={s.id}
                  onClick={() => addService(s)}
                  className="p-3.5 bg-surface border border-line hover:border-brand/50 rounded-xl text-left transition-all space-y-1.5 focus:outline-none focus:border-brand"
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
              products.length === 0 ? (
                <p className="text-xs text-faint italic col-span-full py-8 text-center">
                  No hay productos a la venta.
                </p>
              ) : products.map(p => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={p.stock <= 0}
                  className="p-3.5 bg-surface border border-line hover:border-brand/50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-left transition-all space-y-1.5 focus:outline-none focus:border-brand"
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
                <button onClick={soltarOrden} aria-label="Quitar la orden y cobrar una venta suelta"
                  className="p-1 text-muted hover:text-strong flex-shrink-0">
                  <XIcon className="w-4 h-4" />
                </button>
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
                  className="w-full bg-surface border border-line rounded-lg p-2 text-sm text-strong placeholder-faint"
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
                      className="w-full text-left p-2.5 bg-surface border border-line hover:border-brand/50 rounded-lg flex items-center justify-between gap-2">
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

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label htmlFor="pos-cust" className="text-xs font-semibold text-muted uppercase">Cliente</label>
              <input
                id="pos-cust" type="text" value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Consumidor Final"
                className="w-full bg-canvas border border-line rounded-lg p-2 text-strong placeholder-faint"
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
                className="flex-1 bg-canvas border border-line rounded-lg p-2 text-xs text-strong placeholder-faint"
              />
              <button onClick={() => void checkMembego()} disabled={membegoBusy || !membegoPhone.trim()}
                className="px-2.5 rounded-lg bg-warning/20 text-warning hover:bg-warning/30 disabled:opacity-40 text-xs font-bold flex items-center gap-1">
                {membegoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                Membego
              </button>
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
                      <button onClick={() => changeQty(l.key, -1)} aria-label={`Quitar uno de ${l.name}`} className="p-1 text-muted hover:text-strong">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2 font-bold text-strong">{l.quantity}</span>
                      <button onClick={() => changeQty(l.key, 1)} aria-label={`Añadir uno de ${l.name}`} className="p-1 text-muted hover:text-strong">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <span className="font-bold text-brand-hi w-20 text-right">
                    {formatCents(l.unitPriceCents * l.quantity, symbol)}
                  </span>
                  {deLaOrden ? (
                    <span className="w-6" aria-hidden="true" />
                  ) : (
                    <button onClick={() => removeLine(l.key)} aria-label={`Eliminar ${l.name}`} className="text-faint hover:text-danger p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
                  className="flex-1 bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-sm text-strong uppercase"
                  value={promoCode}
                  onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoPreview(null); }}
                  placeholder="Código promocional" />
                {promoPreview?.valid
                  ? <button type="button" onClick={quitarPromo}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body">
                      Quitar
                    </button>
                  : <button type="button" onClick={() => void aplicarPromo()} disabled={promoBusy || !promoCode.trim()}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-surface-2 hover:bg-surface-3 text-body disabled:opacity-50">
                      Aplicar
                    </button>}
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
                      className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        method === m.id
                          ? 'bg-brand text-on-accent border-brand shadow-lg shadow-brand/30'
                          : 'bg-canvas text-muted border-line hover:border-line-strong'
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
