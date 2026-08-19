import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { X, ClipboardCheck, Trash2, Loader2, Lock, PenLine, Eraser } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  fetchOrderInspections, createInspection, updateInspection, addDamage, removeDamage,
  signInspection, InspectionWithDamages, DamageKind, DamageSeverity, FuelLevel, InspectionStage
} from '../../data/inspectionRepository';
import { InlineAlert } from '../common/DataViewShell';
import { Field, textInputClass } from '../common/FormModal';

const FUEL: { id: FuelLevel; label: string }[] = [
  { id: 'reserva', label: 'Reserva' }, { id: '1/4', label: '1/4' },
  { id: '1/2', label: '1/2' }, { id: '3/4', label: '3/4' }, { id: 'lleno', label: 'Lleno' }
];

const KINDS: { id: DamageKind; label: string }[] = [
  { id: 'rayon', label: 'Rayón' }, { id: 'abolladura', label: 'Abolladura' },
  { id: 'rotura', label: 'Rotura' }, { id: 'faltante', label: 'Pieza faltante' },
  { id: 'mancha', label: 'Mancha' }, { id: 'oxido', label: 'Óxido' }, { id: 'otro', label: 'Otro' }
];

const SEVERITIES: { id: DamageSeverity; label: string; tone: string }[] = [
  { id: 'leve', label: 'Leve', tone: 'bg-warning/20 text-warning' },
  { id: 'moderado', label: 'Moderado', tone: 'bg-warning/20 text-warning' },
  { id: 'grave', label: 'Grave', tone: 'bg-danger/20 text-danger' }
];

const ZONES = [
  'Capó', 'Techo', 'Baúl', 'Bumper delantero', 'Bumper trasero',
  'Puerta delantera izquierda', 'Puerta trasera izquierda',
  'Puerta delantera derecha', 'Puerta trasera derecha',
  'Guardafango izquierdo', 'Guardafango derecho',
  'Parabrisas', 'Cristal trasero', 'Retrovisor izquierdo', 'Retrovisor derecho',
  'Aros / neumáticos', 'Interior', 'Otro'
];

/** Lienzo de firma: traza con el dedo o el ratón y exporta un PNG pequeño. */
const SignaturePad: React.FC<{ onChange: (dataUrl: string | null) => void }> = ({ onChange }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing.current = true;
    ref.current!.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
  };

  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  return (
    <div className="space-y-2">
      <canvas
        ref={ref} width={560} height={160}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        aria-label="Firma del cliente"
        className="w-full h-32 bg-white rounded-xl border-2 border-dashed border-line-strong touch-none cursor-crosshair"
      />
      <button type="button" onClick={clear}
        className="text-xs font-bold text-muted hover:text-strong flex items-center gap-1">
        <Eraser className="w-3.5 h-3.5" /> Borrar firma
      </button>
    </div>
  );
};

/**
 * Inspección del vehículo.
 *
 * Deja constancia del estado con que ENTRA el vehículo (y con el que sale):
 * daños marcados sobre el diagrama, combustible, objetos de valor y firma del
 * cliente. Al firmar, la base congela la evidencia: ya no se puede editar.
 */
