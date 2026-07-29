import React, { useState } from 'react';
import { Users, Plus, Loader2, Car } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { fetchCustomerPage, createCustomer, Customer } from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow, InlineAlert
} from '../common/DataViewShell';

const PAGE_SIZE = 25;

/**
 * Directorio de clientes sobre Supabase.
 *
 * La versión auditada renderizaba todo el directorio y filtraba en memoria en
 * cada pulsación. Aquí la búsqueda y la paginación las resuelve la base.
 */
export const CustomersSupabaseView: React.FC = () => {
  const { company, branch } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const q = usePagedQuery<Customer>({ fetcher: fetchCustomerPage, pageSize: PAGE_SIZE });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice(`Cliente ${created.name} registrado.`);
      q.reload();
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
        icon={<Users className="w-5 h-5 text-indigo-400" />}
        title="Directorio de clientes"
        subtitle="Historial de visitas, consumo y vinculación con Membego"
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <SearchBox id="cust-search" label="Buscar cliente" value={q.searchInput}
            onChange={q.setSearchInput} placeholder="Buscar por nombre, teléfono, correo o RNC…" />

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Clientes registrados</caption>
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                    <th scope="col" className="p-3 font-semibold">NOMBRE</th>
                    <th scope="col" className="p-3 font-semibold">CONTACTO</th>
                    <th scope="col" className="p-3 font-semibold">MEMBEGO</th>
                    <th scope="col" className="p-3 font-semibold text-right">VISITAS</th>
                    <th scope="col" className="p-3 font-semibold text-right">CONSUMO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {q.loading ? <SkeletonRows cols={5} />
                    : q.rows.length === 0 ? (
                      <EmptyRow cols={5}>
                        {q.searchInput ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes registrados.'}
                      </EmptyRow>
                    ) : q.rows.map(c => (
                      <tr key={c.id} className="hover:bg-slate-800/40">
                        <td className="p-3">
                          <div className="font-bold text-white">{c.name}</div>
                          {c.tax_id && <div className="text-[10px] text-slate-500">RNC {c.tax_id}</div>}
                        </td>
                        <td className="p-3 text-slate-400">
                          <div>{c.phone || '—'}</div>
                          {c.email && <div className="text-[10px] truncate max-w-[180px]">{c.email}</div>}
                        </td>
                        <td className="p-3">
                          {c.membego_tier ? (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold">
                              {c.membego_tier}
                            </span>
                          ) : <span className="text-slate-600">Local</span>}
                        </td>
                        <td className="p-3 text-slate-300 font-bold text-right tabular-nums">{c.total_visits}</td>
                        <td className="p-3 text-indigo-300 font-bold text-right whitespace-nowrap">
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

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 h-fit">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-400" /> Nuevo cliente
          </h3>
          <div className="space-y-3 text-xs">
            {[
              { id: 'c-name', label: 'Nombre *', value: name, set: setName, type: 'text' },
              { id: 'c-phone', label: 'Teléfono', value: phone, set: setPhone, type: 'tel' },
              { id: 'c-email', label: 'Correo', value: email, set: setEmail, type: 'email' },
              { id: 'c-tax', label: 'RNC / Cédula', value: taxId, set: setTaxId, type: 'text' }
            ].map(f => (
              <div key={f.id}>
                <label htmlFor={f.id} className="text-slate-400">{f.label}</label>
                <input id={f.id} type={f.type} value={f.value} disabled={busy}
                  onChange={e => f.set(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white mt-1 focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
              </div>
            ))}

            {formError && <InlineAlert tone="error">{formError}</InlineAlert>}

            <button onClick={() => void handleAdd()} disabled={busy}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Guardar cliente
            </button>

            <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
              <Car className="w-3 h-3 flex-shrink-0 mt-0.5" />
              Los vehículos se vinculan solos al registrar la llegada con la placa.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
