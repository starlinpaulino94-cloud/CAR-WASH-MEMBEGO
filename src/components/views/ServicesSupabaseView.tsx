import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Loader2, Check, X, Pencil, Plus, FlaskConical, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents, centsToInput, bpsToPercent } from '../../lib/money';
import {
  fetchServicesWithPrices, upsertServicePrice, createService, updateService,
  eliminarFila, archivarFila, ServiceWithPrices, VehicleCategory
} from '../../data/adminRepository';
import { ConfirmarEliminar } from '../common/ConfirmarEliminar';
import { ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, HelpNote } from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { RecipeModal } from '../modals/RecipeModal';
import { ExportButton } from '../common/ExportButton';
import { ImportButton } from '../common/ImportModal';
import { servicesExport } from '../../lib/exportSpecs';

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
  const [recipeFor, setRecipeFor] = useState<{ id: string; name: string } | null>(null);

  const [rows, setRows] = useState<ServiceWithPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ serviceId: string; category: VehicleCategory } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * La FICHA del servicio, que es lo que no se podía tocar.
   *
   * Hasta aquí solo se editaban los precios celda a celda: un servicio con el
   * nombre mal escrito se quedaba así, y para «quitarlo» del catálogo no había
   * nada — ni desactivar ni borrar.
   */
  const puedeBorrar = can(profile, 'deleteRecords');
  const [fichaDe, setFichaDe] = useState<ServiceWithPrices | null>(null);
  const [borrando, setBorrando] = useState<ServiceWithPrices | null>(null);
  const [ficha, setFicha] = useState({ name: '', code: '', description: '', minutes: '', commission: '', membego: false });
  const [fichaBusy, setFichaBusy] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);

  const abrirFicha = (s: ServiceWithPrices) => {
    setFicha({
      name: s.name, code: s.code, description: s.description ?? '',
      minutes: String(s.estimated_minutes),
      commission: bpsToPercent(s.commission_bps).replace('%', '').trim(),
      membego: s.included_in_membego
    });
    setFichaError(null);
    setFichaDe(s);
  };

  const guardarFicha = async () => {
    if (!fichaDe) return;
    if (!ficha.name.trim()) { setFichaError('El nombre es obligatorio.'); return; }
    const minutos = Number(ficha.minutes);
    if (!Number.isFinite(minutos) || minutos <= 0) {
      setFichaError('Los minutos estimados deben ser un número mayor que cero.'); return;
    }
    const pct = Number(ficha.commission);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setFichaError('La comisión debe ir entre 0 y 100.'); return;
    }
    setFichaBusy(true);
    setFichaError(null);
    try {
      await updateService(fichaDe.id, {
        name: ficha.name.trim(),
        code: ficha.code.trim(),
        description: ficha.description.trim(),
        estimated_minutes: Math.round(minutos),
        // La comisión se guarda en puntos base, no en porcentaje: 12,5 % es 1250
        // y no 12,5 — con decimales de por medio, el redondeo se hace aquí una
        // vez y no en cada lectura.
        commission_bps: Math.round(pct * 100),
        included_in_membego: ficha.membego
      });
      setFichaDe(null);
      await load();
    } catch (err) {
      setFichaError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setFichaBusy(false);
    }
  };

  const alternarActivo = async (s: ServiceWithPrices) => {
    try {
      await archivarFila('services', s.id, s.is_active);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.');
    }
  };

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
        title="Servicios y matriz de precios"
        subtitle="Tarifa por categoría de vehículo y comisión por lavador"
        actions={
          <>
            <ExportButton {...servicesExport()} />
            {can(profile, 'importData') && (
              <ImportButton entity="servicios" onImported={() => void load()} />
            )}
            {editable && (
              <Button size="sm" onClick={openCreate}
                >
                <Plus className="w-4 h-4" /> Nuevo servicio
              </Button>
            )}
          </>
        }
      />

      {!editable && (
        <ReadOnlyNotice>
          Su rol permite consultar el catálogo, pero no cambiar precios.
        </ReadOnlyNotice>
      )}
      {actionError && <InlineAlert tone="error" onDismiss={() => setActionError(null)}>{actionError}</InlineAlert>}
      {editable && (
        <p className="text-xs text-faint">
          Toque un precio para editarlo. Enter guarda, Escape cancela.
        </p>
      )}

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Matriz de precios por servicio y categoría</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">SERVICIO</th>
                {COLUMNS.map(c => (
                  <th key={c.id} scope="col" className="p-3 font-semibold text-right whitespace-nowrap">
                    {c.label.toUpperCase()}
                  </th>
                ))}
                <th scope="col" className="p-3 font-semibold text-right">COMISIÓN</th>
                <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} aria-hidden="true">
                    <td colSpan={COLUMNS.length + 3} className="p-3">
                      <div className="h-5 bg-surface-2/60 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="p-10 text-center text-faint italic">
                    Todavía no hay servicios en el catálogo.
                  </td>
                </tr>
              ) : rows.map(s => (
                <tr key={s.id} className={`hover:bg-surface-2/40 ${s.is_active ? '' : 'opacity-50'}`}>
                  <td className="p-3">
                    <div className="font-bold text-strong">{s.name}</div>
                    <div className="text-xs text-muted">
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
                              className="w-20 bg-canvas border border-brand rounded p-1 text-right text-strong"
                            />
                            <button onClick={() => void commit()} disabled={busy} aria-label="Guardar"
                              className="p-1 text-success hover:text-success">
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setEditing(null)} disabled={busy} aria-label="Cancelar"
                              className="p-1 text-faint hover:text-body">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => startEdit(s.id, c.id, price)}
                            disabled={!editable}
                            aria-label={`Precio de ${s.name} para ${c.label}`}
                            className={`px-2 py-1 rounded font-bold tabular-nums whitespace-nowrap ${
                              editable ? 'hover:bg-surface-2 text-body' : 'text-body cursor-default'
                            } ${price === undefined ? 'text-faint italic font-normal' : ''}`}
                          >
                            {price === undefined ? 'sin precio' : formatCents(price, symbol)}
                            {editable && price !== undefined && <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-3 font-bold text-brand text-right">{bpsToPercent(s.commission_bps)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setRecipeFor({ id: s.id, name: s.name })}
                        aria-label={`Receta de ${s.name}`}
                        title="Insumos que consume este servicio"
                        className="p-1.5 text-brand-2 hover:text-brand-2 rounded-lg hover:bg-surface-2">
                        <FlaskConical className="w-4 h-4" />
                      </button>
                      {editable && (
                        <Button variant="ghost" size="icon-sm" onClick={() => abrirFicha(s)} aria-label={`Editar ${s.name}`}
                          title="Nombre, código, minutos y comisión"
                          >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {puedeBorrar && (
                        <>
                          <Button variant="ghost" size="icon-sm" onClick={() => void alternarActivo(s)}
                            aria-label={`${s.is_active ? 'Desactivar' : 'Activar'} ${s.name}`}
                            title={s.is_active
                              ? 'Deja de ofrecerse en caja y recepción'
                              : 'Vuelve a ofrecerse'}
                            >
                            {s.is_active ? <Archive className="w-4 h-4" /> : <ArchiveRestore className="w-4 h-4" />}
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="text-muted hover:text-danger" onClick={() => setBorrando(s)} aria-label={`Eliminar ${s.name}`}
                            >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <HelpNote summary="Qué pasa si falta un precio">
        Un servicio sin precio para una categoría no se ofrece en el punto de venta
        ni al registrar la llegada: facturarlo fallaría.
      </HelpNote>

      {recipeFor && (
        <RecipeModal serviceId={recipeFor.id} serviceName={recipeFor.name}
          onClose={() => setRecipeFor(null)} />
      )}

      {fichaDe && (
        <FormModal
          title={`Editar — ${fichaDe.name}`}
          submitLabel="Guardar cambios"
          busy={fichaBusy}
          error={fichaError}
          onSubmit={() => void guardarFicha()}
          onClose={() => setFichaDe(null)}
          onDismissError={() => setFichaError(null)}
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Nombre" htmlFor="ed-srv-name">
                <input id="ed-srv-name" className={textInputClass} value={ficha.name} autoFocus
                  onChange={e => setFicha(f => ({ ...f, name: e.target.value }))} />
              </Field>
            </div>
            <Field label="Código" htmlFor="ed-srv-code">
              <input id="ed-srv-code" className={textInputClass} value={ficha.code}
                onChange={e => setFicha(f => ({ ...f, code: e.target.value }))} />
            </Field>
          </div>
          <Field label="Descripción" htmlFor="ed-srv-desc">
            <textarea id="ed-srv-desc" rows={2} className={textInputClass} value={ficha.description}
              onChange={e => setFicha(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minutos estimados" htmlFor="ed-srv-min">
              <input id="ed-srv-min" type="number" min="1" className={textInputClass} value={ficha.minutes}
                onChange={e => setFicha(f => ({ ...f, minutes: e.target.value }))} />
            </Field>
            <Field label="Comisión %" htmlFor="ed-srv-com">
              <input id="ed-srv-com" type="number" min="0" max="100" step="0.5"
                className={textInputClass} value={ficha.commission}
                onChange={e => setFicha(f => ({ ...f, commission: e.target.value }))} />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-body">
            <input type="checkbox" checked={ficha.membego} className="accent-brand mt-0.5"
              onChange={e => setFicha(f => ({ ...f, membego: e.target.checked }))} />
            <span>
              Entra en las membresías de Membego
              <span className="block text-xs text-faint">
                Solo los servicios marcados se pueden cubrir con una membresía.
              </span>
            </span>
          </label>
          <p className="text-xs text-faint">
            Los precios por categoría se editan en la tabla, tocando cada celda.
          </p>
        </FormModal>
      )}

      {borrando && (
        <ConfirmarEliminar
          queEs="el servicio"
          nombre={borrando.name}
          onEliminar={() => eliminarFila('services', borrando.id)}
          onArchivar={() => archivarFila('services', borrando.id, true)}
          onCerrar={() => setBorrando(null)}
          onHecho={() => void load()}
        />
      )}

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

          <label className="flex items-center gap-2 text-xs text-body cursor-pointer">
            <input type="checkbox" checked={form.membego} className="accent-brand"
              onChange={e => setForm(f => ({ ...f, membego: e.target.checked }))} />
            Incluido en el beneficio Membego
          </label>

          <div className="space-y-2 pt-1">
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">
              Precio por categoría ({symbol})
            </div>
            <p className="text-xs text-faint">
              Deje en blanco las categorías que este servicio no cubre.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {COLUMNS.map(c => (
                <div key={c.id} className="space-y-1">
                  <label htmlFor={`svc-price-${c.id}`} className="block text-xs text-muted">{c.label}</label>
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
