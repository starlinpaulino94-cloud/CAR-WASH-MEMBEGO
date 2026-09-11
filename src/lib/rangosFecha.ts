/**
 * Rangos de fecha de toda la aplicación.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (y por qué sustituye a reportRanges.ts)
 *
 * Había TRES implementaciones de rangos —reportRanges.ts, una copia local en
 * Auditoría y la quincena de Comisiones— y la principal tenía un error grave:
 * construía las fechas en hora local y las serializaba con toISOString(), que
 * es UTC. En República Dominicana (UTC−4), a partir de las 20:00 el día UTC ya
 * es mañana: el dueño que miraba «Hoy» a las 9 de la noche veía las ventas de
 * un día que no había empezado — es decir, CERO. Reproducido con reloj fijo
 * antes de escribir esto.
 *
 * La regla de este módulo: las fechas se arman SIEMPRE con los componentes
 * locales (getFullYear/getMonth/getDate). toISOString() está prohibido aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES UN RANGO
 *
 * Un par {desde, hasta} de fechas YYYY-MM-DD, ambas inclusive, en el día
 * OPERATIVO del negocio. El servidor es quien convierte esos días a instantes
 * usando la zona horaria de la empresa; este módulo no toca zonas.
 *
 * Todas las funciones aceptan `hoy` como parámetro para poder probarse con
 * reloj fijo. En producción se omite y vale el reloj real.
 */

export type PresetFecha =
  | 'hoy' | 'ayer' | '7dias' | 'este_mes' | 'mes_anterior'
  | 'fecha'      // un día concreto
  | 'rango'      // desde–hasta libres
  | 'mes'        // un mes concreto (YYYY-MM)
  | 'anio';      // un año concreto

export interface SeleccionFecha {
  preset: PresetFecha;
  /** Para 'fecha' (se usa como día único) y para 'rango'. */
  desde?: string;
  hasta?: string;
  /** Para 'mes': 'YYYY-MM'. */
  mes?: string;
  /** Para 'anio'. */
  anio?: number;
}

export interface RangoFechas { desde: string; hasta: string }

export const PRESETS_RAPIDOS: { id: PresetFecha; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: '7dias', label: 'Últimos 7 días' },
  { id: 'este_mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' }
];

export const PRESETS_LIBRES: { id: PresetFecha; label: string }[] = [
  { id: 'fecha', label: 'Fecha exacta' },
  { id: 'rango', label: 'Rango' },
  { id: 'mes', label: 'Mes' },
  { id: 'anio', label: 'Año' }
];

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD con los componentes LOCALES. Nunca toISOString: eso es UTC. */
export const ymdLocal = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const dia = (base: Date, delta: number): Date => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + delta);
  return d;
};

/**
 * El {desde, hasta} de una selección. Para los presets libres sin datos aún
 * (el usuario acaba de cambiar a «Rango» y no eligió fechas) devuelve el día
 * de hoy: una pantalla nunca se queda sin universo mientras se decide.
 */
export function rangoDeFechas(sel: SeleccionFecha, hoy: Date = new Date()): RangoFechas {
  const hoyStr = ymdLocal(hoy);
  switch (sel.preset) {
    case 'hoy':
      return { desde: hoyStr, hasta: hoyStr };
    case 'ayer': {
      const a = ymdLocal(dia(hoy, -1));
      return { desde: a, hasta: a };
    }
    case '7dias':
      return { desde: ymdLocal(dia(hoy, -6)), hasta: hoyStr };
    case 'este_mes':
      return { desde: ymdLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: hoyStr };
    case 'mes_anterior':
      return {
        desde: ymdLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
        hasta: ymdLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 0))
      };
    case 'fecha': {
      const f = sel.desde || hoyStr;
      return { desde: f, hasta: f };
    }
    case 'rango': {
      const desde = sel.desde || hoyStr;
      const hasta = sel.hasta || desde;
      // Un rango al revés no revienta: se endereza. Equivocarse eligiendo no
      // puede dejar la pantalla en un estado sin datos e inexplicable.
      return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
    }
    case 'mes': {
      const [y, m] = (sel.mes || `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}`)
        .split('-').map(Number);
      return {
        desde: ymdLocal(new Date(y, (m || 1) - 1, 1)),
        hasta: ymdLocal(new Date(y, m || 1, 0))
      };
    }
    case 'anio': {
      const y = sel.anio ?? hoy.getFullYear();
      return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
    }
  }
}

const DMA = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * El periodo en palabras, para cabeceras de pantalla y de impresión.
 * «Hoy, 11/09/2026» dice más que dos fechas iguales.
 */
export function describirRango(sel: SeleccionFecha, hoy: Date = new Date()): string {
  const r = rangoDeFechas(sel, hoy);
  const preset = [...PRESETS_RAPIDOS, ...PRESETS_LIBRES].find(p => p.id === sel.preset);
  if (r.desde === r.hasta) {
    const nombre = sel.preset === 'hoy' || sel.preset === 'ayer' ? `${preset?.label}, ` : '';
    return `${nombre}${DMA(r.desde)}`;
  }
  return `${DMA(r.desde)} – ${DMA(r.hasta)}`;
}
