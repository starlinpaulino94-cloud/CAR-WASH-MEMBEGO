import { requireSupabase } from '../lib/supabase';

/**
 * Importación y exportación masiva.
 *
 * La importación NO se hace desde aquí fila por fila: eso serían trescientas
 * peticiones, trescientas oportunidades de quedarse a medias y ninguna forma de
 * previsualizar. Se manda el lote entero a `import_batch` (migración 0035), que
 * lo procesa en una transacción y —si no se pide aplicar— lo revierte y devuelve
 * qué habría pasado. Las reglas de duplicados y de formato viven ahí, no aquí:
 * la pantalla no puede ser la que decide si dos clientes son el mismo.
 *
 * La exportación sí es cosa del cliente, pero recorriendo el servidor por
 * páginas: traerse cien mil facturas de una vez tumba el navegador.
 */

export type ImportEntity =
  | 'clientes' | 'vehiculos' | 'servicios' | 'productos' | 'proveedores' | 'promociones';

export interface ImportRowResult {
  fila: number;
  accion: 'crear' | 'actualizar' | 'omitir' | 'error';
  clave: string | null;
  nota: string | null;
}

export interface ImportResult {
  entidad: ImportEntity;
  aplicado: boolean;
  filas: number;
  resumen: { crear: number; actualizar: number; omitir: number; error: number };
  detalle: ImportRowResult[];
}

/**
 * Manda el lote. Con `apply = false` es un ensayo: el servidor hace el trabajo
 * completo y lo deshace, así que lo que informa es exactamente lo que pasará al
 * aplicarlo, no una estimación de otra rama de código.
 */
export async function importBatch(
  entity: ImportEntity,
  rows: Record<string, string>[],
  apply: boolean
): Promise<ImportResult> {
  const { data, error } = await requireSupabase().rpc('import_batch', {
    p_entity: entity,
    p_rows: rows,
    p_apply: apply
  });
  if (error) throw error;
  return data as unknown as ImportResult;
}

/** Tope del servidor. Se comprueba antes de mandar para dar un error claro. */
export const MAX_IMPORT_ROWS = 2000;

// ------------------------------------------------------------- Exportación

/** Cuántas filas se piden por vuelta. */
const CHUNK = 500;

/**
 * Trae una tabla entera respetando RLS y paginando. Se corta en `hardLimit`
 * para que un descuido no intente materializar el histórico completo en
 * memoria; si se alcanza, quien llama lo advierte al usuario.
 */
export async function fetchAllRows<T>(
  table: string,
  select: string,
  order: { column: string; ascending?: boolean },
  hardLimit = 20000
): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = [];
  for (let from = 0; from < hardLimit; from += CHUNK) {
    const { data, error } = await requireSupabase()
      .from(table)
      .select(select)
      .order(order.column, { ascending: order.ascending ?? false })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as T[];
    out.push(...batch);
    if (batch.length < CHUNK) return { rows: out, truncated: false };
  }
  return { rows: out, truncated: true };
}
