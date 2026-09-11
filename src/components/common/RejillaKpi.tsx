import React from 'react';
import { formatCents } from '../../lib/money';

/**
 * La fila de indicadores de una pantalla administrativa.
 *
 * Tres cosas que StatCard no hacía y que se repetían a mano en diez vistas:
 * formatear (centavos o número: aquí se pasa el NÚMERO, no el texto),
 * el esqueleto de carga (antes la fila simplemente no aparecía y la pantalla
 * saltaba), y el drill-down: un KPI con onClick es un botón que lleva a los
 * registros que forman ese número. Un KPI sin drill-down es un rótulo; el
 * principio de esta fase es que cada número pueda explicarse.
 */
export interface Kpi {
  id: string;
  label: string;
  /** Centavos si `moneda`; número si no; texto ya formateado si es string. */
  valor: number | string | null | undefined;
  moneda?: boolean;
  hint?: string;
  tono?: 'ok' | 'warn' | 'bad' | 'brand';
  /** Abre el detalle que forma este número. */
  onClick?: () => void;
}

const TONO: Record<NonNullable<Kpi['tono']>, string> = {
  ok: 'text-success', warn: 'text-warning', bad: 'text-danger', brand: 'text-brand-hi'
};

export const RejillaKpi: React.FC<{
  kpis: Kpi[];
  cargando?: boolean;
  symbol?: string;
}> = ({ kpis, cargando, symbol = 'RD$' }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="group" aria-label="Indicadores">
    {cargando
      ? Array.from({ length: Math.max(kpis.length, 4) }).map((_, i) => (
          <div key={i} aria-hidden="true"
            className="bg-surface border border-line rounded-2xl p-4 space-y-2 animate-pulse">
            <div className="h-3 w-2/3 bg-surface-2 rounded" />
            <div className="h-6 w-1/2 bg-surface-2 rounded" />
          </div>
        ))
      : kpis.map(k => {
          const texto = k.valor == null
            ? '—'
            : typeof k.valor === 'string'
              ? k.valor
              : k.moneda ? formatCents(k.valor, symbol) : String(k.valor);
          const cuerpo = (
            <>
              <p className="text-xs text-muted">{k.label}</p>
              <p className={`text-xl font-black tabular-nums ${k.tono ? TONO[k.tono] : 'text-strong'}`}>
                {texto}
              </p>
              {k.hint && <p className="text-xs text-faint">{k.hint}</p>}
            </>
          );
          return k.onClick ? (
            <button key={k.id} type="button" onClick={k.onClick}
              title="Ver el detalle que forma este número"
              className="bg-surface border border-line rounded-2xl p-4 text-left space-y-1 hover:border-brand transition-colors">
              {cuerpo}
            </button>
          ) : (
            <div key={k.id} className="bg-surface border border-line rounded-2xl p-4 space-y-1">
              {cuerpo}
            </div>
          );
        })}
  </div>
);
