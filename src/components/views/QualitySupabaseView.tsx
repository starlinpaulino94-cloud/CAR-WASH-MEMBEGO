import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Plus, Trash2, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import {
  fetchChecklist, createChecklistItem, deleteChecklistItem, QcChecklistItem
} from '../../data/qualityRepository';
import {
  fetchResumenCalidad, fetchHistorialCalidad, ResumenCalidad, RevisionCalidad
} from '../../data/reportsRepository';
import { fetchOperators, Profile } from '../../data/ordersRepository';
import { ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SearchBox, Pagination } from '../common/DataViewShell';
import { textInputClass } from '../common/FormModal';
import { RejillaKpi, Kpi } from '../common/RejillaKpi';
import { TablaDatos } from '../common/TablaDatos';
import { FiltroFechas } from '../common/FiltroFechas';
import { SeleccionFecha, rangoDeFechas } from '../../lib/rangosFecha';

type Seccion = 'resumen' | 'historial' | 'config';

/**
 * Control de calidad: además de configurar el checklist, la lectura gerencial.
 *
 * La revisión sigue ocurriendo en la Cola. Aquí se añaden dos secciones sin
 * crear un módulo nuevo:
 *   · Resumen: aprobación a la primera, reprocesos, causas y quién los acumula.
 *   · Historial: cada revisión, filtrable por fecha, lavador y resultado.
 *   · Configuración: los puntos del checklist (lo que ya existía).
 */
