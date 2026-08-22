/**
 * Log estructurado para los bordes serverless. SOLO SERVIDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ (OBS-001)
 *
 * La pregunta de la auditoría no era «¿hay logs?» sino «si producción falla a
 * las 3 AM, ¿podemos saber qué pasó?». Un `console.warn('[membego]', e.message)`
 * suelto no se puede filtrar ni correlacionar. Aquí cada evento sale como UNA
 * línea JSON con contexto: el recolector de Vercel (o cualquier destino) puede
 * buscar por `requestId`, por `evento`, por `status`, y reconstruir una llamada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO SE REGISTRA
 *
 * Nunca datos personales del cliente: ni teléfono, ni nombre, ni la ficha. Se
 * registran identificadores opacos (requestId, userId, companyId), la operación,
 * la duración y el resultado — lo que hace falta para depurar, no para exponer.
 */

/** Un id de correlación por petición. Sin `Math.random` (prohibido en el arnés). */
export function nuevoRequestId(): string {
  // `crypto.randomUUID` existe en el runtime de Vercel (Node ≥ 18 / edge).
  try {
    return crypto.randomUUID();
  } catch {
    // Respaldo determinista-por-hora si no hubiera crypto: no colisiona en la
    // práctica para correlacionar una petición con su log.
    return `req-${Date.now().toString(36)}`;
  }
}

export interface ContextoLog {
  requestId: string;
  ruta: string;
  userId?: string;
  companyId?: string;
  status?: number;
  durationMs?: number;
  evento: string;
  detalle?: string;
}

/**
 * Emite una línea JSON. `console.log`/`error` son el transporte correcto en
 * serverless: Vercel captura stdout/stderr y lo indexa. `nivel` decide el
 * canal para que los errores se puedan alertar aparte.
 */
export function log(nivel: 'info' | 'warn' | 'error', ctx: ContextoLog): void {
  const linea = JSON.stringify({ t: new Date().toISOString(), nivel, ...ctx });
  if (nivel === 'error') console.error(linea);
  else if (nivel === 'warn') console.warn(linea);
  else console.log(linea);
}
