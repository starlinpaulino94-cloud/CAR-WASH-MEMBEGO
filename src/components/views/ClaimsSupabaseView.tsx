import React, { useCallback, useState } from 'react';
import { Plus, Loader2, CheckCircle2, XCircle, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import {
  fetchClaimPage, fetchClaimEvents, openClaim, addClaimNote, resolveClaim,
  Claim, ClaimEvent, ClaimKind
} from '../../data/claimRepository';
import {
  ViewHeader, ErrorState, SearchBox, Pagination, SkeletonRows, EmptyRow,
  InlineAlert, ReadOnlyNotice, FilterChips
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const PAGE_SIZE = 25;

const KINDS: { id: ClaimKind; label: string }[] = [
  { id: 'dano_vehiculo', label: 'Daño al vehículo' },
  { id: 'objeto_perdido', label: 'Objeto perdido' },
  { id: 'servicio_deficiente', label: 'Servicio deficiente' },
  { id: 'cobro', label: 'Cobro' },
  { id: 'demora', label: 'Demora' },
  { id: 'otro', label: 'Otro' }
];

const STATUS_TONE: Record<string, string> = {
  abierto: 'bg-danger/20 text-danger',
  en_revision: 'bg-warning/20 text-warning',
  resuelto: 'bg-success/20 text-success',
  rechazado: 'bg-surface-3/60 text-body'
};
const STATUS_LABEL: Record<string, string> = {
  abierto: 'Abierto', en_revision: 'En revisión',
  resuelto: 'Resuelto', rechazado: 'Rechazado'
};

type Filter = 'open' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Abiertos' },
  { id: 'all', label: 'Todos' }
];

/**
 * Reclamos e incidentes.
 *
 * Registrarlos permite cerrarlos con evidencia (la inspección firmada de la
 * recepción), medir lo que costaron y encontrar el patrón. La bitácora de cada
 * reclamo es de solo inserción.
 */
export const ClaimsSupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canOpen = ['propietario', 'administrador', 'supervisor', 'recepcionista', 'cajero', 'superadmin']
    .includes(profile?.role ?? '');
  const canClose = ['propietario', 'administrador', 'supervisor', 'superadmin']
    .includes(profile?.role ?? '');

  const [filter, setFilter] = useState<Filter>('open');
  const q = usePagedQuery<Claim>({
    fetcher: (page, size, search) => fetchClaimPage(page, size, search, filter === 'open'),
    pageSize: PAGE_SIZE,
    deps: [filter],
    enabled: phase === 'ready'
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Alta.
  const [showOpen, setShowOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<ClaimKind>('dano_vehiculo');
  const [description, setDescription] = useState('');

  // Detalle / seguimiento.
  const [detail, setDetail] = useState<Claim | null>(null);
  const [events, setEvents] = useState<ClaimEvent[]>([]);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState('');
  const [rootCause, setRootCause] = useState('');

  const openDetail = useCallback(async (c: Claim) => {
    setDetail(c); setError(null);
    setNote(''); setResolution(''); setCost(''); setRootCause('');
    try { setEvents(await fetchClaimEvents(c.id)); } catch { setEvents([]); }
  }, []);

  const submitOpen = async () => {
    if (busy) return;
    if (!name.trim()) { setError('Indique el nombre del cliente.'); return; }
    if (description.trim().length < 10) { setError('Describa el reclamo (mínimo 10 caracteres).'); return; }
    setBusy(true); setError(null);
    try {
      await openClaim({
        customerName: name.trim(), kind, description: description.trim(),
        customerPhone: phone.trim() || null
      });
      setShowOpen(false); setName(''); setPhone(''); setDescription('');
      setNotice('Reclamo registrado.');
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el reclamo');
    } finally {
      setBusy(false);
    }
  };

  const submitNote = async () => {
    if (!detail || busy) return;
    if (!note.trim()) { setError('Escriba la nota.'); return; }
    setBusy(true); setError(null);
    try {
      const updated = await addClaimNote(
        detail.id, note.trim(),
        detail.status === 'abierto' ? 'en_revision' : undefined
      );
      setDetail(updated); setNote('');
      setEvents(await fetchClaimEvents(detail.id));
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anotar');
    } finally {
      setBusy(false);
    }
  };

  const close = async (status: 'resuelto' | 'rechazado') => {
    if (!detail || busy) return;
    if (resolution.trim().length < 5) { setError('Explique cómo se resolvió (mínimo 5 caracteres).'); return; }
    setBusy(true); setError(null);
    try {
      await resolveClaim({
        claimId: detail.id, status, resolution: resolution.trim(),
        costCents: parseAmountToCents(cost) ?? 0,
        rootCause: rootCause.trim() || null
      });
      setDetail(null);
      setNotice(status === 'resuelto' ? 'Reclamo resuelto.' : 'Reclamo rechazado.');
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar el reclamo');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Reclamos" subtitle="Incidentes y su resolución" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} title="No se pudieron cargar los reclamos" />;

  const closed = detail && ['resuelto', 'rechazado'].includes(detail.status);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Reclamos"
        subtitle="Qué reclamó el cliente, cómo se resolvió y cuánto costó"
        actions={canOpen ? (
          <button onClick={() => { setError(null); setShowOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl">
            <Plus className="w-4 h-4" /> Nuevo reclamo
          </button>
        ) : undefined}
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showOpen && !detail && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBox id="cl-search" label="Buscar reclamo" value={q.searchInput}
          onChange={q.setSearchInput} placeholder="Buscar por cliente o descripción…" />
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Reclamos</caption>
            <thead>
              <tr className="border-b border-line text-muted bg-canvas/50">
                <th scope="col" className="p-3 font-semibold">FECHA</th>
                <th scope="col" className="p-3 font-semibold">CLIENTE</th>
                <th scope="col" className="p-3 font-semibold">TIPO</th>
                <th scope="col" className="p-3 font-semibold">DESCRIPCIÓN</th>
                <th scope="col" className="p-3 font-semibold text-right">COSTO</th>
                <th scope="col" className="p-3 font-semibold">ESTADO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {q.loading ? <SkeletonRows cols={6} />
                : q.rows.length === 0 ? (
                  <EmptyRow cols={6}>
                    {filter === 'open' ? 'No hay reclamos abiertos.' : 'Todavía no hay reclamos registrados.'}
                  </EmptyRow>
                ) : q.rows.map(c => (
                  <tr key={c.id} className="hover:bg-surface-2/40 cursor-pointer"
                    onClick={() => void openDetail(c)}>
                    <td className="p-3 text-muted whitespace-nowrap">
                      {new Date(c.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-strong">{c.customer_name}</div>
                      {c.customer_phone && <div className="text-xs text-faint">{c.customer_phone}</div>}
                    </td>
                    <td className="p-3 text-body whitespace-nowrap">
                      {KINDS.find(k => k.id === c.kind)?.label ?? c.kind}
                    </td>
                    <td className="p-3 text-muted max-w-md truncate">{c.description}</td>
                    <td className="p-3 text-right tabular-nums whitespace-nowrap text-body">
                      {c.cost_cents > 0 ? formatCents(c.cost_cents, symbol) : '—'}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-xs whitespace-nowrap ${STATUS_TONE[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={q.page} pageCount={q.pageCount} total={q.total}
          pageSize={PAGE_SIZE} loading={q.loading} onPage={q.setPage} />
      </div>

      {showOpen && (
        <FormModal
          title="Nuevo reclamo"
          submitLabel="Registrar reclamo"
          busy={busy}
          error={error}
          onSubmit={() => void submitOpen()}
          onClose={() => setShowOpen(false)}
          onDismissError={() => setError(null)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cliente *" htmlFor="cl-name">
              <input id="cl-name" className={textInputClass} value={name} autoFocus
                onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" />
            </Field>
            <Field label="Teléfono" htmlFor="cl-phone">
              <input id="cl-phone" className={textInputClass} value={phone}
                onChange={e => setPhone(e.target.value)} />
            </Field>
          </div>
          <Field label="Tipo de reclamo" htmlFor="cl-kind">
            <select id="cl-kind" className={textInputClass} value={kind}
              onChange={e => setKind(e.target.value as ClaimKind)}>
              {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Qué reclama *" htmlFor="cl-desc"
            hint="Con detalle: es lo que se revisará contra la inspección de recepción.">
            <input id="cl-desc" className={textInputClass} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Reporta un rayón en la puerta derecha que no estaba antes" />
          </Field>
        </FormModal>
      )}

      {detail && (
        <FormModal
          title={`Reclamo — ${detail.customer_name}`}
          submitLabel={closed ? 'Cerrar' : 'Agregar nota'}
          busy={busy}
          error={error}
          onSubmit={() => void (closed ? setDetail(null) : submitNote())}
          onClose={() => setDetail(null)}
          onDismissError={() => setError(null)}
          wide
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded font-bold text-xs ${STATUS_TONE[detail.status]}`}>
              {STATUS_LABEL[detail.status]}
            </span>
            <span className="text-sm text-muted">
              {KINDS.find(k => k.id === detail.kind)?.label} ·{' '}
              {new Date(detail.created_at).toLocaleString('es-DO')}
            </span>
          </div>

          <p className="text-sm text-body bg-canvas/60 border border-line rounded-xl p-3">
            {detail.description}
          </p>

          {/* Bitácora del reclamo */}
          {events.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-semibold text-muted uppercase">Seguimiento</span>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {events.map(e => (
                  <li key={e.id} className="text-sm bg-canvas/50 rounded-lg p-2.5 flex gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-faint mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-body">{e.note}</div>
                      <div className="text-xs text-faint">
                        {new Date(e.created_at).toLocaleString('es-DO')}
                        {e.status_from && e.status_to && e.status_from !== e.status_to &&
                          ` · ${STATUS_LABEL[e.status_from]} → ${STATUS_LABEL[e.status_to]}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {closed ? (
            <div className="bg-canvas/60 border border-line rounded-xl p-3 space-y-1.5 text-sm">
              <div><span className="text-muted">Resolución:</span>{' '}
                <span className="text-strong">{detail.resolution}</span></div>
              {detail.root_cause && (
                <div><span className="text-muted">Causa raíz:</span>{' '}
                  <span className="text-strong">{detail.root_cause}</span></div>
              )}
              <div><span className="text-muted">Costo asumido:</span>{' '}
                <span className="text-strong tabular-nums">{formatCents(detail.cost_cents, symbol)}</span></div>
            </div>
          ) : (
            <>
              <Field label="Nueva nota de seguimiento" htmlFor="cl-note">
                <input id="cl-note" className={textInputClass} value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Qué se averiguó o se hizo" />
              </Field>

              {canClose && (
                <div className="border-t border-line pt-4 space-y-3">
                  <span className="text-sm font-semibold text-muted uppercase">Cerrar el reclamo</span>
                  <Field label="Resolución *" htmlFor="cl-res">
                    <input id="cl-res" className={textInputClass} value={resolution}
                      onChange={e => setResolution(e.target.value)}
                      placeholder="Qué se hizo con el cliente" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={`Costo asumido (${symbol})`} htmlFor="cl-cost"
                      hint="Reembolso, repintado, servicio repetido…">
                      <input id="cl-cost" type="text" inputMode="decimal" className={textInputClass}
                        value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" />
                    </Field>
                    <Field label="Causa raíz" htmlFor="cl-root"
                      hint="Lo que evita que se repita.">
                      <input id="cl-root" className={textInputClass} value={rootCause}
                        onChange={e => setRootCause(e.target.value)} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void close('resuelto')} disabled={busy}
                      className="px-4 py-2 bg-success hover:bg-success disabled:bg-surface-3 text-on-accent font-bold text-sm rounded-xl flex items-center gap-2">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Resuelto
                    </button>
                    <button type="button" onClick={() => void close('rechazado')} disabled={busy}
                      className="px-4 py-2 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-body font-bold text-sm rounded-xl flex items-center gap-2">
                      <XCircle className="w-4 h-4" /> Rechazar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </FormModal>
      )}
    </div>
  );
};
