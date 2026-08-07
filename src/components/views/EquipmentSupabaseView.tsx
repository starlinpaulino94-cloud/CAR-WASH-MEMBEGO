import React, { useCallback, useEffect, useState } from 'react';
import { Wrench, Plus, AlertTriangle, CheckCircle2, History, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchEquipmentPage, createEquipment, fetchMaintenanceHistory,
  openMaintenance, completeMaintenance, Equipment, MaintenanceOrder, MaintenanceKind
} from '../../data/equipmentRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const PAGE_SIZE = 25;

const emptyForm = {
  code: '', name: '', category: '', brand: '', model: '', serial: '',
  purchaseDate: '', purchaseCost: '', warranty: '', everyDays: '', nextService: ''
};

const STATUS_TONE: Record<string, string> = {
  operativo: 'bg-emerald-500/20 text-emerald-400',
  mantenimiento: 'bg-amber-500/20 text-amber-300',
  fuera_servicio: 'bg-rose-500/20 text-rose-400',
  retirado: 'bg-slate-700/50 text-slate-400'
};
const STATUS_LABEL: Record<string, string> = {
  operativo: 'Operativo', mantenimiento: 'En mantenimiento',
  fuera_servicio: 'Fuera de servicio', retirado: 'Retirado'
};

/**
 * Equipos y su mantenimiento.
 *
 * Cada hidrolavadora, aspiradora o compresor con su serie, garantía y próxima
 * revisión. Abrir una intervención lo saca de operación; cerrarla acumula el
 * costo, suma el tiempo fuera de servicio y reprograma el preventivo.
 */
