import React, { useEffect, useState } from 'react';
import { Tag, Plus, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents, centsToInput, bpsToPercent } from '../../lib/money';
import { fetchServicesWithPrices, ServiceWithPrices } from '../../data/adminRepository';
import {
  fetchPromotions, upsertPromotion,
  Promotion, PromotionKind, PromotionScope, VehicleCategory
} from '../../data/promotionRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const KINDS: { id: PromotionKind; label: string }[] = [
  { id: 'porcentaje', label: 'Porcentaje' },
  { id: 'importe', label: 'Importe fijo' }
];

const SCOPES: { id: PromotionScope; label: string }[] = [
  { id: 'total', label: 'Toda la venta' },
  { id: 'servicio', label: 'Un servicio' },
  { id: 'categoria', label: 'Una categoría de vehículo' }
];

const CATEGORIES: { id: VehicleCategory; label: string }[] = [
  { id: 'sedan', label: 'Sedán' }, { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep' }, { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' }, { id: 'truck', label: 'Camión' },
  { id: 'motorcycle', label: 'Motocicleta' }, { id: 'special', label: 'Especial' }
];

// 0 = domingo, como extract(dow) en PostgreSQL.
const DAYS = [
  { n: 1, label: 'L' }, { n: 2, label: 'M' }, { n: 3, label: 'X' },
  { n: 4, label: 'J' }, { n: 5, label: 'V' }, { n: 6, label: 'S' }, { n: 0, label: 'D' }
];

const emptyForm = {
  code: '', name: '', kind: 'porcentaje' as PromotionKind, scope: 'total' as PromotionScope,
  percent: '', amount: '', serviceId: '', category: '' as VehicleCategory | '',
  startsOn: '', endsOn: '', weekdays: [] as number[],
  minPurchase: '', maxUses: '', maxPerCustomer: ''
};

/**
 * Promociones y descuentos.
 *
 * Un código con sus reglas —vigencia, día, compra mínima, alcance, topes— cuyo
 * descuento calcula la base. La pantalla no decide importes: el punto de venta
 * previsualiza y la factura recalcula. Es la diferencia entre una promoción y
 * un descuento a dedo.
 */