export const InspectionModal: React.FC<{
  orderId: string;
  orderNumber: string;
  plate: string;
  onClose: () => void;
}> = ({ orderId, orderNumber, plate, onClose }) => {
  const { company, branch } = useAuth();

  const [stage, setStage] = useState<InspectionStage>('recepcion');
  const [list, setList] = useState<InspectionWithDamages[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Campos de la inspección en curso.
  const [fuel, setFuel] = useState<FuelLevel | ''>('');
  const [mileage, setMileage] = useState('');
  const [valuables, setValuables] = useState('');
  const [notes, setNotes] = useState('');

  // Alta de daño.
  const [zone, setZone] = useState(ZONES[0]);
  const [kind, setKind] = useState<DamageKind>('rayon');
  const [severity, setSeverity] = useState<DamageSeverity>('leve');
  const [damageNote, setDamageNote] = useState('');

  // Firma.
  const [signature, setSignature] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState('');

  const current = list.find(i => i.stage === stage) ?? null;
  const frozen = Boolean(current?.signature);

  const reload = useCallback(async () => {
    try {
      const rows = await fetchOrderInspections(orderId);
      setList(rows);
      const active = rows.find(i => i.stage === stage);
      if (active) {
        setFuel(active.fuel_level ?? '');
        setMileage(active.mileage !== null ? String(active.mileage) : '');
        setValuables(active.valuables ?? '');
        setNotes(active.notes ?? '');
      } else {
        setFuel(''); setMileage(''); setValuables(''); setNotes('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la inspección');
    } finally {
      setLoading(false);
    }
  }, [orderId, stage]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  /** Crea la inspección si aún no existe, y devuelve su id. */
  const ensure = async (): Promise<string> => {
    if (current) return current.id;
    if (!company) throw new Error('Sin empresa activa');
    const created = await createInspection({
      companyId: company.id, branchId: branch?.id ?? null,
      workOrderId: orderId, stage,
      fuelLevel: fuel === '' ? null : fuel,
      mileage: mileage.trim() === '' ? null : Number(mileage),
      valuables: valuables.trim() || null,
      notes: notes.trim() || null
    });
    await reload();
    return created.id;
  };

  const saveFields = async () => {
    if (busy || frozen) return;
    setBusy(true); setError(null);
    try {
      if (mileage.trim() !== '' && !Number.isInteger(Number(mileage))) {
        throw new Error('El kilometraje debe ser un número entero.');
      }
      if (!current) {
        await ensure();
      } else {
        await updateInspection(current.id, {
          fuel_level: fuel === '' ? null : fuel,
          mileage: mileage.trim() === '' ? null : Number(mileage),
          valuables: valuables.trim() || null,
          notes: notes.trim() || null
        });
        await reload();
      }
      setNotice('Inspección guardada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const submitDamage = async () => {
    if (busy || frozen || !company) return;
    setBusy(true); setError(null);
    try {
      const id = await ensure();
      await addDamage({
        companyId: company.id, inspectionId: id, zone,
        kind, severity, note: damageNote.trim() || null,
        posX: null, posY: null
      });
      setDamageNote('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el daño');
    } finally {
      setBusy(false);
    }
  };

  const dropDamage = async (id: string) => {
    setError(null);
    try {
      await removeDamage(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el daño');
    }
  };

  const sign = async () => {
    if (busy || frozen) return;
    if (!signature) { setError('Falta la firma del cliente.'); return; }
    if (!signedBy.trim()) { setError('Indique el nombre de quien firma.'); return; }
    setBusy(true); setError(null);
    try {
      const id = await ensure();
      await signInspection(id, signature, signedBy.trim());
      setSignature(null); setSignedBy('');
      await reload();
      setNotice('Inspección firmada. Queda como evidencia y ya no se puede editar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo firmar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Inspección de ${plate}`}
        className="w-full max-w-2xl bg-surface border border-line-strong rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-bold text-strong text-sm flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-info" />
            Inspección — {plate} <span className="text-faint font-normal">· {orderNumber}</span>
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-strong">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Momento: recepción o entrega */}
        <div className="flex gap-1 px-5 pt-3">
          {(['recepcion', 'entrega'] as InspectionStage[]).map(s => {
            const done = list.some(i => i.stage === s && i.signature);
            return (
              <button key={s} onClick={() => setStage(s)}
                className={`px-4 py-2 text-sm font-bold border-b-2 flex items-center gap-1.5 ${
                  stage === s ? 'border-info text-strong' : 'border-transparent text-muted hover:text-strong'
                }`}>
                {s === 'recepcion' ? 'Recepción' : 'Entrega'}
                {done && <Lock className="w-3 h-3 text-success" />}
              </button>
            );
          })}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto border-t border-line">
          {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}
          {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

          {loading ? (
            <div className="h-40 bg-surface-2/60 rounded-xl animate-pulse" />
          ) : (
            <>
              {frozen && (
                <div className="flex items-start gap-2 bg-success/40 border border-success/40 rounded-xl p-3 text-sm text-success">
                  <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Firmada por <strong>{current?.signed_by}</strong> el{' '}
                    {current?.signed_at && new Date(current.signed_at).toLocaleString('es-DO')}.
                    Es evidencia: ya no se modifica.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Nivel de combustible" htmlFor="insp-fuel">
                  <select id="insp-fuel" className={textInputClass} value={fuel} disabled={frozen}
                    onChange={e => setFuel(e.target.value as FuelLevel | '')}>
                    <option value="">— Sin registrar —</option>
                    {FUEL.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </Field>
                <Field label="Kilometraje" htmlFor="insp-km">
                  <input id="insp-km" type="number" min={0} className={textInputClass}
                    value={mileage} disabled={frozen}
                    onChange={e => setMileage(e.target.value)} placeholder="84000" />
                </Field>
              </div>

              <Field label="Objetos de valor declarados" htmlFor="insp-val"
                hint="Lo que el cliente deja en el vehículo.">
                <input id="insp-val" className={textInputClass} value={valuables} disabled={frozen}
                  onChange={e => setValuables(e.target.value)}
                  placeholder="Cargador, gafas, documentos…" />
              </Field>

              <Field label="Observaciones" htmlFor="insp-notes">
                <input id="insp-notes" className={textInputClass} value={notes} disabled={frozen}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Indicaciones del cliente, condiciones especiales…" />
              </Field>

              {!frozen && (
                <Button variant="secondary" onClick={() => void saveFields()} disabled={busy}
                  >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Guardar datos
                </Button>
              )}

              {/* -------- Daños -------- */}
              <div className="border-t border-line pt-4 space-y-3">
                <h3 className="font-bold text-strong text-sm">
                  Daños registrados
                  {current && current.damages.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted">
                      ({current.damages.length})
                    </span>
                  )}
                </h3>

                {!current || current.damages.length === 0 ? (
                  <p className="text-sm text-faint italic bg-canvas/50 rounded-xl p-3 text-center">
                    Sin daños marcados. Si el vehículo llega con rayones o abolladuras, márquelos
                    antes de firmar: es lo que protege ante un reclamo.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {current.damages.map(d => {
                      const sev = SEVERITIES.find(s => s.id === d.severity)!;
                      return (
                        <li key={d.id} className="flex items-start gap-2 bg-canvas/60 border border-line rounded-xl p-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-strong text-sm">{d.zone}</div>
                            <div className="text-xs text-muted">
                              {KINDS.find(k => k.id === d.kind)?.label}
                              {d.note && ` · ${d.note}`}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${sev.tone}`}>{sev.label}</span>
                          {!frozen && (
                            <button onClick={() => void dropDamage(d.id)} aria-label={`Quitar daño en ${d.zone}`}
                              className="p-1 text-faint hover:text-danger">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {!frozen && (
                  <div className="space-y-2 bg-canvas/40 rounded-xl p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select aria-label="Zona del daño" className={textInputClass}
                        value={zone} onChange={e => setZone(e.target.value)}>
                        {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                      </select>
                      <select aria-label="Tipo de daño" className={textInputClass}
                        value={kind} onChange={e => setKind(e.target.value as DamageKind)}>
                        {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </select>
                      <select aria-label="Gravedad del daño" className={textInputClass}
                        value={severity} onChange={e => setSeverity(e.target.value as DamageSeverity)}>
                        {SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                    <input aria-label="Detalle del daño" className={textInputClass}
                      value={damageNote} onChange={e => setDamageNote(e.target.value)}
                      placeholder="Detalle (opcional): tamaño, ubicación exacta…" />
                    <button onClick={() => void submitDamage()} disabled={busy}
                      className="px-4 py-2 bg-info hover:bg-info disabled:bg-surface-3 text-on-accent font-bold text-sm rounded-xl">
                      Agregar daño
                    </button>
                  </div>
                )}
              </div>

              {/* -------- Firma -------- */}
              {!frozen ? (
                <div className="border-t border-line pt-4 space-y-3">
                  <h3 className="font-bold text-strong text-sm flex items-center gap-2">
                    <PenLine className="w-4 h-4 text-info" /> Firma del cliente
                  </h3>
                  <p className="text-sm text-muted">
                    El cliente confirma que el vehículo se recibe en el estado descrito arriba.
                    Al firmar, la inspección queda cerrada y no se podrá editar.
                  </p>
                  <SignaturePad onChange={setSignature} />
                  <Field label="Nombre de quien firma *" htmlFor="insp-signer">
                    <input id="insp-signer" className={textInputClass} value={signedBy}
                      onChange={e => setSignedBy(e.target.value)} placeholder="Nombre y apellido" />
                  </Field>
                  <button onClick={() => void sign()} disabled={busy || !signature || !signedBy.trim()}
                    className="px-4 py-2.5 bg-success hover:bg-success disabled:bg-surface-3 disabled:text-faint text-on-accent font-bold text-sm rounded-xl flex items-center gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
                    Firmar y cerrar inspección
                  </button>
                </div>
              ) : current?.signature && (
                <div className="border-t border-line pt-4 space-y-2">
                  <h3 className="font-bold text-strong text-sm">Firma</h3>
                  <img src={current.signature} alt={`Firma de ${current.signed_by}`}
                    className="w-full max-w-sm bg-white rounded-xl border border-line-strong" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
