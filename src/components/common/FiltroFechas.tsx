import React from 'react';
import {
  SeleccionFecha, PRESETS_RAPIDOS, PRESETS_LIBRES, describirRango
} from '../../lib/rangosFecha';

/**
 * El filtro de fechas de toda pantalla administrativa.
 *
 * Un solo componente para lo que hoy son tres implementaciones distintas y
 * ocho pares de <input type="date"> maquetados a mano: cinco atajos (hoy,
 * ayer, 7 días, este mes, mes anterior) y cuatro formas libres (fecha exacta,
 * rango, mes, año). Emite una SeleccionFecha; el rango real lo calcula
 * rangosFecha.ts, que es donde viven las pruebas con reloj fijo.
 *
 * El resumen del periodo se enseña siempre («01/09/2026 – 10/09/2026»):
 * es lo que confirma al que filtra que el universo es el que cree, y es el
 * mismo texto que sale en la cabecera al imprimir.
 */
export const FiltroFechas: React.FC<{
  valor: SeleccionFecha;
  onCambiar: (sel: SeleccionFecha) => void;
  disabled?: boolean;
}> = ({ valor, onCambiar, disabled }) => {
  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
      activo ? 'bg-brand text-on-accent border-brand'
             : 'bg-surface border-line text-body hover:border-brand'
    }`;
  const input =
    'bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand disabled:opacity-50';

  const anioActual = new Date().getFullYear();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Periodo">
        {PRESETS_RAPIDOS.map(p => (
          <button key={p.id} type="button" disabled={disabled} aria-pressed={valor.preset === p.id}
            onClick={() => onCambiar({ preset: p.id })} className={chip(valor.preset === p.id)}>
            {p.label}
          </button>
        ))}
        <span aria-hidden="true" className="w-px h-5 bg-line mx-1" />
        {PRESETS_LIBRES.map(p => (
          <button key={p.id} type="button" disabled={disabled} aria-pressed={valor.preset === p.id}
            onClick={() => onCambiar({ ...valor, preset: p.id })} className={chip(valor.preset === p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {(valor.preset === 'fecha' || valor.preset === 'rango' || valor.preset === 'mes' || valor.preset === 'anio') && (
        <div className="flex flex-wrap items-center gap-2">
          {valor.preset === 'fecha' && (
            <input type="date" className={input} disabled={disabled}
              aria-label="Fecha exacta"
              value={valor.desde ?? ''}
              onChange={e => onCambiar({ preset: 'fecha', desde: e.target.value })} />
          )}
          {valor.preset === 'rango' && (
            <>
              <label className="text-xs text-muted" htmlFor="ff-desde">Desde</label>
              <input id="ff-desde" type="date" className={input} disabled={disabled}
                value={valor.desde ?? ''}
                onChange={e => onCambiar({ ...valor, preset: 'rango', desde: e.target.value })} />
              <label className="text-xs text-muted" htmlFor="ff-hasta">Hasta</label>
              <input id="ff-hasta" type="date" className={input} disabled={disabled}
                value={valor.hasta ?? ''}
                onChange={e => onCambiar({ ...valor, preset: 'rango', hasta: e.target.value })} />
            </>
          )}
          {valor.preset === 'mes' && (
            <input type="month" className={input} disabled={disabled}
              aria-label="Mes"
              value={valor.mes ?? ''}
              onChange={e => onCambiar({ preset: 'mes', mes: e.target.value })} />
          )}
          {valor.preset === 'anio' && (
            <select className={input} disabled={disabled} aria-label="Año"
              value={valor.anio ?? anioActual}
              onChange={e => onCambiar({ preset: 'anio', anio: Number(e.target.value) })}>
              {Array.from({ length: 6 }).map((_, i) => {
                const y = anioActual - i;
                return <option key={y} value={y}>{y}</option>;
              })}
            </select>
          )}
        </div>
      )}

      <p className="text-xs text-faint" aria-live="polite">
        Periodo: <strong className="text-muted">{describirRango(valor)}</strong>
      </p>
    </div>
  );
};