export const QualitySupabaseView: React.FC = () => {
  const { company, profile, phase, branch } = useAuth();
  const editable = can(profile, 'manageCatalog');
  const puedeVer = can(profile, 'viewAuditLog');

  const [seccion, setSeccion] = useState<Seccion>(puedeVer ? 'resumen' : 'config');

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader title="Calidad" subtitle="Revisión antes de entregar" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  const secciones: { id: Seccion; label: string; visible: boolean }[] = [
    { id: 'resumen', label: 'Resumen', visible: puedeVer },
    { id: 'historial', label: 'Historial', visible: puedeVer },
    { id: 'config', label: 'Configuración', visible: true }
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader title="Calidad" subtitle="Aprobación a la primera, reprocesos y qué se revisa" />

      <div className="flex gap-1.5 border-b border-line" role="tablist">
        {secciones.filter(s => s.visible).map(s => (
          <button key={s.id} role="tab" aria-selected={seccion === s.id}
            onClick={() => setSeccion(s.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              seccion === s.id ? 'border-brand text-strong' : 'border-transparent text-muted hover:text-strong'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {seccion === 'resumen' && <Resumen />}
      {seccion === 'historial' && <Historial branchId={branch?.id ?? null} />}
      {seccion === 'config' && <Configuracion company={company} editable={editable} />}
    </div>
  );
};

// ── Resumen ──────────────────────────────────────────────────────────────────
const Resumen: React.FC = () => {
  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [data, setData] = useState<ResumenCalidad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { desde, hasta } = rangoDeFechas(sel);

  useEffect(() => {
    setLoading(true); setError(null);
    fetchResumenCalidad(desde, hasta)
      .then(setData).catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar')).finally(() => setLoading(false));
  }, [desde, hasta]);

  const kpis: Kpi[] = useMemo(() => data ? [
    { id: 'primera', label: 'Aprobado a la primera', valor: data.tasa_aprobacion_primera === null ? '—' : `${data.tasa_aprobacion_primera}%`,
      tono: (data.tasa_aprobacion_primera ?? 100) >= 85 ? 'ok' : 'warn' },
    { id: 'rev', label: 'Vehículos revisados', valor: data.vehiculos_revisados },
    { id: 'rep', label: 'Reprocesos', valor: data.rechazados, tono: data.rechazados > 0 ? 'bad' : undefined,
      hint: data.tasa_reproceso === null ? undefined : `${data.tasa_reproceso}% de las revisiones` },
    { id: 'tot', label: 'Revisiones', valor: data.revisiones }
  ] : [], [data]);

  if (error) return <ErrorState message={error} onRetry={() => setSel({ ...sel })} title="No se pudo cargar el resumen" />;

  return (
    <div className="space-y-5">
      <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
      <RejillaKpi kpis={kpis} cargando={loading || !data} />

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ListaTop titulo="Principales causas de rechazo" filas={data.causas.map(c => [c.motivo, c.veces])}
            vacio="Sin rechazos en el periodo." />
          <ListaTop titulo="Lavadores con más reprocesos" filas={data.lavadores_top.map(l => [l.name, l.reprocesos])}
            vacio="Sin reprocesos en el periodo." />
          <ListaTop titulo="Servicios con más problemas" filas={data.servicios_top.map(s => [s.name, s.veces])}
            vacio="Sin servicios con rechazos." />
        </div>
      )}
    </div>
  );
};

const ListaTop: React.FC<{ titulo: string; filas: [string, number][]; vacio: string }> = ({ titulo, filas, vacio }) => (
  <section className="bg-surface border border-line rounded-2xl p-4 space-y-2">
    <h3 className="text-sm font-bold text-strong">{titulo}</h3>
    {filas.length === 0 ? <p className="text-xs text-faint italic">{vacio}</p> : (
      <ul className="space-y-1.5">
        {filas.map(([nombre, n], i) => (
          <li key={i} className="flex items-center justify-between text-sm">
            <span className="text-body truncate mr-2">{nombre}</span>
            <span className="tabular-nums font-bold text-strong flex-shrink-0">{n}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

// ── Historial ────────────────────────────────────────────────────────────────
const RESULTADOS = [{ id: '', label: 'Todos' }, { id: 'aprobado', label: 'Aprobados' }, { id: 'rechazado', label: 'Rechazados' }];

const Historial: React.FC<{ branchId: string | null }> = ({ branchId }) => {
  const [sel, setSel] = useState<SeleccionFecha>({ preset: 'este_mes' });
  const [washerId, setWasherId] = useState('');
  const [result, setResult] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(0);
  const [washers, setWashers] = useState<Profile[]>([]);
  const [data, setData] = useState<{ total: number; rows: RevisionCalidad[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { desde, hasta } = rangoDeFechas(sel);
  const PAGE = 25;

  useEffect(() => { if (branchId) fetchOperators(branchId).then(setWashers).catch(() => setWashers([])); }, [branchId]);

  const cargar = useCallback(() => {
    setLoading(true); setError(null);
    fetchHistorialCalidad(desde, hasta, washerId || null, result || null, page, PAGE)
      .then(setData).catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar')).finally(() => setLoading(false));
  }, [desde, hasta, washerId, result, page]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPage(0); }, [desde, hasta, washerId, result]);

  // El buscador filtra en cliente sobre la página (orden/placa): es texto libre
  // sobre un conjunto ya acotado por el servidor, no sobre todo el histórico.
  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(r => `${r.order_number} ${r.vehicle_plate}`.toLowerCase().includes(q));
  }, [data.rows, busqueda]);

  if (error) return <ErrorState message={error} onRetry={cargar} title="No se pudo cargar el historial" />;
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE));
  const sel3 = 'bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand';

  return (
    <div className="space-y-4">
      <div className="space-y-3 bg-surface/60 border border-line rounded-2xl p-4">
        <FiltroFechas valor={sel} onCambiar={setSel} disabled={loading} />
        <div className="flex flex-wrap gap-3 items-center">
          <SearchBox id="qc-search" label="Buscar" value={busqueda} onChange={setBusqueda} placeholder="Orden o placa…" />
          <label className="flex items-center gap-1.5 text-xs text-muted">Lavador
            <select className={sel3} value={washerId} onChange={e => setWasherId(e.target.value)}>
              <option value="">Todos</option>
              {washers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
            </select>
          </label>
          <div className="flex gap-1.5">
            {RESULTADOS.map(r => (
              <button key={r.id} onClick={() => setResult(r.id)} aria-pressed={result === r.id}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                  result === r.id ? 'bg-brand text-on-accent border-brand' : 'bg-surface text-muted border-line hover:border-brand'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <TablaDatos
        columnas={[
          { id: 'f', label: 'Fecha', render: (r: RevisionCalidad) => new Date(r.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
          { id: 'ord', label: 'Orden', render: r => <span className="font-bold text-brand-hi">{r.order_number}</span> },
          { id: 'veh', label: 'Vehículo', render: r => <span className="uppercase font-medium">{r.vehicle_plate}</span> },
          { id: 'serv', label: 'Servicio', ocultarEnMovil: true, render: r => r.servicios ?? '—' },
          { id: 'lav', label: 'Lavador', ocultarEnMovil: true, render: r => r.washer ?? '—' },
          { id: 'res', label: 'Resultado', render: r => r.result === 'rechazado'
            ? <span className="text-danger font-bold">Reproceso (int. {r.attempt})</span>
            : <span className="text-success">Aprobado</span> },
          { id: 'mot', label: 'Motivo', render: r => r.reject_reason ?? '—' }
        ]}
        filas={filas} clave={r => r.id} cargando={loading}
        vacio="Sin revisiones en el periodo." etiqueta="Historial de calidad" />
      <Pagination page={page} pageCount={pageCount} total={data.total} pageSize={PAGE} loading={loading} onPage={setPage} />
    </div>
  );
};

// ── Configuración (el checklist de siempre) ──────────────────────────────────
const Configuracion: React.FC<{ company: { id: string } | null; editable: boolean }> = ({ company, editable }) => {
  const [items, setItems] = useState<QcChecklistItem[]>([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchChecklist().then(setItems).catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    if (!company || busy) return;
    if (!label.trim()) { setError('Escriba el punto a revisar.'); return; }
    setBusy(true); setError(null);
    try { await createChecklistItem({ companyId: company.id, label, sortOrder: items.length + 1 }); setLabel(''); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo agregar'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setError(null);
    try { await deleteChecklistItem(id); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo quitar'); }
  };

  return (
    <div className="space-y-4">
      {!editable && <ReadOnlyNotice>Su rol permite consultar el checklist, no editarlo.</ReadOnlyNotice>}
      {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <InlineAlert tone="warning">
        La revisión se hace en <strong>Operaciones → Cola</strong>: la tarjeta que llega a control
        de calidad ofrece «Revisar calidad…». Aprobarla deja la orden lista; rechazarla la
        devuelve a lavado como reproceso, con el motivo visible para el operario.
      </InlineAlert>

      <section className="bg-surface/80 border border-line rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand" /> Puntos de revisión
        </h3>
        {loading ? <div className="h-24 bg-surface-2/60 rounded-xl animate-pulse" />
          : items.length === 0 ? (
            <p className="text-sm text-faint italic text-center py-4">
              Todavía no hay puntos configurados. Sin ellos se puede aprobar o rechazar, pero no queda constancia de qué se revisó.
            </p>
          ) : (
            <ol className="space-y-2">
              {items.map((i, idx) => (
                <li key={i.id} className="flex items-center gap-3 bg-canvas/60 border border-line rounded-xl p-3">
                  <span className="w-6 h-6 rounded-lg bg-surface-2 text-muted text-xs font-bold grid place-items-center flex-shrink-0">{idx + 1}</span>
                  <span className="flex-1 text-sm font-medium text-strong">{i.label}</span>
                  {editable && (
                    <Button variant="ghost" size="icon-sm" className="text-faint hover:text-danger" onClick={() => void remove(i.id)} aria-label={`Quitar ${i.label}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
            <Button onClick={() => void add()} disabled={busy || !label.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Agregar punto
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};
