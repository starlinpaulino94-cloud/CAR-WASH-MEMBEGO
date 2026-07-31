import React, { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Check, X, Pencil, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents, centsToInput, bpsToPercent } from '../../lib/money';
import {
  fetchServicesWithPrices, upsertServicePrice, createService, ServiceWithPrices, VehicleCategory
} from '../../data/adminRepository';
import { ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice } from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const emptyServiceForm = {
  name: '', code: '', description: '', minutes: '30', commission: '0',
  membego: false, prices: {} as Record<string, string>
};

const COLUMNS: { id: VehicleCategory; label: string }[] = [
  { id: 'sedan', label: 'Sedán' },
  { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' },
  { id: 'motorcycle', label: 'Moto' }
];

/**
 * Catálogo y matriz de precios.
 *
 * Los precios se editan celda a celda contra `service_prices`, que es una
 * tabla: añadir una categoría de vehículo ya no exige migrar un tipo. Cambiar
 * un precio está restringido por rol y RLS lo aplica igual desde el API.
 */
export const ServicesSupabaseView: React.FC = () => {
  const { company, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const editable = can(profile, 'manageCatalog');

  const [rows, setRows] = useState<ServiceWithPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ serviceId: string; category: VehicleCategory } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyServiceForm);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await fetchServicesWithPrices()); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setForm(emptyServiceForm); setCreateError(null); setShowCreate(true); };

  const submitCreate = async () => {
    if (!company) return;
    if (!form.name.trim() || !form.code.trim()) { setCreateError('El nombre y el código son obligatorios.'); return; }
    const minutes = Number(form.minutes);
    if (!Number.isInteger(minutes) || minutes <= 0) { setCreateError('La duración debe ser un número de minutos mayor que cero.'); return; }
    const commissionPct = Number(form.commission);
    if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) { setCreateError('La comisión debe estar entre 0 y 100 %.'); return; }

    const prices = COLUMNS.map(c => ({
      category: c.id,
      priceCents: parseAmountToCents(form.prices[c.id] ?? '') ?? 0
    }));
    setCreateBusy(true); setCreateError(null);
    try {
      await createService({
        companyId: company.id, code: form.code, name: form.name,
        description: form.description, estimatedMinutes: minutes,
        commissionBps: Math.round(commissionPct * 100),
        includedInMembego: form.membego, prices
      });
      setShowCreate(false); setForm(emptyServiceForm);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo crear el servicio');
    } finally {
      setCreateBusy(false);
    }
  };

  const startEdit = (serviceId: string, category: VehicleCategory, current?: number) => {
    if (!editable) return;
    setEditing({ serviceId, category });
    setDraft(current !== undefined ? centsToInput(current) : '');
    setActionError(null);
  };

  const commit = async () => {
    if (!editing || busy) return;
    const cents = parseAmountToCents(draft);
    if (cents === null || cents < 0) { setActionError('Introduzca un precio válido.'); return; }
    setBusy(true);
    try {
      await upsertServicePrice(editing.serviceId, editing.category, cents);
      setEditing(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo guardar el precio');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => void load()} title="No se pudo cargar el catálogo" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Layers className="w-5 h-5 text-indigo-400" />}
        title="Servicios y matriz de precios"
        subtitle="Tarifa por categoría de vehículo y comisión por lavador"
        actions={editable ? (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nuevo servicio
          </button>
        ) : undefined}
      />

      {!editable && (
        <ReadOnlyNotice>
          Su rol permite consultar el catálogo, pero no cambiar precios.
        </ReadOnlyNotice>
      )}
      {actionError && <InlineAlert tone="error" onDismiss={() => setActionError(null)}>{actionError}</InlineAlert>}
      {editable && (
        <p className="text-[11px] text-slate-500">
          Toque un precio para editarlo. Enter guarda, Escape cancela.
        </p>
      )}

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Matriz de precios por servicio y categoría</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">SERVICIO</th>
                {COLUMNS.map(c => (
                  <th key={c.id} scope="col" className="p-3 font-semibold text-right whitespace-nowrap">
                    {c.label.toUpperCase()}
                  </th>
                ))}
                <th scope="col" className="p-3 font-semibold text-right">COMISIÓN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} aria-hidden="true">
                    <td colSpan={COLUMNS.length + 2} className="p-3">
                      <div className="h-5 bg-slate-800/60 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="p-10 text-center text-slate-500 italic">
                    Todavía no hay servicios en el catálogo.
                  </td>
                </tr>
              ) : rows.map(s => (
                <tr key={s.id} className={`hover:bg-slate-800/40 ${s.is_active ? '' : 'opacity-50'}`}>
                  <td className="p-3">
                    <div className="font-bold text-white">{s.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {s.code} · {s.estimated_minutes} min
                      {!s.is_active && ' · inactivo'}
                    </div>
                  </td>
                  {COLUMNS.map(c => {
                    const price = s.prices[c.id];
                    const isEditing = editing?.serviceId === s.id && editing.category === c.id;
                    return (
                      <td key={c.id} className="p-2 text-right">
                        {isEditing ? (
                          <span className="flex items-center gap-1 justify-end">
                            <input
                              autoFocus type="text" inputMode="decimal" value={draft} disabled={busy}
                              onChange={e => setDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void commit();
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              aria-label={`Precio de ${s.name} para ${c.label}`}
                              className="w-20 bg-slate-950 border border-indigo-500 rounded p-1 text-right text-white"
                            />
                            <button onClick={() => void commit()} disabled={busy} aria-label="Guardar"
                              className="p-1 text-emerald-400 hover:text-emerald-300">
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setEditing(null)} disabled={busy} aria-label="Cancelar"
                              className="p-1 text-slate-500 hover:text-slate-300">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => startEdit(s.id, c.id, price)}
                            disabled={!editable}
                            aria-label={`Precio de ${s.name} para ${c.label}`}
                            className={`px-2 py-1 rounded font-bold tabular-nums whitespace-nowrap ${
                              editable ? 'hover:bg-slate-800 text-slate-200' : 'text-slate-300 cursor-default'
                            } ${price === undefined ? 'text-slate-600 italic font-normal' : ''}`}
                          >
                            {price === undefined ? 'sin precio' : formatCents(price, symbol)}
                            {editable && price !== undefined && <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-3 font-bold text-indigo-400 text-right">{bpsToPercent(s.commission_bps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Un servicio sin precio para una categoría no se ofrece en el punto de venta ni al
        registrar la llegada: facturarlo fallaría.
      </p>

      {showCreate && (
        <FormModal
          title="Nuevo servicio"
          submitLabel="Crear servicio"
          busy={createBusy}
          error={createError}
          onSubmit={() => void submitCreate()}
          onClose={() => setShowCreate(false)}
          onDismissError={() => setCreateError(null)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *" htmlFor="svc-name">
              <input id="svc-name" className={textInputClass} value={form.name} autoFocus
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Lavado completo" />
            </Field>
            <Field label="Código *" htmlFor="svc-code" hint="Único en la empresa.">
              <input id="svc-code" className={textInputClass} value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="LAV-01" />
            </Field>
          </div>

          <Field label="Descripción" htmlFor="svc-desc">
            <input id="svc-desc" className={textInputClass} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Exterior + interior + aromatizante" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duración (min)" htmlFor="svc-min">
              <input id="svc-min" type="number" min={1} className={textInputClass} value={form.minutes}
                onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))} />
            </Field>
            <Field label="Comisión (%)" htmlFor="svc-com" hint="Del lavador, sobre el servicio.">
              <input id="svc-com" type="number" min={0} max={100} step="0.5" className={textInputClass} value={form.commission}
                onChange={e => setForm(f => ({ ...f, commission: e.target.value }))} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.membego} className="accent-indigo-600"
              onChange={e => setForm(f => ({ ...f, membego: e.target.checked }))} />
            Incluido en el beneficio Membego
          </label>

          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Precio por categoría ({symbol})
            </div>
            <p className="text-[10px] text-slate-500">
              Deje en blanco las categorías que este servicio no cubre.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {COLUMNS.map(c => (
                <div key={c.id} className="space-y-1">
                  <label htmlFor={`svc-price-${c.id}`} className="block text-[10px] text-slate-400">{c.label}</label>
                  <input id={`svc-price-${c.id}`} type="text" inputMode="decimal"
                    className={textInputClass} value={form.prices[c.id] ?? ''}
                    onChange={e => setForm(f => ({ ...f, prices: { ...f.prices, [c.id]: e.target.value } }))}
                    placeholder="0.00" />
                </div>
              ))}
            </div>
          </div>
        </FormModal>
      )}
    </div>
  );
};