export const EquipmentSupabaseView: React.FC = () => {
  const { company, branch, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canManage = ['propietario', 'administrador', 'supervisor', 'superadmin']
    .includes(profile?.role ?? '');

  const q = usePagedQuery<Equipment>({
    fetcher: fetchEquipmentPage,
    pageSize: PAGE_SIZE,
    enabled: phase === 'ready'
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Panel de intervención (abrir o cerrar) del equipo seleccionado.
  const [target, setTarget] = useState<Equipment | null>(null);
  const [history, setHistory] = useState<MaintenanceOrder[]>([]);
  const [kind, setKind] = useState<MaintenanceKind>('correctivo');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [resolution, setResolution] = useState('');
  const [parts, setParts] = useState('');

  const openPanel = useCallback(async (e: Equipment) => {
    setTarget(e); setError(null);
    setKind('correctivo'); setDescription(''); setCost(''); setResolution(''); setParts('');
    try {
      setHistory(await fetchMaintenanceHistory(e.id));
    } catch {
      setHistory([]);
    }
  }, []);

  const openIntervention = useCallback(() => history.find(h => h.status === 'abierta') ?? null, [history]);

  const submitOpen = async () => {
    if (!target || busy) return;
    if (description.trim().length < 5) { setError('Describa la intervención (mínimo 5 caracteres).'); return; }
    setBusy(true); setError(null);
    try {
      await openMaintenance({ equipmentId: target.id, kind, description: description.trim() });
      setNotice(`${target.name} entró en mantenimiento.`);
      setTarget(null);
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la intervención');
    } finally {
      setBusy(false);
    }
  };

  const submitClose = async () => {
    const open = openIntervention();
    if (!target || !open || busy) return;
    const cents = parseAmountToCents(cost);
    if (cost.trim() !== '' && (cents === null || cents < 0)) {
      setError('El costo no es válido.'); return;
    }
    setBusy(true); setError(null);
    try {
      await completeMaintenance({
        maintenanceId: open.id, costCents: cents ?? 0,
        resolution: resolution.trim() || undefined, parts: parts.trim() || undefined
      });
      setNotice(`${target.name} volvió a operar.`);
      setTarget(null);
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar la intervención');
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!company || busy) return;
    if (!form.code.trim() || !form.name.trim()) { setError('El código y el nombre son obligatorios.'); return; }
    setBusy(true); setError(null);
    try {
      await createEquipment({
        companyId: company.id, branchId: branch?.id ?? null,
        code: form.code, name: form.name, category: form.category,
        brand: form.brand, model: form.model, serialNumber: form.serial,
        purchaseDate: form.purchaseDate || null,
        purchaseCents: parseAmountToCents(form.purchaseCost) ?? 0,
        warrantyUntil: form.warranty || null,
        serviceEveryDays: form.everyDays.trim() ? Number(form.everyDays) : null,
        nextServiceAt: form.nextService || null
      });
      setShowCreate(false); setForm(emptyForm);
      setNotice('Equipo registrado.');
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el equipo');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<Wrench className="w-5 h-5 text-indigo-400" />}
          title="Equipos" subtitle="Activos y su mantenimiento" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar los equipos" />;

  const today = new Date().toISOString().slice(0, 10);
  const open = openIntervention();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Wrench className="w-5 h-5 text-indigo-400" />}
        title="Equipos"
        subtitle="Serie, garantía, próxima revisión y costo acumulado de mantenimiento"
        actions={canManage ? (
          <button onClick={() => { setForm(emptyForm); setError(null); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nuevo equipo
          </button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar los equipos, no intervenirlos.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showCreate && !target && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <SearchBox id="eq-search" label="Buscar equipo" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por nombre, código, marca o serie…" />

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Equipos</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">EQUIPO</th>
                <th scope="col" className="p-3 font-semibold">SERIE</th>
                <th scope="col" className="p-3 font-semibold">PRÓXIMA REVISIÓN</th>
                <th scope="col" className="p-3 font-semibold text-right">MANTENIMIENTO</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {q.loading ? <SkeletonRows cols={canManage ? 6 : 5} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={canManage ? 6 : 5}>
                    {q.searchInput ? 'Ningún equipo coincide.' : 'Todavía no hay equipos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(e => {
                  const due = e.next_service_at !== null && e.next_service_at <= today;
                  return (
                    <tr key={e.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-bold text-white">{e.name}</div>
                        <div className="text-xs text-slate-500">
                          {e.code}{e.brand && ` · ${e.brand}`}{e.model && ` ${e.model}`}
                        </div>
                      </td>
                      <td className="p-3 text-slate-400">{e.serial_number ?? '—'}</td>
                      <td className="p-3 whitespace-nowrap">
                        {e.next_service_at ? (
                          <span className={due ? 'text-amber-300 font-bold' : 'text-slate-400'}>
                            {due && <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}
                            {new Date(e.next_service_at + 'T00:00:00').toLocaleDateString('es-DO')}
                          </span>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="p-3 text-right text-slate-300 tabular-nums whitespace-nowrap">
                        {formatCents(e.maintenance_cents, symbol)}
                        {e.downtime_minutes > 0 && (
                          <div className="text-xs text-slate-500">
                            {Math.round(e.downtime_minutes / 60)} h fuera
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded font-bold text-xs whitespace-nowrap ${STATUS_TONE[e.status]}`}>
                          {STATUS_LABEL[e.status]}
                        </span>
                      </td>
                      {canManage && (
                        <td className="p-3 text-right">
                          <button onClick={() => void openPanel(e)}
                            className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1">
                            <Wrench className="w-3.5 h-3.5" />
                            {e.status === 'mantenimiento' ? 'Cerrar' : 'Intervenir'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {/* Intervención: abrir o cerrar según el estado */}
      {target && (
        <FormModal
          title={open ? `Cerrar intervención — ${target.name}` : `Intervenir — ${target.name}`}
          submitLabel={open ? 'Cerrar intervención' : 'Abrir intervención'}
          busy={busy}
          error={error}
          onSubmit={() => void (open ? submitClose() : submitOpen())}
          onClose={() => setTarget(null)}
          onDismissError={() => setError(null)}
        >
          {open ? (
            <>
              <div className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-3 text-sm text-amber-200">
                <strong>{open.kind === 'preventivo' ? 'Preventivo' : 'Correctivo'}</strong> abierto el{' '}
                {new Date(open.started_at).toLocaleString('es-DO')}: {open.description}
              </div>
              <Field label={`Costo de la intervención (${symbol})`} htmlFor="mt-cost">
                <input id="mt-cost" type="text" inputMode="decimal" className={textInputClass}
                  value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Repuestos utilizados" htmlFor="mt-parts">
                <input id="mt-parts" className={textInputClass} value={parts}
                  onChange={e => setParts(e.target.value)} placeholder="Kit de empaques, manguera…" />
              </Field>
              <Field label="Resolución" htmlFor="mt-res">
                <input id="mt-res" className={textInputClass} value={resolution}
                  onChange={e => setResolution(e.target.value)} placeholder="Qué se hizo y cómo quedó" />
              </Field>
              {target.service_every_days && (
                <p className="text-sm text-slate-400">
                  Al cerrar, la próxima revisión se reprograma para dentro de{' '}
                  <strong className="text-white">{target.service_every_days} días</strong>.
                </p>
              )}
            </>
          ) : (
            <>
              <Field label="Tipo de intervención" htmlFor="mt-kind">
                <select id="mt-kind" className={textInputClass} value={kind}
                  onChange={e => setKind(e.target.value as MaintenanceKind)}>
                  <option value="correctivo">Correctivo (se dañó)</option>
                  <option value="preventivo">Preventivo (mantenimiento programado)</option>
                </select>
              </Field>
              <Field label="Descripción *" htmlFor="mt-desc"
                hint="El equipo queda fuera de operación hasta cerrar la intervención.">
                <input id="mt-desc" className={textInputClass} value={description} autoFocus
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Pierde presión: revisar empaques" />
              </Field>
            </>
          )}

          {history.length > 0 && (
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <span className="text-sm font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                <History className="w-4 h-4" /> Historial
              </span>
              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                {history.map(h => (
                  <li key={h.id} className="text-xs bg-slate-950/60 rounded-lg p-2.5 flex items-start gap-2">
                    {h.status === 'completada'
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      : <Loader2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-300">{h.description}</div>
                      <div className="text-slate-500">
                        {new Date(h.started_at).toLocaleDateString('es-DO')}
                        {h.cost_cents > 0 && ` · ${formatCents(h.cost_cents, symbol)}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FormModal>
      )}

      {showCreate && (
        <FormModal
          title="Nuevo equipo"
          submitLabel="Registrar equipo"
          busy={busy}
          error={error}
          onSubmit={() => void submitCreate()}
          onClose={() => setShowCreate(false)}
          onDismissError={() => setError(null)}
          wide
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código *" htmlFor="eq-code" hint="Único en la empresa.">
              <input id="eq-code" className={textInputClass} value={form.code} autoFocus
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="HID-01" />
            </Field>
            <Field label="Nombre *" htmlFor="eq-name">
              <input id="eq-name" className={textInputClass} value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Hidrolavadora 3000 PSI" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Categoría" htmlFor="eq-cat">
              <input id="eq-cat" className={textInputClass} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Lavado" />
            </Field>
            <Field label="Marca" htmlFor="eq-brand">
              <input id="eq-brand" className={textInputClass} value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
            </Field>
            <Field label="Modelo" htmlFor="eq-model">
              <input id="eq-model" className={textInputClass} value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Número de serie" htmlFor="eq-serial">
              <input id="eq-serial" className={textInputClass} value={form.serial}
                onChange={e => setForm(f => ({ ...f, serial: e.target.value }))} />
            </Field>
            <Field label="Fecha de compra" htmlFor="eq-pdate">
              <input id="eq-pdate" type="date" className={textInputClass} value={form.purchaseDate}
                onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
            </Field>
            <Field label={`Costo (${symbol})`} htmlFor="eq-pcost">
              <input id="eq-pcost" type="text" inputMode="decimal" className={textInputClass}
                value={form.purchaseCost}
                onChange={e => setForm(f => ({ ...f, purchaseCost: e.target.value }))} placeholder="0.00" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Garantía hasta" htmlFor="eq-warr">
              <input id="eq-warr" type="date" className={textInputClass} value={form.warranty}
                onChange={e => setForm(f => ({ ...f, warranty: e.target.value }))} />
            </Field>
            <Field label="Revisión cada (días)" htmlFor="eq-every"
              hint="Para reprogramar sola.">
              <input id="eq-every" type="number" min={1} className={textInputClass} value={form.everyDays}
                onChange={e => setForm(f => ({ ...f, everyDays: e.target.value }))} placeholder="90" />
            </Field>
            <Field label="Próxima revisión" htmlFor="eq-next">
              <input id="eq-next" type="date" className={textInputClass} value={form.nextService}
                onChange={e => setForm(f => ({ ...f, nextService: e.target.value }))} />
            </Field>
          </div>
        </FormModal>
      )}
    </div>
  );
};