export const PromotionsSupabaseView: React.FC = () => {
  const { profile, phase, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canManage = ['propietario', 'administrador', 'superadmin'].includes(profile?.role ?? '');

  const [rows, setRows] = useState<Promotion[]>([]);
  const [services, setServices] = useState<ServiceWithPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchPromotions(), fetchServicesWithPrices().catch(() => [])])
      .then(([p, s]) => { setRows(p); setServices(s); })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar las promociones'))
      .finally(() => setLoading(false));
  }, [phase, nonce]);

  const [modal, setModal] = useState<'create' | Promotion | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openCreate = () => { setForm(emptyForm); setError(null); setModal('create'); };
  const openEdit = (p: Promotion) => {
    setForm({
      code: p.code, name: p.name, kind: p.kind, scope: p.scope,
      percent: p.value_bps ? String(p.value_bps / 100) : '',
      amount: p.value_cents ? centsToInput(p.value_cents) : '',
      serviceId: p.service_id ?? '', category: p.vehicle_category ?? '',
      startsOn: p.starts_on, endsOn: p.ends_on ?? '',
      weekdays: p.weekdays ?? [],
      minPurchase: p.min_purchase_cents > 0 ? centsToInput(p.min_purchase_cents) : '',
      maxUses: p.max_uses ? String(p.max_uses) : '',
      maxPerCustomer: p.max_uses_per_customer ? String(p.max_uses_per_customer) : ''
    });
    setError(null); setModal(p);
  };

  const toggleDay = (n: number) =>
    setForm(f => ({
      ...f,
      weekdays: f.weekdays.includes(n) ? f.weekdays.filter(d => d !== n) : [...f.weekdays, n]
    }));

  const submit = async () => {
    if (busy) return;
    if (!form.code.trim()) { setError('La promoción necesita un código.'); return; }
    if (!form.name.trim()) { setError('La promoción necesita un nombre.'); return; }

    const percent = Number(form.percent);
    const amount = parseAmountToCents(form.amount);
    if (form.kind === 'porcentaje' && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
      setError('Indique un porcentaje entre 0 y 100.'); return;
    }
    if (form.kind === 'importe' && (amount === null || amount <= 0)) {
      setError('Indique el importe del descuento.'); return;
    }

    setBusy(true); setError(null);
    try {
      await upsertPromotion({
        code: form.code, name: form.name, kind: form.kind, scope: form.scope,
        promotionId: modal === 'create' ? null : modal?.id,
        valueBps: form.kind === 'porcentaje' ? Math.round(percent * 100) : null,
        valueCents: form.kind === 'importe' ? amount : null,
        serviceId: form.scope === 'servicio' ? form.serviceId : null,
        vehicleCategory: form.scope === 'categoria' ? (form.category || null) : null,
        startsOn: form.startsOn || null,
        endsOn: form.endsOn || null,
        // Sin días marcados = todos los días, que es lo que espera la base.
        weekdays: form.weekdays.length > 0 ? form.weekdays : null,
        minPurchaseCents: parseAmountToCents(form.minPurchase) ?? 0,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        maxUsesPerCustomer: form.maxPerCustomer ? Number(form.maxPerCustomer) : null,
        isActive: modal === 'create' ? true : modal?.is_active
      });
      setModal(null);
      setNotice(`Promoción ${form.code.toUpperCase()} guardada.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la promoción');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (p: Promotion) => {
    try {
      await upsertPromotion({
        code: p.code, name: p.name, kind: p.kind, scope: p.scope, promotionId: p.id,
        valueBps: p.value_bps, valueCents: p.value_cents,
        serviceId: p.service_id, vehicleCategory: p.vehicle_category,
        startsOn: p.starts_on, endsOn: p.ends_on, weekdays: p.weekdays,
        minPurchaseCents: p.min_purchase_cents,
        maxUses: p.max_uses, maxUsesPerCustomer: p.max_uses_per_customer,
        isActive: !p.is_active
      });
      setNotice(p.is_active ? `${p.code} desactivada.` : `${p.code} activada.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    }
  };

  const valueOf = (p: Promotion) =>
    p.kind === 'porcentaje'
      ? bpsToPercent(p.value_bps ?? 0)
      : formatCents(p.value_cents ?? 0, symbol);

  const scopeOf = (p: Promotion) => {
    if (p.scope === 'servicio') return services.find(s => s.id === p.service_id)?.name ?? 'un servicio';
    if (p.scope === 'categoria') return CATEGORIES.find(c => c.id === p.vehicle_category)?.label ?? '—';
    return 'Toda la venta';
  };

  const daysOf = (p: Promotion) =>
    p.weekdays && p.weekdays.length > 0
      ? p.weekdays.map(n => DAYS.find(d => d.n === n)?.label ?? '?').join(' ')
      : 'todos los días';

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<Tag className="w-5 h-5 text-indigo-400" />}
          title="Descuentos" subtitle="Promociones con reglas, no rebajas a dedo" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudieron cargar las promociones" />;
  }

  const techo = company?.max_manual_discount_bps ?? 10000;
  const cols = canManage ? 7 : 6;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Tag className="w-5 h-5 text-indigo-400" />}
        title="Descuentos"
        subtitle="Promociones con reglas, no rebajas a dedo"
        actions={canManage ? (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nueva promoción
          </button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar las promociones, no administrarlas.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !modal && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <InlineAlert tone={techo >= 10000 ? 'warning' : 'success'}>
        <span className="flex items-start gap-1.5">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {techo >= 10000
            ? <>El descuento manual está <strong>sin límite</strong>: quien atiende puede rebajar
                una factura hasta cero. Póngale techo en Configuración › Empresa.</>
            : <>El descuento manual tiene un techo del <strong>{bpsToPercent(techo)}</strong> del
                subtotal. La propiedad y la administración pueden pasarse, y queda en la bitácora.</>}
        </span>
      </InlineAlert>

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Promociones</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">CÓDIGO</th>
                <th scope="col" className="p-3 font-semibold">DESCUENTO</th>
                <th scope="col" className="p-3 font-semibold">APLICA A</th>
                <th scope="col" className="p-3 font-semibold">VIGENCIA</th>
                <th scope="col" className="p-3 font-semibold text-right">USOS</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? <SkeletonRows cols={cols} />
                : rows.length === 0 ? (
                  <EmptyRow cols={cols}>Todavía no hay promociones.</EmptyRow>
                ) : rows.map(p => (
                  <tr key={p.id} className="hover:bg-slate-800/40">
                    <td className="p-3">
                      <div className="font-bold text-white tabular-nums">{p.code}</div>
                      <div className="text-xs text-slate-500">{p.name}</div>
                    </td>
                    <td className="p-3 font-bold text-emerald-400 tabular-nums">{valueOf(p)}</td>
                    <td className="p-3 text-slate-400">
                      <div>{scopeOf(p)}</div>
                      {p.min_purchase_cents > 0 && (
                        <div className="text-xs text-slate-500">
                          desde {formatCents(p.min_purchase_cents, symbol)}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-slate-400 tabular-nums">
                      <div>{p.starts_on} {p.ends_on ? `→ ${p.ends_on}` : '→ sin fin'}</div>
                      <div className="text-xs text-slate-500">{daysOf(p)}</div>
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">
                      {p.uses_count}{p.max_uses ? ` / ${p.max_uses}` : ''}
                      {p.max_uses_per_customer && (
                        <div className="text-xs text-slate-500">
                          máx. {p.max_uses_per_customer} por cliente
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      {p.is_active
                        ? <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-xs">Activa</span>
                        : <span className="bg-slate-700/50 text-slate-400 font-bold px-2 py-0.5 rounded text-xs">Inactiva</span>}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(p)}
                          className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                          Editar
                        </button>
                        <button onClick={() => void toggleActive(p)}
                          className="ml-1 px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                          {p.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <FormModal
          title={modal === 'create' ? 'Nueva promoción' : `Editar — ${modal.code}`}
          submitLabel={modal === 'create' ? 'Crear promoción' : 'Guardar cambios'}
          busy={busy}
          error={error}
          onSubmit={() => void submit()}
          onClose={() => setModal(null)}
          onDismissError={() => setError(null)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código *" htmlFor="promo-code">
              <input id="promo-code" className={textInputClass} value={form.code} autoFocus
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="MARTES2X1" />
            </Field>
            <Field label="Nombre *" htmlFor="promo-name">
              <input id="promo-name" className={textInputClass} value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Martes de lavado" />
            </Field>
          </div>

          <Field label="Tipo de descuento" htmlFor="promo-kind">
            <select id="promo-kind" className={textInputClass} value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value as PromotionKind }))}>
              {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </Field>
          {form.kind === 'porcentaje' ? (
            <Field label="Porcentaje (%)" htmlFor="promo-percent">
              <input id="promo-percent" className={textInputClass} value={form.percent}
                inputMode="decimal" onChange={e => setForm(f => ({ ...f, percent: e.target.value }))}
                placeholder="10" />
            </Field>
          ) : (
            <Field label="Importe a descontar" htmlFor="promo-amount">
              <input id="promo-amount" className={textInputClass} value={form.amount}
                inputMode="decimal" onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </Field>
          )}

          <Field label="Aplica a" htmlFor="promo-scope">
            <select id="promo-scope" className={textInputClass} value={form.scope}
              onChange={e => setForm(f => ({ ...f, scope: e.target.value as PromotionScope }))}>
              {SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          {form.scope === 'servicio' && (
            <Field label="Servicio" htmlFor="promo-service">
              <select id="promo-service" className={textInputClass} value={form.serviceId}
                onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
                <option value="">Elija el servicio…</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {form.scope === 'categoria' && (
            <Field label="Categoría" htmlFor="promo-category">
              <select id="promo-category" className={textInputClass} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as VehicleCategory }))}>
                <option value="">Elija la categoría…</option>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde" htmlFor="promo-from">
              <input id="promo-from" type="date" className={textInputClass} value={form.startsOn}
                onChange={e => setForm(f => ({ ...f, startsOn: e.target.value }))} />
            </Field>
            <Field label="Hasta" htmlFor="promo-to">
              <input id="promo-to" type="date" className={textInputClass} value={form.endsOn}
                onChange={e => setForm(f => ({ ...f, endsOn: e.target.value }))} />
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm text-slate-400 mb-1.5">Días en que aplica</legend>
            <div className="flex gap-1.5">
              {DAYS.map(d => (
                <button key={d.n} type="button" onClick={() => toggleDay(d.n)}
                  aria-pressed={form.weekdays.includes(d.n)}
                  className={`w-9 h-9 rounded-lg font-bold text-xs ${
                    form.weekdays.includes(d.n)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">Sin marcar ninguno, aplica todos los días.</p>
          </fieldset>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Compra mínima" htmlFor="promo-min">
              <input id="promo-min" className={textInputClass} value={form.minPurchase}
                inputMode="decimal" onChange={e => setForm(f => ({ ...f, minPurchase: e.target.value }))} />
            </Field>
            <Field label="Usos totales" htmlFor="promo-max">
              <input id="promo-max" className={textInputClass} value={form.maxUses}
                inputMode="numeric" onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                placeholder="sin tope" />
            </Field>
            <Field label="Por cliente" htmlFor="promo-percli">
              <input id="promo-percli" className={textInputClass} value={form.maxPerCustomer}
                inputMode="numeric" onChange={e => setForm(f => ({ ...f, maxPerCustomer: e.target.value }))}
                placeholder="sin tope" />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Un tope por cliente obliga a identificarlo al cobrar: sin saber quién es,
            no se puede contar cuántas veces la usó.
          </p>
        </FormModal>
      )}
    </div>
  );
};
