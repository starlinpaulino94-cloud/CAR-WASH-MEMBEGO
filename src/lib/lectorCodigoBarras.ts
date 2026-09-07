/**
 * LECTOR DE CÓDIGO DE BARRAS · el reconocedor de ráfagas.
 *
 * Un lector USB/Bluetooth no es un dispositivo especial para el navegador: se
 * presenta como un TECLADO. Escanear una etiqueta es, para la página, alguien
 * tecleando trece dígitos y pulsando Enter. No hay evento propio que escuchar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SEPARA AL LECTOR DEL CAJERO ES LA VELOCIDAD
 *
 * Un lector emite las teclas cada 5–20 ms; una persona, por rápida que escriba,
 * no baja de ~80 ms sostenidos. Esa distancia es la única señal fiable, y es en
 * la que se apoya todo esto: las teclas que llegan pegadas forman una ráfaga y
 * las que llegan sueltas la rompen. Por eso `pausaMaxMs` no es un ajuste fino
 * sino el corazón del asunto — subirlo mucho convierte el tecleo humano en
 * escaneos fantasma.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES PURO Y NO UN useEffect
 *
 * La lógica vive aquí, sin DOM y sin React, para poder probar con relojes
 * falsos lo que en una pantalla real haría falta un lector físico y un pulso
 * muy firme para reproducir: la ráfaga a 10 ms, el humano a 200 ms, y el caso
 * traicionero de las dos mezcladas. El hook solo le pasa teclas y un reloj.
 */

export interface EstadoLector {
  /** Lo acumulado de la ráfaga en curso. */
  buffer: string;
  /** Cuándo llegó la última tecla, para medir la pausa siguiente. */
  ultimoMs: number;
}

export const ESTADO_INICIAL: EstadoLector = { buffer: '', ultimoMs: 0 };

export interface OpcionesLector {
  /**
   * Pausa máxima entre teclas para seguir siendo la MISMA ráfaga. Por encima,
   * se asume que teclea una persona y el buffer se reinicia.
   */
  pausaMaxMs?: number;
  /** Longitud mínima para aceptar un código. Evita que "12" dispare una venta. */
  minLongitud?: number;
}

const PAUSA_MAX_MS = 120;
const MIN_LONGITUD = 6;

export interface ResultadoTecla {
  estado: EstadoLector;
  /** El código completo, solo cuando la ráfaga terminó bien. */
  codigo?: string;
  /** true → la tecla era del lector y NO debe llegar a la pantalla. */
  consumir: boolean;
}

/**
 * Procesa una tecla y dice si con ella se completó un código.
 *
 * `Enter` y `Tab` son los sufijos que traen configurados de fábrica casi todos
 * los lectores; se aceptan los dos para no obligar a reconfigurar el aparato.
 */
export function procesarTecla(
  estado: EstadoLector,
  tecla: string,
  ahoraMs: number,
  opciones: OpcionesLector = {}
): ResultadoTecla {
  const pausaMax = opciones.pausaMaxMs ?? PAUSA_MAX_MS;
  const minLongitud = opciones.minLongitud ?? MIN_LONGITUD;

  // ¿Esta tecla sigue la ráfaga anterior, o empieza una nueva?
  const continua = estado.buffer !== '' && ahoraMs - estado.ultimoMs <= pausaMax;

  if (tecla === 'Enter' || tecla === 'Tab') {
    // El sufijo solo cierra la ráfaga si venía pegado. Un Enter suelto es el
    // cajero confirmando un formulario y no puede robarse esa pulsación.
    if (continua && estado.buffer.length >= minLongitud) {
      return { estado: ESTADO_INICIAL, codigo: estado.buffer, consumir: true };
    }
    return { estado: ESTADO_INICIAL, consumir: false };
  }

  // Solo caracteres imprimibles: 'Shift', 'ArrowLeft' y compañía no rompen la
  // ráfaga (el lector manda Shift para los símbolos) pero tampoco suman.
  if (tecla.length === 1) {
    return {
      estado: { buffer: continua ? estado.buffer + tecla : tecla, ultimoMs: ahoraMs },
      consumir: false,
    };
  }

  return { estado, consumir: false };
}

/**
 * El código de una ráfaga que se quedó sin sufijo.
 *
 * Algunos lectores salen de fábrica sin Enter. Sin esto habría que abrir el
 * manual y reprogramar el aparato para que el mostrador funcione, así que
 * pasado un silencio se da la ráfaga por terminada. El silencio es largo
 * comparado con los 5–20 ms del lector: si algo llega después, ya era otra cosa.
 */
export function codigoPorInactividad(
  estado: EstadoLector,
  ahoraMs: number,
  opciones: OpcionesLector = {}
): string | null {
  const minLongitud = opciones.minLongitud ?? MIN_LONGITUD;
  const pausaMax = opciones.pausaMaxMs ?? PAUSA_MAX_MS;
  if (estado.buffer.length < minLongitud) return null;
  return ahoraMs - estado.ultimoMs > pausaMax ? estado.buffer : null;
}
