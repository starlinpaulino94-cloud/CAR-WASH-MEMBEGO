/**
 * Reporte de errores del frontend (OBS-001).
 *
 * La auditoría marcó «cero observabilidad»: el ErrorBoundary solo hacía
 * `console.error`, que muere en el dispositivo del cajero. Esto no cambia eso a
 * la fuerza —no se añade el SDK de Sentry ni una dependencia pesada— pero deja
 * el enganche listo y estructurado:
 *
 *   · Siempre: una línea JSON en consola, filtrable y con contexto.
 *   · Si `VITE_ERROR_REPORT_URL` está definida: además se envía ahí (best-effort,
 *     sin bloquear ni volver a lanzar). Ese es el punto donde se conecta Sentry,
 *     Logtail o un endpoint propio el día que se decida el destino.
 *
 * Nunca se manda información sensible: ni tokens, ni datos del cliente. Solo el
 * mensaje del error, dónde ocurrió y un id de correlación.
 */

const DESTINO = import.meta.env.VITE_ERROR_REPORT_URL as string | undefined;

export interface ContextoError {
  /** Dónde ocurrió: 'ErrorBoundary', 'window.onerror', 'unhandledrejection'… */
  origen: string;
  /** Pista extra no sensible (nombre de la vista, componentStack recortado). */
  detalle?: string;
}

function idCorrelacion(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `err-${Date.now().toString(36)}`;
  }
}

/**
 * Registra un error de forma estructurada y, si hay destino configurado, lo
 * reenvía. Nunca lanza: un fallo del propio reporte no puede tumbar la app.
 */
export function reportarError(error: unknown, contexto: ContextoError): void {
  const evento = {
    t: new Date().toISOString(),
    correlacion: idCorrelacion(),
    origen: contexto.origen,
    mensaje: error instanceof Error ? error.message : String(error),
    detalle: contexto.detalle,
  };

  // Siempre a consola, estructurado.
  console.error('[obs]', JSON.stringify(evento));

  // Y al destino, si lo hay. `keepalive` para que sobreviva a un unload.
  if (DESTINO) {
    try {
      void fetch(DESTINO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evento),
        keepalive: true,
      }).catch(() => {
        /* best-effort: si el destino no responde, ya quedó en consola */
      });
    } catch {
      /* fetch puede lanzar de forma síncrona en contextos raros; se ignora */
    }
  }
}

/**
 * Engancha los errores globales que el ErrorBoundary de React NO ve: promesas
 * rechazadas sin catch y errores fuera del árbol de render. Se llama una vez al
 * arrancar la app.
 */
export function engancharErroresGlobales(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('unhandledrejection', (e) => {
    reportarError(e.reason, { origen: 'unhandledrejection' });
  });
  window.addEventListener('error', (e) => {
    reportarError(e.error ?? e.message, { origen: 'window.onerror' });
  });
}
