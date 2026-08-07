/** Rangos de fecha de los reportes gerenciales. */
export type RangeId = 'today' | 'week' | 'month' | 'prev_month';

export const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'prev_month', label: 'Mes anterior' }
];

export function rangeDates(id: RangeId): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (id === 'today') return { from: iso(now), to: iso(now) };
  if (id === 'week') {
    const from = new Date(now); from.setDate(now.getDate() - 6);
    return { from: iso(from), to: iso(now) };
  }
  if (id === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: iso(first), to: iso(last) };
}
