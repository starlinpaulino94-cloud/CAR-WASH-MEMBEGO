import React, { useEffect, useState } from 'react';
import { Building2, Plus, Car, Tags, FileText, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents, centsToInput } from '../../lib/money';
import { RANGES, RangeId, rangeDates } from '../../lib/reportRanges';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchCustomerPage, fetchServicesWithPrices, ServiceWithPrices } from '../../data/adminRepository';
import {
  fetchFleetPage, fetchFleetVehicles, fetchFleetRates, searchFreeVehicles,
  upsertFleet, assignVehicleToFleet, setFleetRate, deleteFleetRate,
  fetchFleetStatement, invoiceFleetPeriod,
  FleetRow, FleetRate, Vehicle, FleetStatement, VehicleCategory
} from '../../data/fleetRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice, FilterChips, StatCard
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const PAGE_SIZE = 25;

type Filter = 'active' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'active', label: 'Activas' },
  { id: 'all', label: 'Todas' }
];

const CATEGORIES: { id: VehicleCategory | ''; label: string }[] = [
  { id: '', label: 'Todo el parque' },
  { id: 'sedan', label: 'Sedán' },
  { id: 'suv', label: 'SUV' },
  { id: 'jeep', label: 'Jeep' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'van', label: 'Van' },
  { id: 'truck', label: 'Camión' },
  { id: 'motorcycle', label: 'Motocicleta' },
  { id: 'special', label: 'Especial' }
];

const emptyFleet = {
  customerId: '', name: '', code: '', contactName: '',
  contactPhone: '', contactEmail: '', poReference: '', notes: ''
};

/**
 * Flotillas y contratos corporativos.
 *
 * Una empresa que trae quince camionetas no es quince clientes sueltos. Aquí se
 * agrupan sus vehículos, se pacta la tarifa —que gana al catálogo sin que la
 * recepción tenga que acordarse de nada— y se factura el periodo completo de
 * una vez, a crédito, contra el cliente que paga.
 */
