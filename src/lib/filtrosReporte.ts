/**
 * Los filtros de los reportes gerenciales y su normalización.
 *
 * Vive en lib (sin dependencias de Supabase) para poder probarse solo: la
 * regla de que un filtro vacío no viaje es lógica de negocio —la RPC trata cada
 * clave presente como un filtro— y merece pruebas deterministas.
 */

export interface FiltrosReporte {
  branch_id?: string;
  cashier_id?: string;
  washer_id?: string;
  service_id?: string;
  service_category?: string;
  payment_method?: string;
  status?: 'vigente' | 'anulada' | 'todas';
}

/**
 * Solo viaja lo que tiene valor. Mandar `washer_id: ''` acotaría a un lavador
 * sin id y devolvería cero: una pantalla llena de filtros opcionales manda solo
 * los que el usuario eligió.
 */
export function limpiarFiltros(f: FiltrosReporte): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = v;
  return out;
}
