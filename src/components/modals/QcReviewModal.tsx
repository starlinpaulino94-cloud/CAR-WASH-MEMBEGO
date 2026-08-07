import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Loader2, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import {
  fetchChecklist, fetchOrderReviews, submitQcReview,
  QcChecklistItem, QcReview, QcResultInput
} from '../../data/qualityRepository';
import { Profile } from '../../data/adminRepository';
import { InlineAlert } from '../common/DataViewShell';
import { Field, textInputClass } from '../common/FormModal';

/**
 * Revisión de calidad de una orden.
 *
 * Marca punto por punto lo revisado y decide: aprobar (la orden pasa a lista)
 * o rechazar con motivo (vuelve a lavado como reproceso). El servidor numera
 * el intento y registra quién revisó.
 */
export const QcReviewModal: React.FC<{
  orderId: string;
  orderNumber: string;
  plate: string;
  operators: Profile[];
  onClose: () => void;
  onDone: (result: 'aprobado' | 'rechazado') => void;
}> = ({ orderId, orderNumber, plate, operators, onClose, onDone }) => {
  const [items, setItems] = useState<QcChecklistItem[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<QcReview[]>([]);
  const [washerId, setWasherId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchChecklist(), fetchOrderReviews(orderId)])
      .then(([list, revs]) => {
        setItems(list);
        setHistory(revs);
        // Todo empieza aprobado: revisar es buscar lo que NO pasó.
        setChecks(Object.fromEntries(list.map(i => [i.id, true])));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el checklist'))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const failed = items.filter(i => !checks[i.id]);

  const send = async (result: 'aprobado' | 'rechazado') => {
    if (busy) return;
    if (result === 'rechazado' && rejectReason.trim().length < 5) {
      setError('Explique por qué se rechaza (mínimo 5 caracteres).');
      return;
    }
    setBusy(true); setError(null);
    try {
      const results: QcResultInput[] = items.map(i => ({
        itemId: i.id, label: i.label, passed: Boolean(checks[i.id])
      }));
      await submitQcReview({
        orderId, result, results,
        rejectReason: result === 'rechazado' ? rejectReason.trim() : null,
        washerId: washerId || null,
        notes: notes.trim() || null
      });
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la revisión');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Control de calidad de ${plate}`}
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="font-bold text-white text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            Control de calidad — {plate}
            <span className="text-slate-500 font-normal">· {orderNumber}</span>
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

          {history.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-sm font-bold text-amber-200">
                <RotateCcw className="w-4 h-4" /> Reproceso · intento {history.length + 1}
              </div>
              {history.filter(h => h.result === 'rechazado').map(h => (
                <p key={h.id} className="text-xs text-amber-200/80">
                  Intento {h.attempt}: {h.reject_reason}
                </p>
              ))}
            </div>
          )}

          {loading ? (
            <div className="h-32 bg-slate-800/60 rounded-xl animate-pulse" />
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500 italic bg-slate-950/50 rounded-xl p-4 text-center">
              No hay puntos de revisión configurados. Puede aprobar o rechazar igualmente;
              defina el checklist en Operaciones → Calidad para dejar constancia de qué se revisa.
            </p>
          ) : (
            <div className="space-y-1.5">
              <span className="text-sm font-semibold text-slate-400 uppercase">Puntos a revisar</span>
              {items.map(i => (
                <label key={i.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    checks[i.id]
                      ? 'bg-slate-950/60 border-slate-800 text-slate-200'
                      : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                  }`}>
                  <input type="checkbox" checked={Boolean(checks[i.id])} className="accent-emerald-500 w-4 h-4"
                    onChange={e => setChecks(c => ({ ...c, [i.id]: e.target.checked }))} />
                  <span className="text-sm font-medium">{i.label}</span>
                </label>
              ))}
              {failed.length > 0 && (
                <p className="text-xs text-rose-300 pt-1">
                  {failed.length} {failed.length === 1 ? 'punto no pasó' : 'puntos no pasaron'} la revisión.
                </p>
              )}
            </div>
          )}

          <Field label="Quién lavó" htmlFor="qc-washer"
            hint="De aquí sale el índice de retrabajos por operario.">
            <select id="qc-washer" className={textInputClass} value={washerId}
              onChange={e => setWasherId(e.target.value)}>
              <option value="">— Sin indicar —</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </select>
          </Field>

          <Field label="Motivo del rechazo" htmlFor="qc-reason"
            hint="Obligatorio si se rechaza: el operario necesita saber qué corregir.">
            <input id="qc-reason" className={textInputClass} value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Quedaron marcas en los cristales" />
          </Field>

          <Field label="Notas" htmlFor="qc-notes">
            <input id="qc-notes" className={textInputClass} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Observaciones de la revisión" />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3.5">
          <button onClick={() => void send('rechazado')} disabled={busy}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
            Rechazar y reprocesar
          </button>
          <button onClick={() => void send('aprobado')} disabled={busy}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
            Aprobar
          </button>
        </div>
      </div>
    </div>
  );
};
