import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Plus, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { fetchNcfSequences, saveNcfSequence, NcfSequence, NcfType } from '../../data/fiscalRepository';
import { fetchFiscalStatus, FiscalStatus } from '../../data/billingRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow, StatCard
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const TIPOS: { id: NcfType; label: string }[] = [
  { id: 'B01', label: 'B01 · Crédito fiscal' },
  { id: 'B02', label: 'B02 · Consumidor final' },
  { id: 'B04', label: 'B04 · Nota de crédito' },
  { id: 'B14', label: 'B14 · Régimen especial' },
  { id: 'B15', label: 'B15 · Gubernamental' }
];

const emptyForm = {
  ncfType: 'B02' as NcfType, series: 'B',
  rangeStart: '', rangeEnd: '', authorizedUntil: ''
};

/**
 * Rangos NCF autorizados por la DGII.
 *
 * Sin un rango vigente el punto de venta cobra igual, pero emite un recibo
 * interno en vez de un comprobante fiscal. Esta pantalla es donde se cargan los
 * rangos y donde se ve cuánto queda antes de que se agoten — que es el aviso
 * que nadie quiere recibir un sábado por la tarde.
 */
export const FiscalSupabaseView: React.FC = () => {
  const { profile, phase, company } = useAuth();
  const canManage = can(profile, 'manageNcfRanges');
  const canView = can(profile, 'viewNcfRanges');

  const [rows, setRows] = useState<NcfSequence[]>([]);
  const [status, setStatus] = useState<FiscalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      canView ? fetchNcfSequences() : Promise.resolve([]),
      fetchFiscalStatus().catch(() => null)
    ])
      .then(([r, s]) => { setRows(r); setStatus(s); })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar los rangos'))
      .finally(() => setLoading(false));
  }, [phase, canView, nonce]);

  const [modal, setModal] = useState<'create' | NcfSequence | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openCreate = () => { setForm(emptyForm); setError(null); setModal('create'); };
  const openEdit = (s: NcfSequence) => {
    setForm({
      ncfType: s.ncf_type, series: s.series,
      rangeStart: String(s.range_start), rangeEnd: String(s.range_end),
      authorizedUntil: s.authorized_until
    });
    setError(null); setModal(s);
  };

  const submit = async () => {
    if (!company || busy) return;
    const desde = Number(form.rangeStart);
    const hasta = Number(form.rangeEnd);
    if (!Number.isInteger(desde) || desde <= 0) { setError('El inicio del rango debe ser un número mayor que cero.'); return; }
    if (!Number.isInteger(hasta) || hasta < desde) { setError('El fin del rango no puede ser menor que el inicio.'); return; }
    if (!form.authorizedUntil) { setError('Indique hasta cuándo está autorizado.'); return; }

    setBusy(true); setError(null);
    try {
      await saveNcfSequence({
        id: modal === 'create' ? null : modal?.id,
        companyId: company.id,
        ncfType: form.ncfType,
        series: form.series.trim() || 'B',
        rangeStart: desde, rangeEnd: hasta,
        authorizedUntil: form.authorizedUntil,
        isActive: modal === 'create' ? true : modal?.is_active
      });
      setModal(null);
      setNotice(`Rango ${form.ncfType} guardado.`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el rango');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: NcfSequence) => {
    if (!company) return;
    try {
      await saveNcfSequence({
        id: s.id, companyId: company.id, ncfType: s.ncf_type, series: s.series,
        rangeStart: s.range_start, rangeEnd: s.range_end,
        authorizedUntil: s.authorized_until, isActive: !s.is_active
      });
      setNotice(s.is_active ? 'Rango desactivado.' : 'Rango activado.');
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Fiscal" subtitle="Rangos NCF autorizados por la DGII" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Fiscal" subtitle="Rangos NCF autorizados por la DGII" />
        <ReadOnlyNotice>
          Los rangos NCF son un recurso fiscal controlado: solo los ve la propiedad,
          la administración y contabilidad.
        </ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudieron cargar los rangos" />;
  }

  const restante = (s: NcfSequence) => Math.max(0, s.range_end - s.next_value + 1);
  const vencido = (s: NcfSequence) => new Date(`${s.authorized_until}T23:59:59`) < new Date();
  const agotado = (s: NcfSequence) => restante(s) === 0;
  const enRiesgo = rows.filter(s => s.is_active && !vencido(s) && !agotado(s) && restante(s) <= 50);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        title="Fiscal"
        subtitle="Rangos NCF: sin uno vigente se emite recibo interno, no comprobante fiscal"
        actions={canManage ? (
          <Button size="sm" onClick={openCreate}
            >
            <Plus className="w-4 h-4" /> Cargar rango
          </Button>
        ) : undefined}
      />

      {!canManage && <ReadOnlyNotice>Su rol permite consultar los rangos, no cargarlos.</ReadOnlyNotice>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !modal && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Facturación fiscal"
          value={status?.ready ? 'Activa' : 'Sin rangos'}
          tone={status?.ready ? 'text-success' : 'text-warning'}
          hint={status?.ready ? `Tipos: ${status.types.join(', ')}` : 'Se emite recibo interno'} />
        <StatCard label="Rangos cargados" value={String(rows.length)} />
        <StatCard label="Por agotarse" value={String(enRiesgo.length)}
          tone={enRiesgo.length > 0 ? 'text-warning' : undefined}
          hint="Quedan 50 o menos" />
      </div>

      {enRiesgo.length > 0 && (
        <InlineAlert tone="warning">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Hay {enRiesgo.length} rango(s) a punto de agotarse. Pida la autorización nueva
            a la DGII antes de que se acabe: cuando se agota, el cobro con NCF se detiene.
          </span>
        </InlineAlert>
      )}

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Rangos NCF</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">TIPO</th>
                <th scope="col" className="p-3 font-semibold">RANGO</th>
                <th scope="col" className="p-3 font-semibold text-right">USADOS</th>
                <th scope="col" className="p-3 font-semibold text-right">QUEDAN</th>
                <th scope="col" className="p-3 font-semibold">AUTORIZADO HASTA</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
                {canManage && <th scope="col" className="p-3 font-semibold text-right">ACCIONES</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? <SkeletonRows cols={canManage ? 7 : 6} />
                : rows.length === 0 ? (
                  <EmptyRow cols={canManage ? 7 : 6}>
                    Sin rangos cargados: el cobro emite recibo interno, no comprobante fiscal.
                  </EmptyRow>
                ) : rows.map(s => (
                  <tr key={s.id} className="hover:bg-surface-2/40">
                    <td className="p-3 font-bold text-strong">{s.ncf_type}</td>
                    <td className="p-3 text-muted tabular-nums">
                      {s.series}{String(s.range_start).padStart(8, '0')} — {s.series}{String(s.range_end).padStart(8, '0')}
                    </td>
                    <td className="p-3 text-right text-body tabular-nums">
                      {s.next_value - s.range_start}
                    </td>
                    <td className={`p-3 text-right font-bold tabular-nums ${
                      restante(s) === 0 ? 'text-danger'
                        : restante(s) <= 50 ? 'text-warning' : 'text-body'}`}>
                      {restante(s)}
                    </td>
                    <td className={`p-3 tabular-nums ${vencido(s) ? 'text-danger' : 'text-muted'}`}>
                      {s.authorized_until}
                    </td>
                    <td className="p-3">
                      {!s.is_active
                        ? <span className="bg-surface-3/50 text-muted font-bold px-2 py-0.5 rounded text-xs">Inactivo</span>
                        : vencido(s)
                          ? <span className="bg-danger/20 text-danger font-bold px-2 py-0.5 rounded text-xs">Vencido</span>
                          : agotado(s)
                            ? <span className="bg-danger/20 text-danger font-bold px-2 py-0.5 rounded text-xs">Agotado</span>
                            : <span className="bg-success/20 text-success font-bold px-2 py-0.5 rounded text-xs">Vigente</span>}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button variant="secondary" size="xs" onClick={() => openEdit(s)}
                          >
                          Editar
                        </Button>
                        <Button variant="secondary" size="xs" className="ml-1" onClick={() => void toggleActive(s)}
                          >
                          {s.is_active ? 'Desactivar' : 'Activar'}
                        </Button>
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
          title={modal === 'create' ? 'Cargar rango NCF' : `Editar rango ${modal.ncf_type}`}
          submitLabel={modal === 'create' ? 'Cargar rango' : 'Guardar cambios'}
          busy={busy}
          error={error}
          onSubmit={() => void submit()}
          onClose={() => setModal(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Tipo de comprobante" htmlFor="ncf-type">
            <select id="ncf-type" className={textInputClass} value={form.ncfType}
              onChange={e => setForm(f => ({ ...f, ncfType: e.target.value as NcfType }))}>
              {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Serie" htmlFor="ncf-series">
              <input id="ncf-series" className={textInputClass} value={form.series}
                onChange={e => setForm(f => ({ ...f, series: e.target.value.toUpperCase() }))} />
            </Field>
            <Field label="Desde" htmlFor="ncf-from">
              <input id="ncf-from" className={textInputClass} value={form.rangeStart}
                inputMode="numeric" onChange={e => setForm(f => ({ ...f, rangeStart: e.target.value }))}
                placeholder="1" />
            </Field>
            <Field label="Hasta" htmlFor="ncf-to">
              <input id="ncf-to" className={textInputClass} value={form.rangeEnd}
                inputMode="numeric" onChange={e => setForm(f => ({ ...f, rangeEnd: e.target.value }))}
                placeholder="1000" />
            </Field>
          </div>
          <Field label="Autorizado hasta" htmlFor="ncf-until">
            <input id="ncf-until" type="date" className={textInputClass} value={form.authorizedUntil}
              onChange={e => setForm(f => ({ ...f, authorizedUntil: e.target.value }))} />
          </Field>
          <p className="text-xs text-faint">
            {modal === 'create'
              ? 'El correlativo empieza en el inicio del rango y avanza solo con cada comprobante emitido.'
              : 'El correlativo ya consumido no se toca: moverlo hacia atrás repetiría NCF ya emitidos.'}
          </p>
        </FormModal>
      )}
    </div>
  );
};
