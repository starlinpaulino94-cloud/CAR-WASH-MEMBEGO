import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import {
  fetchChecklist, createChecklistItem, deleteChecklistItem, QcChecklistItem
} from '../../data/qualityRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice
} from '../common/DataViewShell';
import { textInputClass } from '../common/FormModal';

/**
 * Configuración del control de calidad.
 *
 * Aquí se definen los puntos que el revisor marca al terminar un lavado. La
 * revisión en sí ocurre en la Cola (Operaciones → Cola), sobre la tarjeta que
 * está en control de calidad.
 */
export const QualitySupabaseView: React.FC = () => {
  const { company, profile, phase } = useAuth();
  const editable = can(profile, 'manageCatalog');

  const [items, setItems] = useState<QcChecklistItem[]>([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    fetchChecklist()
      .then(setItems)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar el checklist'))
      .finally(() => setLoading(false));
  }, [phase]);

  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    if (!company || busy) return;
    if (!label.trim()) { setError('Escriba el punto a revisar.'); return; }
    setBusy(true); setError(null);
    try {
      await createChecklistItem({
        companyId: company.id, label, sortOrder: items.length + 1
      });
      setLabel('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el punto');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteChecklistItem(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el punto');
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Calidad" subtitle="Puntos de revisión antes de entregar" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && items.length === 0 && !loading) {
    return <ErrorState message={error} onRetry={reload} title="No se pudo cargar el checklist" />;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <ViewHeader
        title="Calidad"
        subtitle="Qué se revisa antes de entregar un vehículo"
      />

      {!editable && <ReadOnlyNotice>Su rol permite consultar el checklist, no editarlo.</ReadOnlyNotice>}
      {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <InlineAlert tone="warning">
        La revisión se hace en <strong>Operaciones → Cola</strong>: la tarjeta que llega a control
        de calidad ofrece «Revisar calidad…». Aprobarla deja la orden lista; rechazarla la
        devuelve a lavado como reproceso, con el motivo visible para el operario.
      </InlineAlert>

      <section className="bg-surface/80 border border-line rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
          Puntos de revisión
        </h3>

        {loading ? (
          <div className="h-24 bg-surface-2/60 rounded-xl animate-pulse" />
        ) : items.length === 0 ? (
          <p className="text-sm text-faint italic text-center py-4">
            Todavía no hay puntos configurados. Sin ellos se puede aprobar o rechazar, pero no
            queda constancia de qué se revisó.
          </p>
        ) : (
          <ol className="space-y-2">
            {items.map((i, idx) => (
              <li key={i.id} className="flex items-center gap-3 bg-canvas/60 border border-line rounded-xl p-3">
                <span className="w-6 h-6 rounded-lg bg-surface-2 text-muted text-xs font-bold grid place-items-center flex-shrink-0">
                  {idx + 1}
                </span>
                <span className="flex-1 text-sm font-medium text-strong">{i.label}</span>
                {editable && (
                  <button onClick={() => void remove(i.id)} aria-label={`Quitar ${i.label}`}
                    className="p-1.5 text-faint hover:text-danger">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}

        {editable && (
          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-line">
            <input aria-label="Nuevo punto de revisión" className={`${textInputClass} flex-1`}
              value={label} onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void add(); }}
              placeholder="Ej.: Cristales sin marcas" />
            <button onClick={() => void add()} disabled={busy || !label.trim()}
              className="px-4 py-2 bg-brand hover:bg-brand disabled:bg-surface-3 text-strong font-bold text-sm rounded-xl flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Agregar punto
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
