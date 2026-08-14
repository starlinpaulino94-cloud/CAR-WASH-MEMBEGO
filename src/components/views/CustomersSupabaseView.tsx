import React, { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Loader2, Car, BadgeCheck, Store, Network } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchCustomerPage, createCustomer, fetchCustomerMembego, fetchCustomerOriginSummary,
  Customer, CustomerMembego, CustomerOrigin, CustomerOriginSummary
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow, InlineAlert, FilterChips, HelpNote
} from '../common/DataViewShell';
import { MembegoCustomerModal } from '../modals/MembegoCustomerModal';
import { ExportButton } from '../common/ExportButton';
import { ImportButton } from '../common/ImportModal';
import { customersExport } from '../../lib/exportSpecs';
import { can } from '../../lib/auth';

const PAGE_SIZE = 25;

/**
 * Directorio de clientes sobre Supabase.
 *
 * La versión auditada renderizaba todo el directorio y filtraba en memoria en
 * cada pulsación. Aquí la búsqueda y la paginación las resuelve la base.
 */
export const CustomersSupabaseView: React.FC = () => {
  const { company, branch, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  // Procedencia: de dónde vino el cliente. 'todos' no es un origen, es la
  // ausencia de filtro; por eso no vive en el enum de la base.
  const [origen, setOrigen] = useState<CustomerOrigin | 'todos'>('todos');

  const fetcher = useCallback(
    (page: number, pageSize: number, search: string) =>
      fetchCustomerPage(page, pageSize, search, origen === 'todos' ? undefined : origen),
    [origen]
  );

  const q = usePagedQuery<Customer>({ fetcher, pageSize: PAGE_SIZE, deps: [origen] });

  // Resumen de los dos canales. Se pide una vez y se refresca al dar de alta.
  const [resumen, setResumen] = useState<CustomerOriginSummary | null>(null);
  const [resumenNonce, setResumenNonce] = useState(0);
  useEffect(() => {
    fetchCustomerOriginSummary()
      .then(setResumen)
      .catch(() => setResumen(null));  // el resumen es accesorio: no tumba la vista
  }, [resumenNonce]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Panel de beneficios Membego del cliente seleccionado.
  const [selected, setSelected] = useState<Customer | null>(null);
  const [membego, setMembego] = useState<CustomerMembego | null>(null);
  const [membegoLoading, setMembegoLoading] = useState(false);
  const [membegoError, setMembegoError] = useState<string | null>(null);

  const openMembego = async (customer: Customer) => {
    setSelected(customer);
    setMembego(null);
    setMembegoError(null);
    setMembegoLoading(true);
    try {
      setMembego(await fetchCustomerMembego(customer.id));
    } catch (err) {
      setMembegoError(err instanceof Error ? err.message : 'No se pudieron cargar los beneficios');
    } finally {
      setMembegoLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!company || busy) return;
    if (!name.trim()) { setFormError('El nombre es obligatorio.'); return; }
    setBusy(true); setFormError(null);
    try {
      const created = await createCustomer({
        companyId: company.id, branchId: branch?.id ?? null, name: name.trim(),
        phone: phone.trim() || null, email: email.trim() || null, taxId: taxId.trim() || null
      });
      setName(''); setPhone(''); setEmail(''); setTaxId('');
      setNotice(`Cliente ${created.name} registrado. Cuenta como cliente propio del car wash.`);
      q.reload();
      setResumenNonce(n => n + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo registrar el cliente');
    } finally {
      setBusy(false);
    }
  };

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudo cargar el directorio" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Users className="w-5 h-5 text-brand" />}
        title="Directorio de clientes"
        // Sin subtítulo a propósito: decía «separados por procedencia, los del
        // car wash y los de Membego» justo encima de las dos tarjetas que ya
        // dicen «Del car wash» y «De Membego» con sus cifras. Rotular lo que
        // se ve dos centímetros más abajo no informa, estorba.
        actions={
          <>
            <ExportButton {...customersExport()} />
            {can(profile, 'importData') && (
              <ImportButton entity="clientes" onImported={q.reload} />
            )}
          </>
        }
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

      {/* Los dos canales, uno al lado del otro. Es la comparación que importa:
          cuánta cartera es propia y cuánta la trajo Membego. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {([
          ['carwash', 'Del car wash', <Store key="s" className="w-4 h-4" />, 'text-success', 'border-success/30'],
          ['membego', 'De Membego',   <Network key="n" className="w-4 h-4" />, 'text-warning', 'border-warning/30']
        ] as const).map(([key, label, icon, tone, borde]) => {
          const d = resumen?.por_origen?.[key];
          return (
            <button key={key} onClick={() => setOrigen(origen === key ? 'todos' : key)}
              aria-pressed={origen === key}
              className={`text-left bg-surface border rounded-2xl p-4 space-y-1 transition-all ${
                origen === key ? `${borde} ring-1 ring-inset ring-brand/40` : 'border-line hover:border-line-strong'
              }`}>
              <div className={`text-xs font-bold flex items-center gap-1.5 ${tone}`}>{icon} {label}</div>
              <div className="text-2xl font-black text-strong tabular-nums">
                {d ? d.clientes : '—'}
                <span className="text-xs font-normal text-faint ml-1.5">
                  {d?.clientes === 1 ? 'cliente' : 'clientes'}
                </span>
              </div>
              <div className="text-xs text-faint">
                {d
                  ? <>{d.visitas} {d.visitas === 1 ? 'visita' : 'visitas'} · {formatCents(d.consumo_historico_cents, symbol)} de consumo</>
                  : 'Cargando…'}
              </div>
            </button>
          );
        })}
      </div>

      <HelpNote summary="Cómo se fija la procedencia">
        Es de dónde vino el cliente y no cambia nunca. Si uno propio se hace
        miembro de Membego después, sigue contando como del car wash y se le ve
        el distintivo de Membego en su columna: una cosa es quién lo trajo y
        otra qué tiene hoy.
      </HelpNote>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchBox id="cust-search" label="Buscar cliente" value={q.searchInput}
              onChange={q.setSearchInput} placeholder="Buscar por nombre, teléfono, correo o RNC…" />
            <FilterChips
              options={[
                { id: 'todos',   label: 'Todos' },
                { id: 'carwash', label: 'Del car wash' },
                { id: 'membego', label: 'De Membego' }
              ]}
              value={origen}
              onChange={setOrigen}
            />
          </div>

          <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Clientes registrados</caption>
                <thead>
                  <tr className="border-b border-line text-muted bg-canvas/50">
                    <th scope="col" className="p-3 font-semibold">NOMBRE</th>
                    <th scope="col" className="p-3 font-semibold">CONTACTO</th>
                    <th scope="col" className="p-3 font-semibold">PROCEDENCIA</th>
                    <th scope="col" className="p-3 font-semibold">MEMBEGO</th>
                    <th scope="col" className="p-3 font-semibold text-right">VISITAS</th>
                    <th scope="col" className="p-3 font-semibold text-right">CONSUMO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {q.loading ? <SkeletonRows cols={6} />
                    : q.rows.length === 0 ? (
                      <EmptyRow cols={6}>
                        {q.searchInput
                          ? 'Ningún cliente coincide con la búsqueda.'
                          : origen === 'carwash' ? 'Todavía no hay clientes propios del car wash.'
                          : origen === 'membego' ? 'Todavía no ha llegado ningún cliente por Membego.'
                          : 'Todavía no hay clientes registrados.'}
                      </EmptyRow>
                    ) : q.rows.map(c => (
                      <tr key={c.id} className="hover:bg-surface-2/40">
                        <td className="p-3">
                          <div className="font-bold text-strong">{c.name}</div>
                          {c.tax_id && <div className="text-xs text-faint">RNC {c.tax_id}</div>}
                        </td>
                        <td className="p-3 text-muted">
                          <div>{c.phone || '—'}</div>
                          {c.email && <div className="text-xs truncate max-w-[180px]">{c.email}</div>}
                        </td>
                        <td className="p-3">
                          {c.origin === 'membego'
                            ? <span className="inline-flex items-center gap-1 text-xs bg-warning/15 text-warning px-2 py-0.5 rounded font-bold">
                                <Network className="w-3 h-3" /> Membego
                              </span>
                            : <span className="inline-flex items-center gap-1 text-xs bg-success/15 text-success px-2 py-0.5 rounded font-bold">
                                <Store className="w-3 h-3" /> Car wash
                              </span>}
                        </td>
                        <td className="p-3">
                          {c.membego_customer_id ? (
                            <button onClick={() => void openMembego(c)}
                              className="inline-flex items-center gap-1 text-xs bg-warning/20 text-warning hover:bg-warning/30 px-2 py-0.5 rounded font-bold">
                              <BadgeCheck className="w-3 h-3" />
                              {c.membego_tier || 'Membego'}
                            </button>
                          ) : <span className="text-faint">Local</span>}
                        </td>
                        <td className="p-3 text-body font-bold text-right tabular-nums">{c.total_visits}</td>
                        <td className="p-3 text-brand-hi font-bold text-right whitespace-nowrap">
                          {formatCents(c.total_spent_cents, symbol)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
              pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
          </div>
        </div>

        <div className="bg-surface border border-line rounded-2xl p-5 space-y-4 h-fit">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
            <Plus className="w-4 h-4 text-brand" /> Nuevo cliente
          </h3>
          <div className="space-y-3 text-xs">
            {[
              { id: 'c-name', label: 'Nombre *', value: name, set: setName, type: 'text' },
              { id: 'c-phone', label: 'Teléfono', value: phone, set: setPhone, type: 'tel' },
              { id: 'c-email', label: 'Correo', value: email, set: setEmail, type: 'email' },
              { id: 'c-tax', label: 'RNC / Cédula', value: taxId, set: setTaxId, type: 'text' }
            ].map(f => (
              <div key={f.id}>
                <label htmlFor={f.id} className="text-muted">{f.label}</label>
                <input id={f.id} type={f.type} value={f.value} disabled={busy}
                  onChange={e => f.set(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-lg p-2 text-strong mt-1 focus:outline-none focus:border-brand disabled:opacity-50" />
              </div>
            ))}

            {formError && <InlineAlert tone="error">{formError}</InlineAlert>}

            <button onClick={() => void handleAdd()} disabled={busy}
              className="w-full py-2.5 bg-brand hover:bg-brand disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold rounded-xl text-xs shadow-lg shadow-brand/30 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Guardar cliente
            </button>

            <p className="text-xs text-faint flex items-start gap-1.5">
              <Car className="w-3 h-3 flex-shrink-0 mt-0.5" />
              Los vehículos se vinculan solos al registrar la llegada con la placa.
            </p>
          </div>
        </div>
      </div>

      {selected && (
        <MembegoCustomerModal
          customerName={selected.name}
          tier={selected.membego_tier}
          data={membego}
          loading={membegoLoading}
          error={membegoError}
          symbol={symbol}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};