export const FleetsSupabaseView: React.FC = () => {
  const { profile, phase, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canManage = ['propietario', 'administrador', 'contador', 'superadmin']
    .includes(profile?.role ?? '');
  const canAssign = ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const [filter, setFilter] = useState<Filter>('active');
  const q = usePagedQuery<FleetRow>({
    fetcher: (page, size, search) => fetchFleetPage(page, size, search, filter === 'active'),
    pageSize: PAGE_SIZE,
    deps: [filter],
    enabled: phase === 'ready'
  });

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- Alta y edición de la flotilla
  const [fleetModal, setFleetModal] = useState<'create' | FleetRow | null>(null);
  const [form, setForm] = useState(emptyFleet);
  const [customerTerm, setCustomerTerm] = useState('');
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!fleetModal || phase !== 'ready') return;
    const id = window.setTimeout(() => {
      fetchCustomerPage(0, 15, customerTerm)
        .then(r => setCustomers(r.rows.map(c => ({ id: c.id, name: c.name }))))
        .catch(() => setCustomers([]));
    }, 350);
    return () => window.clearTimeout(id);
  }, [fleetModal, customerTerm, phase]);

  const openCreate = () => {
    setForm(emptyFleet); setCustomerTerm(''); setError(null); setFleetModal('create');
  };
  const openEdit = (f: FleetRow) => {
    setForm({
      customerId: f.customer_id, name: f.name, code: f.code ?? '',
      contactName: f.contact_name ?? '', contactPhone: f.contact_phone ?? '',
      contactEmail: f.contact_email ?? '', poReference: f.po_reference ?? '',
      notes: f.notes ?? ''
    });
    setCustomerTerm(f.customer_name); setError(null); setFleetModal(f);
  };

  const submitFleet = async () => {
    if (busy) return;
    if (!form.customerId) { setError('Elija el cliente que paga la flotilla.'); return; }
    if (!form.name.trim()) { setError('La flotilla necesita un nombre.'); return; }
    setBusy(true); setError(null);
    try {
      await upsertFleet({
        customerId: form.customerId,
        name: form.name,
        fleetId: fleetModal === 'create' ? null : fleetModal?.id,
        code: form.code.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        poReference: form.poReference.trim() || null,
        notes: form.notes.trim() || null,
        isActive: fleetModal === 'create' ? true : fleetModal?.is_active
      });
      setFleetModal(null);
      setNotice(`Flotilla ${form.name} guardada.`);
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la flotilla');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (f: FleetRow) => {
    try {
      await upsertFleet({
        customerId: f.customer_id, name: f.name, fleetId: f.id,
        code: f.code, contactName: f.contact_name, contactPhone: f.contact_phone,
        contactEmail: f.contact_email, poReference: f.po_reference, notes: f.notes,
        isActive: !f.is_active
      });
      setNotice(f.is_active
        ? `${f.name} quedó inactiva: sus vehículos vuelven a tarifa de mostrador.`
        : `${f.name} quedó activa.`);
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    }
  };

  // --- Panel de detalle: vehículos, tarifas y estado de cuenta
  const [detail, setDetail] = useState<FleetRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rates, setRates] = useState<FleetRate[]>([]);
  const [services, setServices] = useState<ServiceWithPrices[]>([]);
  const [statement, setStatement] = useState<FleetStatement | null>(null);
  const [range, setRange] = useState<RangeId>('month');
  const [detailNonce, setDetailNonce] = useState(0);

  useEffect(() => {
    if (!detail) return;
    const { from, to } = rangeDates(range);
    fetchFleetVehicles(detail.id).then(setVehicles).catch(() => setVehicles([]));
    fetchFleetRates(detail.id).then(setRates).catch(() => setRates([]));
    fetchServicesWithPrices().then(setServices).catch(() => setServices([]));
    fetchFleetStatement(detail.id, from, to).then(setStatement).catch(() => setStatement(null));
  }, [detail, range, detailNonce]);

  const refreshDetail = () => { setDetailNonce(n => n + 1); q.reload(); };

  // --- Añadir vehículo
  const [plateTerm, setPlateTerm] = useState('');
  const [freeVehicles, setFreeVehicles] = useState<Vehicle[]>([]);
  const [showAddVehicle, setShowAddVehicle] = useState(false);

  useEffect(() => {
    if (!showAddVehicle) return;
    const id = window.setTimeout(() => {
      searchFreeVehicles(plateTerm).then(setFreeVehicles).catch(() => setFreeVehicles([]));
    }, 350);
    return () => window.clearTimeout(id);
  }, [showAddVehicle, plateTerm]);

  const addVehicle = async (v: Vehicle) => {
    if (!detail) return;
    try {
      await assignVehicleToFleet(v.id, detail.id);
      setShowAddVehicle(false); setPlateTerm('');
      setNotice(`${v.plate} entró a ${detail.name}.`);
      refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar el vehículo');
    }
  };

  const removeVehicle = async (v: Vehicle) => {
    try {
      await assignVehicleToFleet(v.id, null);
      setNotice(`${v.plate} salió de la flotilla.`);
      refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sacar el vehículo');
    }
  };

  // --- Tarifa pactada
  const [showRate, setShowRate] = useState(false);
  const [rateService, setRateService] = useState('');
  const [rateCategory, setRateCategory] = useState<VehicleCategory | ''>('');
  const [ratePrice, setRatePrice] = useState('');

  const openRate = (r?: FleetRate) => {
    setRateService(r?.service_id ?? services[0]?.id ?? '');
    setRateCategory(r?.vehicle_category ?? '');
    setRatePrice(r ? centsToInput(r.price_cents) : '');
    setError(null); setShowRate(true);
  };

  const submitRate = async () => {
    if (!detail || busy) return;
    const cents = parseAmountToCents(ratePrice);
    if (!rateService) { setError('Elija el servicio.'); return; }
    if (cents === null || cents < 0) { setError('Indique una tarifa válida.'); return; }
    setBusy(true); setError(null);
    try {
      await setFleetRate({
        fleetId: detail.id, serviceId: rateService, priceCents: cents,
        vehicleCategory: rateCategory || null
      });
      setShowRate(false);
      setNotice('Tarifa pactada. A partir de ahora manda sobre el catálogo.');
      refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la tarifa');
    } finally {
      setBusy(false);
    }
  };

  const removeRate = async (r: FleetRate) => {
    try {
      await deleteFleetRate(r.id);
      setNotice('Tarifa retirada: ese servicio vuelve al catálogo.');
      refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo retirar la tarifa');
    }
  };

  // --- Facturación consolidada
  const consolidate = async () => {
    if (!detail || !statement || busy) return;
    const { from, to } = rangeDates(range);
    setBusy(true); setError(null);
    try {
      const invoice = await invoiceFleetPeriod({
        fleetId: detail.id, from, to,
        // La clave de idempotencia lleva flota y periodo: un segundo clic
        // devuelve la misma factura en vez de emitir otra.
        clientRequestId: `fleet-${detail.id}-${from}-${to}`
      });
      setNotice(`Factura ${invoice.invoice_number} emitida a crédito por ${formatCents(invoice.total_cents, symbol)}.`);
      refreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo consolidar el periodo');
    } finally {
      setBusy(false);
    }
  };

  const serviceName = (id: string) => services.find(s => s.id === id)?.name ?? '—';

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader icon={<Building2 className="w-5 h-5 text-indigo-400" />}
          title="Flotillas" subtitle="Cuentas corporativas y tarifas de contrato" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) {
    return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar las flotillas" />;
  }

  const cols = canManage ? 5 : 4;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Building2 className="w-5 h-5 text-indigo-400" />}
        title="Flotillas"
        subtitle="Una empresa con varios vehículos no es varios clientes sueltos"
        actions={canManage ? (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nueva flotilla
          </button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar las flotillas, no administrarlas.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !fleetModal && !showRate && (
        <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <SearchBox id="fleet-search" label="Buscar flotilla" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por nombre o código…" />

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Flotillas</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">FLOTILLA</th>
                <th scope="col" className="p-3 font-semibold">FACTURA A</th>
                <th scope="col" className="p-3 font-semibold text-right">VEHÍCULOS</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {q.loading ? <SkeletonRows cols={cols} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={cols}>
                    {q.searchInput ? 'Ninguna flotilla coincide.' : 'Todavía no hay flotillas registradas.'}
                  </EmptyRow>
                ) : q.rows.map(f => (
                  <tr key={f.id} className="hover:bg-slate-800/40">
                    <td className="p-3">
                      <button onClick={() => setDetail(f)}
                        className="font-bold text-white hover:text-indigo-300 text-left">
                        {f.name}
                      </button>
                      {f.code && <div className="text-xs text-slate-500">{f.code}</div>}
                    </td>
                    <td className="p-3 text-slate-400">
                      <div>{f.customer_name}</div>
                      {f.po_reference && <div className="text-xs text-slate-500">OC {f.po_reference}</div>}
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">{f.vehicle_count}</td>
                    <td className="p-3">
                      {f.is_active
                        ? <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-xs">Activa</span>
                        : <span className="bg-slate-700/50 text-slate-400 font-bold px-2 py-0.5 rounded text-xs">Inactiva</span>}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(f)}
                          className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                          Editar
                        </button>
                        <button onClick={() => void toggleActive(f)}
                          className="ml-1 px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                          {f.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {/* ------------------------------------------------------- Detalle */}
      {detail && (
        <section aria-label={`Detalle de ${detail.name}`}
          className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">{detail.name}</h2>
              <p className="text-xs text-slate-500">
                Factura a {detail.customer_name}
                {detail.po_reference && ` · orden de compra ${detail.po_reference}`}
              </p>
            </div>
            <button onClick={() => setDetail(null)} aria-label="Cerrar detalle"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          </header>

          <FilterChips options={RANGES} value={range} onChange={setRange} />

          {statement && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Servicios del periodo" value={String(statement.totals.services)} />
              <StatCard label="Consumo" value={formatCents(statement.totals.total_cents, symbol)} />
              <StatCard label="Sin facturar" value={formatCents(statement.totals.unbilled_cents, symbol)}
                tone={statement.totals.unbilled_cents > 0 ? 'text-amber-400' : undefined}
                hint="Entregado y aún no cobrado" />
              <StatCard label="Saldo por cobrar" value={formatCents(statement.balance_cents, symbol)}
                tone={statement.balance_cents > 0 ? 'text-orange-400' : undefined}
                hint="Lo que debe hoy" />
            </div>
          )}

          {canManage && statement && statement.totals.unbilled_cents > 0 && (
            <button onClick={() => void consolidate()} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl disabled:opacity-50">
              <FileText className="w-4 h-4" />
              Facturar el periodo — {formatCents(statement.totals.unbilled_cents, symbol)} a crédito
            </button>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            {/* Vehículos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <Car className="w-4 h-4 text-indigo-400" /> Vehículos ({vehicles.length})
                </h3>
                {canAssign && (
                  <button onClick={() => { setShowAddVehicle(true); setPlateTerm(''); }}
                    className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                    Añadir
                  </button>
                )}
              </div>
              {vehicles.length === 0 ? (
                <p className="text-xs text-slate-400">Sin vehículos: la flotilla no cobra tarifa pactada todavía.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {vehicles.map(v => (
                    <li key={v.id} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-white text-sm">{v.plate}</div>
                        <div className="text-xs text-slate-500">
                          {[v.make, v.model].filter(Boolean).join(' ') || 'sin datos'} · {v.category}
                        </div>
                      </div>
                      {canAssign && (
                        <button onClick={() => void removeVehicle(v)}
                          className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400">
                          Sacar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Tarifas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <Tags className="w-4 h-4 text-indigo-400" /> Tarifas pactadas ({rates.length})
                </h3>
                {canManage && (
                  <button onClick={() => openRate()}
                    className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                    Pactar
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Una tarifa por categoría gana sobre la de todo el parque. Los servicios
                sin tarifa siguen cobrándose del catálogo.
              </p>
              {rates.length === 0 ? (
                <p className="text-xs text-slate-400">Sin tarifas: se cobra el precio de mostrador.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {rates.map(r => (
                    <li key={r.id} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-white text-sm">{serviceName(r.service_id)}</div>
                        <div className="text-xs text-slate-500">
                          {r.vehicle_category ?? 'todo el parque'} · {formatCents(r.price_cents, symbol)}
                        </div>
                      </div>
                      {canManage && (
                        <div className="whitespace-nowrap">
                          <button onClick={() => openRate(r)}
                            className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                            Cambiar
                          </button>
                          <button onClick={() => void removeRate(r)}
                            className="ml-1 px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400">
                            Retirar
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {statement && statement.by_vehicle.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Consumo por vehículo</caption>
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th scope="col" className="p-2 font-semibold">PLACA</th>
                    <th scope="col" className="p-2 font-semibold text-right">SERVICIOS</th>
                    <th scope="col" className="p-2 font-semibold text-right">CONSUMO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {statement.by_vehicle.map(v => (
                    <tr key={v.plate}>
                      <td className="p-2 font-bold text-white">{v.plate}</td>
                      <td className="p-2 text-right text-slate-300 tabular-nums">{v.services}</td>
                      <td className="p-2 text-right text-slate-300 tabular-nums">
                        {formatCents(v.total_cents, symbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* --------------------------------------------------------- Modales */}
      {fleetModal && (
        <FormModal
          title={fleetModal === 'create' ? 'Nueva flotilla' : `Editar — ${fleetModal.name}`}
          submitLabel={fleetModal === 'create' ? 'Crear flotilla' : 'Guardar cambios'}
          busy={busy}
          error={error}
          onSubmit={() => void submitFleet()}
          onClose={() => setFleetModal(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Nombre *" htmlFor="fleet-name">
            <input id="fleet-name" className={textInputClass} value={form.name} autoFocus
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Distribuidora del Este" />
          </Field>

          <Field label="Cliente que paga *" htmlFor="fleet-customer">
            <input id="fleet-customer" className={textInputClass} value={customerTerm}
              onChange={e => { setCustomerTerm(e.target.value); setForm(f => ({ ...f, customerId: '' })); }}
              placeholder="Buscar cliente…" />
          </Field>
          {!form.customerId && customers.length > 0 && (
            <ul className="max-h-40 overflow-y-auto divide-y divide-slate-800/60 -mt-2">
              {customers.map(c => (
                <li key={c.id}>
                  <button type="button"
                    onClick={() => { setForm(f => ({ ...f, customerId: c.id })); setCustomerTerm(c.name); }}
                    className="w-full text-left py-2 px-2 hover:bg-slate-800/60 rounded-lg text-sm text-white">
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500 -mt-2">
            Es quien recibe la factura consolidada. Necesita crédito autorizado en
            Clientes › Por cobrar.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Código" htmlFor="fleet-code">
              <input id="fleet-code" className={textInputClass} value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
            </Field>
            <Field label="Orden de compra" htmlFor="fleet-po">
              <input id="fleet-po" className={textInputClass} value={form.poReference}
                onChange={e => setForm(f => ({ ...f, poReference: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contacto" htmlFor="fleet-contact">
              <input id="fleet-contact" className={textInputClass} value={form.contactName}
                onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
            </Field>
            <Field label="Teléfono" htmlFor="fleet-phone">
              <input id="fleet-phone" className={textInputClass} value={form.contactPhone}
                onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notas" htmlFor="fleet-notes">
            <input id="fleet-notes" className={textInputClass} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Condiciones, día de corte…" />
          </Field>
        </FormModal>
      )}

      {showAddVehicle && detail && (
        <FormModal
          title={`Añadir vehículo a ${detail.name}`}
          submitLabel="Cerrar"
          busy={false}
          error={null}
          onSubmit={() => setShowAddVehicle(false)}
          onClose={() => setShowAddVehicle(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Buscar placa" htmlFor="fleet-plate">
            <input id="fleet-plate" className={textInputClass} value={plateTerm} autoFocus
              onChange={e => setPlateTerm(e.target.value)} placeholder="ABC123" />
          </Field>
          <p className="text-xs text-slate-500">
            Solo aparecen vehículos que no pertenecen ya a otra flotilla.
          </p>
          {freeVehicles.length === 0 ? (
            <p className="text-xs text-slate-400">Ningún vehículo libre coincide.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-slate-800/60">
              {freeVehicles.map(v => (
                <li key={v.id}>
                  <button type="button" onClick={() => void addVehicle(v)}
                    className="w-full text-left py-2.5 px-2 hover:bg-slate-800/60 rounded-lg">
                    <div className="font-bold text-white text-sm">{v.plate}</div>
                    <div className="text-xs text-slate-500">
                      {[v.make, v.model].filter(Boolean).join(' ') || 'sin datos'} · {v.category}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormModal>
      )}

      {showRate && detail && (
        <FormModal
          title={`Tarifa pactada — ${detail.name}`}
          submitLabel="Guardar tarifa"
          busy={busy}
          error={error}
          onSubmit={() => void submitRate()}
          onClose={() => setShowRate(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Servicio" htmlFor="rate-service">
            <select id="rate-service" className={textInputClass} value={rateService}
              onChange={e => setRateService(e.target.value)}>
              <option value="">Elija el servicio…</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Aplica a" htmlFor="rate-category">
            <select id="rate-category" className={textInputClass} value={rateCategory}
              onChange={e => setRateCategory(e.target.value as VehicleCategory | '')}>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Precio pactado" htmlFor="rate-price">
            <input id="rate-price" className={textInputClass} value={ratePrice}
              inputMode="decimal" onChange={e => setRatePrice(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">
            Este precio sustituye al del catálogo para los vehículos de la flotilla.
            Las órdenes ya emitidas conservan el importe con el que se cerraron.
          </p>
        </FormModal>
      )}
    </div>
  );
};
