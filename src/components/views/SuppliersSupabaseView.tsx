import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Plus, Pencil, Eye, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchSupplierPage, createSupplier, updateSupplier, Supplier
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';
import { ExportButton } from '../common/ExportButton';
import { ImportButton } from '../common/ImportModal';
import { suppliersExport } from '../../lib/exportSpecs';
import { can } from '../../lib/auth';
import { formatCents } from '../../lib/money';
import { PanelDetalle } from '../common/PanelDetalle';
import { TablaDatos } from '../common/TablaDatos';
import { ReporteImprimible, BotonImprimir } from '../common/ReporteImprimible';
import { fetchFichaProveedor, FichaProveedor } from '../../data/reportsRepository';

const PAGE_SIZE = 25;

const emptyForm = { name: '', taxId: '', phone: '', email: '', notes: '' };

/**
 * Directorio de proveedores.
 *
 * Es la contraparte de las compras: a quién se le compra y cómo contactarlo.
 * Lo administran los roles de compras (supervisor o superior y contador);
 * nadie se borra: se desactiva, para no perder el historial de compras.
 */
export const SuppliersSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const canManage = ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const q = usePagedQuery<Supplier>({
    fetcher: fetchSupplierPage,
    pageSize: PAGE_SIZE,
    enabled: phase === 'ready'
  });

  const [modal, setModal] = useState<'create' | Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbol = company?.currency_symbol ?? 'RD$';

  // Ficha 360 del proveedor, en panel lateral.
  const [fichaSup, setFichaSup] = useState<Supplier | null>(null);
  const [ficha, setFicha] = useState<FichaProveedor | null>(null);
  const [fichaCargando, setFichaCargando] = useState(false);
  const verFicha = (sup: Supplier) => {
    setFichaSup(sup); setFicha(null); setFichaCargando(true);
    fetchFichaProveedor(sup.id)
      .then(setFicha).catch(() => setFicha(null)).finally(() => setFichaCargando(false));
  };
  const [notice, setNotice] = useState<string | null>(null);

  const openCreate = () => { setForm(emptyForm); setError(null); setModal('create'); };
  const openEdit = (s: Supplier) => {
    setForm({ name: s.name, taxId: s.tax_id ?? '', phone: s.phone ?? '', email: s.email ?? '', notes: s.notes ?? '' });
    setError(null); setModal(s);
  };

  const submit = async () => {
    if (!company || busy) return;
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true); setError(null);
    try {
      if (modal === 'create') {
        await createSupplier({
          companyId: company.id, name: form.name, taxId: form.taxId,
          phone: form.phone, email: form.email, notes: form.notes
        });
      } else if (modal) {
        await updateSupplier(modal.id, {
          name: form.name.trim(), tax_id: form.taxId.trim() || null,
          phone: form.phone.trim() || null, email: form.email.trim() || null,
          notes: form.notes.trim() || null
        });
      }
      setModal(null);
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el proveedor');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: Supplier) => {
    try {
      await updateSupplier(s.id, { is_active: !s.is_active });
      setNotice(s.is_active ? `${s.name} quedó inactivo.` : `${s.name} quedó activo.`);
      q.reload();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Proveedores" subtitle="Directorio de suplidores" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar los proveedores" />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        title="Proveedores"
        subtitle="A quién se compra: contacto, RNC e historial"
        actions={
          <>
            <ExportButton {...suppliersExport()} />
            {can(profile, 'importData') && (
              <ImportButton entity="proveedores" onImported={q.reload} />
            )}
            {canManage && (
          <Button size="sm" onClick={openCreate}
            >
            <Plus className="w-4 h-4" /> Nuevo proveedor
          </Button>
            )}
          </>
        }
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar el directorio, no administrarlo.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !modal && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <SearchBox id="sup-search" label="Buscar proveedor" value={q.searchInput}
        onChange={q.setSearchInput} placeholder="Buscar por nombre, teléfono o RNC…" />

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <caption className="sr-only">Proveedores</caption>
            <TableHeader>
              <TableRow className="border-b border-line text-muted bg-canvas/50">
                <TableHead scope="col" className="p-3 font-semibold">PROVEEDOR</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">RNC</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">CONTACTO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">ESTADO</TableHead>
                {canManage && <TableHead scope="col" className="p-3 font-semibold text-right">ACCIONES</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.loading ? <SkeletonRows cols={canManage ? 5 : 4} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={canManage ? 5 : 4}>
                    {q.searchInput ? 'Ningún proveedor coincide.' : 'Todavía no hay proveedores registrados.'}
                  </EmptyRow>
                ) : q.rows.map(s => (
                  <TableRow key={s.id} className="hover:bg-surface-2/40">
                    <TableCell className="p-3">
                      <button onClick={() => verFicha(s)} className="text-left hover:underline" title="Ver ficha del proveedor">
                        <div className="font-bold text-strong">{s.name}</div>
                        {s.notes && <div className="text-xs text-faint">{s.notes}</div>}
                      </button>
                    </TableCell>
                    <TableCell className="p-3 text-muted">{s.tax_id ?? '—'}</TableCell>
                    <TableCell className="p-3 text-muted">
                      <div>{s.phone ?? '—'}</div>
                      {s.email && <div className="text-xs text-faint">{s.email}</div>}
                    </TableCell>
                    <TableCell className="p-3">
                      {s.is_active
                        ? <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">Activo</span>
                        : <span className="bg-surface-3/50 text-muted font-bold px-2 py-0.5 rounded text-xs">Inactivo</span>}
                    </TableCell>
                    {canManage && (
                      <TableCell className="p-3 text-right whitespace-nowrap">
                        <Button variant="outline" size="xs" onClick={() => verFicha(s)}>
                          <Eye className="w-3.5 h-3.5" /> Ver
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="ml-1" onClick={() => openEdit(s)} aria-label={`Editar ${s.name}`}
                          >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="secondary" size="xs" className="ml-1" onClick={() => void toggleActive(s)}
                          >
                          {s.is_active ? 'Desactivar' : 'Activar'}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {modal && (
        <FormModal
          title={modal === 'create' ? 'Nuevo proveedor' : `Editar — ${modal.name}`}
          submitLabel={modal === 'create' ? 'Crear proveedor' : 'Guardar cambios'}
          busy={busy}
          error={error}
          onSubmit={() => void submit()}
          onClose={() => setModal(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Nombre *" htmlFor="sup-name">
            <input id="sup-name" className={textInputClass} value={form.name} autoFocus
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Química del Caribe SRL" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RNC" htmlFor="sup-rnc">
              <input id="sup-rnc" className={textInputClass} value={form.taxId}
                onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} />
            </Field>
            <Field label="Teléfono" htmlFor="sup-phone">
              <input id="sup-phone" className={textInputClass} value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </Field>
          </div>
          <Field label="Correo" htmlFor="sup-email">
            <input id="sup-email" type="email" className={textInputClass} value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Notas" htmlFor="sup-notes">
            <input id="sup-notes" className={textInputClass} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Condiciones, días de entrega…" />
          </Field>
        </FormModal>
      )}

      <PanelDetalle
        abierto={!!fichaSup}
        titulo={fichaSup?.name ?? ''}
        subtitulo={fichaSup?.tax_id ? `RNC ${fichaSup.tax_id}` : (fichaSup?.phone ?? undefined)}
        onCerrar={() => { setFichaSup(null); setFicha(null); }}
        acciones={ficha ? <BotonImprimir /> : undefined}
      >
        {fichaCargando ? (
          <p className="text-xs text-faint flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Cargando…</p>
        ) : ficha ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Total comprado', formatCents(ficha.total_comprado_cents, symbol), 'text-strong'],
                ['Saldo pendiente', formatCents(ficha.saldo_cents, symbol), ficha.saldo_cents > 0 ? 'text-warning' : 'text-strong'],
                ['Vencido', formatCents(ficha.vencido_cents, symbol), ficha.vencido_cents > 0 ? 'text-danger' : 'text-strong'],
                ['Compras', String(ficha.compras_total), 'text-strong'],
                ['Última compra', ficha.ultima_compra ? new Date(ficha.ultima_compra).toLocaleDateString('es-DO') : '—', 'text-strong']
              ].map(([l, v, c]) => (
                <div key={l} className="bg-canvas border border-line rounded-xl p-3">
                  <div className="text-xs text-muted">{l}</div>
                  <div className={`text-sm font-bold tabular-nums ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            {ficha.productos_top.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-strong">Lo que más le compra</h3>
                <TablaDatos
                  columnas={[
                    { id: 'n', label: 'Producto', render: (t: FichaProveedor['productos_top'][number]) => t.name },
                    { id: 'q', label: 'Cant.', numerica: true, render: t => t.qty },
                    { id: 'tot', label: 'Total', numerica: true, render: t => formatCents(t.total_cents, symbol) }
                  ]}
                  filas={ficha.productos_top} clave={t => t.name}
                  vacio="Sin compras con detalle de productos." etiqueta="Productos más comprados" />
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-bold text-strong">Historial de compras</h3>
              <TablaDatos
                columnas={[
                  { id: 'f', label: 'Fecha', render: (c: FichaProveedor['compras'][number]) => new Date(c.purchase_date).toLocaleDateString('es-DO') },
                  { id: 'ref', label: 'Ref.', ocultarEnMovil: true, render: c => c.invoice_ref ?? '—' },
                  { id: 'tot', label: 'Total', numerica: true, render: c => formatCents(c.total_cents, symbol) },
                  { id: 'saldo', label: 'Saldo', numerica: true, render: c => {
                    const s2 = c.total_cents - c.paid_cents;
                    return s2 > 0 ? <span className={c.vencida ? 'text-danger font-bold' : 'text-warning'}>{formatCents(s2, symbol)}</span> : <span className="text-success">Pagada</span>;
                  } },
                  { id: 'venc', label: 'Vence', ocultarEnMovil: true, render: c => c.due_date ? new Date(c.due_date).toLocaleDateString('es-DO') : '—' }
                ]}
                filas={ficha.compras} clave={c => c.id}
                vacio="Sin compras registradas." etiqueta="Historial de compras" />
            </div>

            {/* El estado de cuenta imprimible: mismos datos, papel Carta. */}
            <ReporteImprimible
              empresa={company?.trade_name}
              titulo={`Estado de cuenta · ${fichaSup?.name ?? ''}`}
              periodo={ficha.ultima_compra ? `Última compra: ${new Date(ficha.ultima_compra).toLocaleDateString('es-DO')}` : 'Sin compras'}
              filtros={[
                `Total comprado: ${formatCents(ficha.total_comprado_cents, symbol)}`,
                `Saldo pendiente: ${formatCents(ficha.saldo_cents, symbol)}`,
                `Vencido: ${formatCents(ficha.vencido_cents, symbol)}`
              ]}
              generadoPor={profile?.full_name}
            >
              <h3>Historial de compras</h3>
              <table>
                <thead><tr><th>Fecha</th><th>Ref.</th><th className="num">Total</th><th className="num">Pagado</th><th className="num">Saldo</th></tr></thead>
                <tbody>
                  {ficha.compras.map(c => (
                    <tr key={c.id}>
                      <td>{new Date(c.purchase_date).toLocaleDateString('es-DO')}</td>
                      <td>{c.invoice_ref ?? '—'}</td>
                      <td className="num">{formatCents(c.total_cents, symbol)}</td>
                      <td className="num">{formatCents(c.paid_cents, symbol)}</td>
                      <td className="num">{formatCents(c.total_cents - c.paid_cents, symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pr-nota">Saldo pendiente total: {formatCents(ficha.saldo_cents, symbol)} · Vencido: {formatCents(ficha.vencido_cents, symbol)}</p>
            </ReporteImprimible>
          </div>
        ) : (
          <p className="text-xs text-faint">No se pudo cargar la ficha.</p>
        )}
      </PanelDetalle>
    </div>
  );
};
