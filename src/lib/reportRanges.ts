/**
 * CAPA DE COMPATIBILIDAD. La implementación vive en rangosFecha.ts.
 *
 * Este módulo tenía el bug de «Hoy es mañana a partir de las 20:00» (fechas
 * locales serializadas con toISOString, que es UTC). Se conserva solo la API
 * vieja —RangeId, RANGES, rangeDates— apoyada en la implementación nueva, para
 * no tocar a la vez a todos sus consumidores. Vista que se moderniza, vista
 * que pasa a importar rangosFecha directamente; cuando no quede ninguno, este
 * archivo se borra.
 */
import { rangoDeFechas, type PresetFecha } from './rangosFecha';

export type RangeId = 'today' | 'week' | 'month' | 'prev_month';

export const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'prev_month', label: 'Mes anterior' }
];

const EQUIVALENCIA: Record<RangeId, PresetFecha> = {
  today: 'hoy', week: '7dias', month: 'este_mes', prev_month: 'mes_anterior'
};

export function rangeDates(id: RangeId): { from: string; to: string } {
  const r = rangoDeFechas({ preset: EQUIVALENCIA[id] });
  return { from: r.desde, to: r.hasta };
}
