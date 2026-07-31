import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingBag, Plus, Minus, Trash2, CreditCard, Banknote, Building,
  CheckCircle2, Loader2, AlertCircle, RefreshCw, Receipt, BadgeCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents, centsToInput, taxFromBps, bpsToPercent } from '../../lib/money';
import {
  fetchServices, fetchProducts, fetchOpenCashSession, createInvoice, fetchFiscalStatus,
  lookupMembegoByPhone,
  ServiceWithPrice, Product, CashSession, CartLine, VehicleCategory, PaymentMethod, Invoice,
  FiscalStatus, MembegoBenefitSummary
} from '../../data/billingRepository';

const CATEGORIES: { id: VehicleCategory; label: string }[] = [
  { id: 'sedan', label: 'Sedán' },
  { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep 4x4' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' },
  { id: 'motorcycle', label: 'Moto' }
];

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
  { id: 'transferencia', label: 'Transfer', icon: Building }
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

  // Previsualización. La cifra que vale es la que devuelve create_invoice().
  const preview = useMemo(() => {
    const subtotal = lines.reduce((acc, l) => acc + l.unitPriceCents * l.quantity, 0);
    const discount = lines.reduce((acc, l) => acc + (l.isMembegoCovered ? 0 : l.discountCents), 0);
    const membego = lines.reduce((acc, l) => acc + (l.isMembegoCovered ? l.unitPriceCents * l.quantity : 0), 0);
    const taxable = Math.max(0, subtotal - discount - membego);
    const tax = taxFromBps(taxable, taxRateBps);
    return { subtotal, discount, membego, tax, total: taxable + tax };
  }, [lines, taxRateBps]);

  const tenderedCents = parseAmountToCents(tenderedInput);
  const effectiveTendered = method === 'efectivo'
    ? (tenderedCents ?? 0)
    : preview.total;
  const change = Math.max(0, effectiveTendered - preview.total);

  const needsCashSession = method === 'efectivo';
  // El cobro NO depende de la facturación fiscal: sin NCF configurado se emite un
  // recibo interno (sin comprobante fiscal). Si hay rangos NCF, se ofrece además
  // emitir el comprobante fiscal.
  const canCheckout =
    lines.length > 0 &&
    !submitting &&
    can(profile, 'issueInvoice') &&
    (!needsCashSession || session !== null) &&
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
        customerName: customerName.trim() || 'Consumidor Final',
        customerTaxId: customerTaxId.trim() || null,
        vehiclePlate: vehiclePlate.trim().toUpperCase() || null,
        ncfType: wantsNcf ? (customerTaxId.trim() ? 'B01' : 'B02') : null,
        cashSessionId: session?.id ?? null
      });

      setLastInvoice(invoice);
      // La venta terminó: a partir de aquí, la siguiente es otra operación.
      requestIdRef.current = null;
      setLines([]);
      setCustomerName('');
      setVehiclePlate('');
      setCustomerTaxId('');
      setTenderedInput('');
      setMembegoPhone(''); setMembegoSummary(null); setMembegoSearched(false);
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
        <div className="h-8 w-64 bg-slate-800/60 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="lg:col-span-5 h-96 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar el punto de venta
          </div>
          <p className="text-xs text-slate-300">{loadError}</p>
          <button
            onClick={() => void load()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-indigo-400" /> Punto de Venta
          </h2>
          <p className="text-xs text-slate-400">
            {branch?.name} · Cajero: <strong className="text-slate-200">{profile?.full_name}</strong>
          </p>
        </div>
        <div className={`text-xs px-3 py-1.5 rounded-xl border font-semibold ${
          session
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
        }`}>
          {session
            ? `Caja abierta · ${formatCents(session.expected_cash_cents, symbol)}`
            : 'Caja cerrada'}
        </div>
      </div>

      {!fiscal.ready && (
        <div role="status" className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
          <span>
            <strong>Modo recibo interno.</strong> Las ventas se cobran y registran con
            normalidad (inventario y caja incluidos), pero <strong>sin comprobante fiscal
            (NCF)</strong>. Si algún día cargas rangos NCF autorizados por la DGII, aquí
            aparecerá la opción de emitir el comprobante fiscal.
          </span>
        </div>
      )}

      {!session && (
        <div role="status" className="bg-amber-950/40 border border-amber-500/40 rounded-xl px-4 py-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
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
            <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">
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
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex border-b border-slate-800 gap-4 text-xs font-bold" role="tablist">
            {(['services', 'products'] as const).map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`pb-2 border-b-2 transition-colors ${
                  tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500'
                }`}
              >
                {t === 'services' ? 'Servicios' : 'Productos'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {tab === 'services' ? (
              services.length === 0 ? (
                <p className="text-xs text-slate-500 italic col-span-full py-8 text-center">
                  No hay servicios con precio para {CATEGORIES.find(c => c.id === category)?.label}.
                </p>
              ) : services.map(s => (
                <button
                  key={s.id}
                  onClick={() => addService(s)}
                  className="p-3.5 bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-xl text-left transition-all space-y-1.5 focus:outline-none focus:border-indigo-500"
                >
                  <span className="flex justify-between font-bold text-xs text-white gap-2">
                    <span>{s.name}</span>
                    <span className="text-indigo-400 font-extrabold whitespace-nowrap">
                      {formatCents(s.price_cents, symbol)}
                    </span>
                  </span>
                  <span className="block text-[11px] text-slate-400 line-clamp-2">{s.description}</span>
                </button>
              ))
            ) : (
              products.length === 0 ? (
                <p className="text-xs text-slate-500 italic col-span-full py-8 text-center">
                  No hay productos a la venta.
                </p>
              ) : products.map(p => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={p.stock <= 0}
                  className="p-3.5 bg-slate-900 border border-slate-800 hover:border-indigo-500/50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-left transition-all space-y-1.5 focus:outline-none focus:border-indigo-500"
                >
                  <span className="flex justify-between font-bold text-xs text-white gap-2">
                    <span>{p.name}</span>
                    <span className="text-indigo-400 font-extrabold whitespace-nowrap">
                      {formatCents(p.price_cents, symbol)}
                    </span>
                  </span>
                  <span className={`block text-[10px] ${p.stock <= p.min_stock ? 'text-amber-400' : 'text-slate-400'}`}>
                    Stock: {p.stock} {p.unit}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Carrito y cobro */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-bold text-white text-sm">Venta</h3>
            <span className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded font-bold">
              {lines.length} {lines.length === 1 ? 'ítem' : 'ítems'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label htmlFor="pos-cust" className="text-[10px] font-semibold text-slate-400 uppercase">Cliente</label>
              <input
                id="pos-cust" type="text" value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Consumidor Final"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white placeholder-slate-600"
              />
            </div>
            <div>
              <label htmlFor="pos-plate" className="text-[10px] font-semibold text-slate-400 uppercase">Placa</label>
              <input
                id="pos-plate" type="text" value={vehiclePlate}
                onChange={e => setVehiclePlate(e.target.value.toUpperCase())}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white uppercase font-bold"
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
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600"
              />
              <button onClick={() => void checkMembego()} disabled={membegoBusy || !membegoPhone.trim()}
                className="px-2.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40 text-xs font-bold flex items-center gap-1">
                {membegoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                Membego
              </button>
            </div>
            {membegoSummary && (
              <div role="status" className="flex items-center gap-2 p-2 bg-amber-950/30 border border-amber-500/40 rounded-lg text-[11px] text-amber-200">
                <BadgeCheck className="w-4 h-4 flex-shrink-0 text-amber-400" />
                <span>
                  <strong>{membegoSummary.customerName}</strong>
                  {membegoSummary.tier && <> · {membegoSummary.tier}</>}
                  {' · '}{membegoSummary.activeMemberships} membresía(s)
                  {' · '}<strong>{membegoSummary.availablePromotions} oferta(s) disponible(s)</strong>
                </span>
              </div>
            )}
            {membegoSearched && !membegoSummary && !membegoBusy && (
              <p className="text-[10px] text-slate-500">Sin beneficios de Membego para ese teléfono.</p>
            )}
          </div>

          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 flex-1">
            {lines.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-500 italic">
                Toque un servicio o producto para añadirlo
              </p>
            ) : lines.map(l => (
              <div key={l.key} className="p-2.5 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs gap-2">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="font-bold text-white truncate">{l.name}</div>
                  <div className="text-[10px] text-slate-400">{formatCents(l.unitPriceCents, symbol)} c/u</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg">
                    <button onClick={() => changeQty(l.key, -1)} aria-label={`Quitar uno de ${l.name}`} className="p-1 text-slate-400 hover:text-white">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="px-2 font-bold text-white">{l.quantity}</span>
                    <button onClick={() => changeQty(l.key, 1)} aria-label={`Añadir uno de ${l.name}`} className="p-1 text-slate-400 hover:text-white">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="font-bold text-indigo-300 w-20 text-right">
                    {formatCents(l.unitPriceCents * l.quantity, symbol)}
                  </span>
                  <button onClick={() => removeLine(l.key)} aria-label={`Eliminar ${l.name}`} className="text-slate-500 hover:text-rose-400 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4 pt-4 border-t border-slate-800">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span><span>{formatCents(preview.subtotal, symbol)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>ITBIS ({bpsToPercent(taxRateBps)})</span><span>{formatCents(preview.tax, symbol)}</span>
              </div>
              <div className="flex justify-between font-black text-base text-white border-t border-slate-800 pt-1.5">
                <span>Total</span>
                <span className="text-indigo-400">{formatCents(preview.total, symbol)}</span>
              </div>
              <p className="text-[10px] text-slate-500 pt-1">
                Cifras de referencia: el importe definitivo lo calcula el servidor al emitir.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Método de pago</span>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                {METHODS.map(m => {
                  const Icon = m.icon;
                  const blocked = m.id === 'efectivo' && !session;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      disabled={blocked}
                      aria-pressed={method === m.id}
                      title={blocked ? 'Requiere caja abierta' : undefined}
                      className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        method === m.id
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />{m.label}
                    </button>
                  );
                })}
              </div>

              {method === 'efectivo' && (
                <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                  <label htmlFor="pos-tendered" className="text-slate-400">Recibido</label>
                  <input
                    id="pos-tendered"
                    type="text"
                    inputMode="decimal"
                    value={tenderedInput}
                    onChange={e => setTenderedInput(e.target.value)}
                    placeholder={centsToInput(preview.total)}
                    className="w-28 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-right font-bold text-white placeholder-slate-600"
                  />
                  <span className="text-slate-400">
                    Cambio <strong className="text-emerald-400">{formatCents(change, symbol)}</strong>
                  </span>
                </div>
              )}

              {fiscal.ready && (
              <label className="flex items-center gap-2 text-[11px] text-slate-400 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wantsNcf}
                  onChange={e => setWantsNcf(e.target.checked)}
                  className="accent-indigo-600"
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600"
                />
              )}
            </div>

            {submitError && (
              <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
                <div className="space-y-1">
                  <p>{submitError}</p>
                  <p className="text-[10px] text-rose-300/80">
                    Puede reintentar sin miedo a cobrar dos veces: la operación conserva su
                    identificador y el servidor la reconoce.
                  </p>
                </div>
              </div>
            )}

            {lastInvoice && (
              <div role="status" className="flex items-start gap-2 p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-200">
                <Receipt className="w-4 h-4 flex-shrink-0 text-emerald-400 mt-0.5" />
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
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-black text-sm rounded-xl shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Emitiendo…</>
                : <><CheckCircle2 className="w-5 h-5" /> Cobrar {formatCents(preview.total, symbol)}</>}
            </button>

            {!can(profile, 'issueInvoice') && (
              <p className="text-[11px] text-amber-400 text-center">
                Su rol no permite emitir facturas.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
