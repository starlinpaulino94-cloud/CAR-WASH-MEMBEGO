import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Target, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents, bpsToPercent } from '../../lib/money';
import {
  fetchRendimientoLavadores, upsertMetaLavador, RendimientoLavador
} from '../../data/payrollRepository';
import { ViewHeader, InlineAlert } from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

/**
 * COMISIONES Y METAS — lo que cada lavador produce contra lo que cuesta.
 *
 * La pregunta del dueño es una sola: «este lavador, ¿cuánto me genera y cuánto
 * me cuesta?». Por eso las dos cifras van en la MISMA fila y con su relación
 * calculada al lado; en dos pantallas separadas habría que hacer la división
 * mentalmente, y entonces nadie la hace.
 *
 * El periodo por defecto es la quincena en curso, que es como se paga aquí.
 */

/** Primer o segundo tramo del mes: del 1 al 15, o del 16 al final. */
function quincenaActual(): { desde: string; hasta: string } {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const primera = hoy.getDate() <= 15;
  const desde = new Date(y, m, primera ? 1 : 16);
  const hasta = primera ? new Date(y, m, 15) : new Date(y, m + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { desde: iso(desde), hasta: iso(hasta) };
}

/** Cuánto se lleva del objetivo, acotado a 100 para no pintar barras absurdas. */
const avance = (hecho: number, meta: number | null) =>
  meta && meta > 0 ? Math.min(100, Math.round((hecho / meta) * 100)) : null;

const BarraMeta: React.FC<{ pct: number | null; texto: string }> = ({ pct, texto }) => {
  if (pct === null) return <span className="text-faint text-xs">Sin meta</span>;
  return (
    <div className="space-y-1 min-w-[7rem]">
      <div className="flex justify-between text-xs">
        <span className={pct >= 100 ? 'text-success font-bold' : 'text-body'}>{texto}</span>
        <span className={pct >= 100 ? 'text-success font-bold' : 'text-muted'}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-success' : 'bg-brand'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const CommissionsSupabaseView: React.FC = () => {
  const { profile, company } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const puedeFijarMetas = can(profile, 'manageStaff');

  const inicial = useMemo(quincenaActual, []);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [filas, setFilas] = useState<RendimientoLavador[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFilas(await fetchRendimientoLavadores(desde, hasta));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el rendimiento');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  // --- Fijar meta
  const [metaTarget, setMetaTarget] = useState<RendimientoLavador | null>(null);
  const [metaLavados, setMetaLavados] = useState('');
  const [metaMonto, setMetaMonto] = useState('');
  const [busy, setBusy] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const abrirMeta = (f: RendimientoLavador) => {
    setMetaTarget(f);
    setMetaLavados(f.meta_lavados ? String(f.meta_lavados) : '');
    setMetaMonto(f.meta_generado_cents ? String(f.meta_generado_cents / 100) : '');
    setMetaError(null);
  };

  const guardarMeta = async () => {
    if (!metaTarget || busy) return;
    const lavados = metaLavados.trim() ? Number(metaLavados) : null;
    if (lavados !== null && (!Number.isFinite(lavados) || lavados < 0)) {
      setMetaError('La meta de lavados debe ser un número.'); return;
    }
    setBusy(true); setMetaError(null);
    try {
      await upsertMetaLavador({
        profileId: metaTarget.profile_id,
        desde, hasta,
        metaLavados: lavados,
        metaGeneradoCents: parseAmountToCents(metaMonto)
      });
      setNotice(`Meta de ${metaTarget.full_name} guardada para este periodo.`);
      setMetaTarget(null);
      await cargar();
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'No se pudo guardar la meta');
    } finally {
      setBusy(false);
    }
  };

  const totales = filas.reduce(
    (acc, f) => ({
      lavados: acc.lavados + f.lavados,
      generado: acc.generado + f.generado_cents,
      comision: acc.comision + f.comision_cents
    }),
    { lavados: 0, generado: 0, comision: 0 }
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <ViewHeader
        title="Comisiones y metas"
        subtitle="Lo que cada lavador genera para el negocio, lo que se lleva, y su meta del periodo"
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <section className="bg-surface border border-line rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="com-desde" className="text-xs font-semibold text-muted uppercase">Desde</label>
          <input id="com-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className={textInputClass} />
        </div>
        <div className="space-y-1">
          <label htmlFor="com-hasta" className="text-xs font-semibold text-muted uppercase">Hasta</label>
          <input id="com-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className={textInputClass} />
        </div>
        <Button size="sm" variant="secondary" onClick={() => void cargar()} disabled={loading}>
          <RefreshCw className="w-4 h-4" /> Actualizar
        </Button>
        <p className="text-xs text-faint basis-full sm:basis-auto sm:ml-auto">
          Cuenta las órdenes <strong>entregadas</strong> en el periodo.
        </p>
      </section>

      {/* Los tres números del periodo, arriba: lo que entró, lo que se paga, y
          qué parte es lo segundo de lo primero. */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface border border-line rounded-2xl p-4">
          <div className="text-xs text-muted uppercase font-semibold">Lavados</div>
          <div className="text-2xl font-black text-strong">{totales.lavados}</div>
        </div>
        <div className="bg-surface border border-line rounded-2xl p-4">
          <div className="text-xs text-muted uppercase font-semibold">Generado</div>
          <div className="text-2xl font-black text-strong">{formatCents(totales.generado, symbol)}</div>
        </div>
        <div className="bg-surface border border-line rounded-2xl p-4">
          <div className="text-xs text-muted uppercase font-semibold">Comisiones</div>
          <div className="text-2xl font-black text-warning">{formatCents(totales.comision, symbol)}</div>
          <div className="text-xs text-faint">
            {totales.generado > 0
              ? `${bpsToPercent(Math.round((totales.comision / totales.generado) * 10000))} de lo generado`
              : '—'}
          </div>
        </div>
      </section>

      <section className="bg-surface border border-line rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted" aria-busy="true">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="p-8 text-center text-xs text-faint">
            No hay lavadores con actividad ni metas en este periodo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="p-3 text-left">Lavador</TableHead>
                  <TableHead className="p-3 text-right">Lavados</TableHead>
                  <TableHead className="p-3 text-right">Generado</TableHead>
                  <TableHead className="p-3 text-right">Comisión</TableHead>
                  <TableHead className="p-3 text-right">Le cuesta</TableHead>
                  <TableHead className="p-3 text-left">Meta lavados</TableHead>
                  <TableHead className="p-3 text-left">Meta generado</TableHead>
                  {puedeFijarMetas && <TableHead className="p-3" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map(f => (
                  <TableRow key={f.profile_id} className="hover:bg-surface-2/40 transition-colors">
                    <TableCell className="p-3 font-bold text-strong">{f.full_name}</TableCell>
                    <TableCell className="p-3 text-right text-body">{f.lavados}</TableCell>
                    <TableCell className="p-3 text-right font-bold text-body whitespace-nowrap">
                      {formatCents(f.generado_cents, symbol)}
                    </TableCell>
                    <TableCell className="p-3 text-right text-warning whitespace-nowrap">
                      {formatCents(f.comision_cents, symbol)}
                      {f.comision_pagada_cents > 0 && (
                        <span className="block text-xs text-faint">
                          {formatCents(f.comision_pagada_cents, symbol)} pagada
                        </span>
                      )}
                    </TableCell>
                    {/* La cifra que responde «¿me conviene esta tarifa?». */}
                    <TableCell className="p-3 text-right text-muted whitespace-nowrap">
                      {f.generado_cents > 0 ? bpsToPercent(f.costo_bps) : '—'}
                    </TableCell>
                    <TableCell className="p-3">
                      <BarraMeta pct={avance(f.lavados, f.meta_lavados)}
                        texto={f.meta_lavados ? `${f.lavados} / ${f.meta_lavados}` : ''} />
                    </TableCell>
                    <TableCell className="p-3">
                      <BarraMeta pct={avance(f.generado_cents, f.meta_generado_cents)}
                        texto={f.meta_generado_cents
                          ? `${formatCents(f.generado_cents, symbol)} / ${formatCents(f.meta_generado_cents, symbol)}`
                          : ''} />
                    </TableCell>
                    {puedeFijarMetas && (
                      <TableCell className="p-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => abrirMeta(f)}>
                          <Target className="w-4 h-4" /> Meta
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <p className="text-xs text-faint flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>
          «Generado» son los <strong>servicios</strong> de sus lavados, no los productos
          que el cliente compró en caja. Cuando varios comparten un carro, se reparte
          entre ellos: así la suma del equipo cuadra con lo que facturó el negocio.
        </span>
      </p>

      {metaTarget && (
        <FormModal
          title={`Meta — ${metaTarget.full_name}`}
          submitLabel="Guardar meta"
          busy={busy}
          error={metaError}
          onSubmit={() => void guardarMeta()}
          onClose={() => setMetaTarget(null)}
          onDismissError={() => setMetaError(null)}
        >
          <p className="text-xs text-muted">
            Para el periodo <strong>{desde}</strong> a <strong>{hasta}</strong>. Si ya tenía
            una meta en estas fechas, se reemplaza.
          </p>
          <Field label="Meta de lavados" htmlFor="meta-lav" hint="Déjalo vacío si no aplica.">
            <input id="meta-lav" className={textInputClass} value={metaLavados}
              inputMode="numeric" onChange={e => setMetaLavados(e.target.value)} />
          </Field>
          <Field label="Meta de dinero generado" htmlFor="meta-monto"
            hint="Lo que el negocio factura por sus lavados. Déjalo vacío si no aplica.">
            <input id="meta-monto" className={textInputClass} value={metaMonto}
              inputMode="decimal" onChange={e => setMetaMonto(e.target.value)} />
          </Field>
        </FormModal>
      )}
    </div>
  );
};
