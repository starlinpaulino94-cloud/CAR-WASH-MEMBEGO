/**
 * Capa de acceso a localStorage tolerante a fallos.
 *
 * Sustituye a los `JSON.parse(localStorage.getItem(...))` sueltos que había en
 * AppContext, que podían lanzar durante el primer render y dejar la aplicación
 * en pantalla en blanco permanente, y a los `setItem` sin protección, que
 * fallaban en silencio al agotarse la cuota mientras el cajero seguía cobrando.
 *
 * Garantías:
 *  - Ninguna función de este módulo lanza. Todas devuelven un resultado.
 *  - Un valor ilegible o con forma inesperada se pone en cuarentena (se renombra,
 *    no se borra) para que pueda recuperarse manualmente, y se continúa con los
 *    valores por defecto.
 *  - Los fallos de escritura se clasifican, para poder avisar al operador de que
 *    sus datos NO se están guardando.
 */

export const STORAGE_PREFIX = 'membego_cw_';

/**
 * Versión del esquema de datos persistido. Increméntala ante cualquier cambio
 * incompatible en los tipos que se guardan. Al detectar una versión distinta,
 * los datos existentes se ponen en cuarentena en lugar de intentar leerlos con
 * la forma nueva (que es lo que provocaría el fallo en el arranque).
 */
export const SCHEMA_VERSION = 1;

const VERSION_KEY = `${STORAGE_PREFIX}schema_version`;
const QUARANTINE_INFIX = '__cuarentena__';

/** Cuota asumida por origen. Los navegadores rondan los 5 MiB en unidades UTF-16. */
const ASSUMED_QUOTA_UNITS = 5 * 1024 * 1024;

/** A partir de esta ocupación se avisa al operador ANTES de que falle la escritura. */
export const USAGE_WARNING_THRESHOLD = 0.8;

export type StorageStatus =
  | { kind: 'ok' }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'quota_exceeded'; key: string }
  | { kind: 'write_failed'; key: string; detail: string };

// --- Disponibilidad -------------------------------------------------------

let available: boolean | null = null;

/**
 * localStorage puede existir y aun así lanzar al usarse: modo privado de Safari,
 * cookies de terceros bloqueadas dentro de un iframe, o políticas corporativas.
 * Solo una escritura real lo confirma.
 */
export function isStorageAvailable(): boolean {
  if (available !== null) return available;
  try {
    const probe = `${STORAGE_PREFIX}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

// --- Clasificación de errores --------------------------------------------

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
    error.code === 22 ||
    error.code === 1014
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// --- Cuarentena -----------------------------------------------------------

/**
 * Aparta un valor ilegible sin destruirlo. Se guarda una única copia por clave
 * (la más reciente sobrescribe la anterior) para que la propia cuarentena no
 * consuma cuota de forma acumulativa.
 */
function quarantine(key: string, reason: string): void {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      window.localStorage.setItem(`${key}${QUARANTINE_INFIX}`, raw);
    }
    window.localStorage.removeItem(key);
    console.warn(
      `[storage] "${key}" no se pudo leer (${reason}). ` +
        `Se apartó en "${key}${QUARANTINE_INFIX}" y se continuó con los valores por defecto.`
    );
  } catch (error) {
    // Si ni siquiera podemos apartarlo, lo dejamos como está y seguimos con los
    // valores por defecto. Nunca propagamos: eso es lo que rompía el arranque.
    console.warn(`[storage] No se pudo poner en cuarentena "${key}":`, describe(error));
  }
}

// --- Versionado del esquema ----------------------------------------------

/**
 * Debe ejecutarse una vez antes de la primera hidratación.
 *
 * Una instalación anterior al versionado no tiene la clave y se asume que está
 * en la v1 (que es la forma actual), así que no pierde nada. Cualquier otra
 * discrepancia aparta los datos en vez de arriesgarse a leerlos con otra forma.
 */
export function initStorage(): void {
  if (!isStorageAvailable()) return;

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(VERSION_KEY);
  } catch {
    return;
  }

  if (stored === null) {
    // Instalación nueva, o previa a la introducción del versionado.
    try {
      window.localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
    } catch {
      /* sin efecto: se reintentará en el próximo arranque */
    }
    return;
  }

  if (Number(stored) === SCHEMA_VERSION) return;

  console.warn(
    `[storage] Esquema almacenado v${stored} distinto del soportado v${SCHEMA_VERSION}. ` +
      `Los datos existentes se apartan para evitar un fallo de arranque.`
  );
  for (const key of listAppKeys()) quarantine(key, `esquema v${stored}`);
  try {
    window.localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
  } catch {
    /* sin efecto */
  }
}

// --- Lectura y escritura --------------------------------------------------

/**
 * Hidrata un valor persistido. Nunca lanza.
 *
 * @param isValid Comprobación de forma. Evita que un payload con la estructura
 *   equivocada (por ejemplo un objeto donde se espera un array) reviente más
 *   tarde en un `.filter` o un `.map` dentro del render.
 */
export function loadState<T>(key: string, fallback: T, isValid: (value: unknown) => boolean): T {
  if (!isStorageAvailable()) return fallback;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`[storage] No se pudo leer "${key}":`, describe(error));
    return fallback;
  }
  if (raw === null) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(key, 'JSON inválido');
    return fallback;
  }

  if (!isValid(parsed)) {
    quarantine(key, 'forma inesperada');
    return fallback;
  }
  return parsed as T;
}

/** Persiste un valor. Nunca lanza: devuelve el resultado para que la UI reaccione. */
export function saveState(key: string, value: unknown): StorageStatus {
  if (!isStorageAvailable()) {
    return { kind: 'unavailable', detail: 'localStorage no está disponible en este navegador.' };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    return { kind: 'write_failed', key, detail: describe(error) };
  }

  try {
    window.localStorage.setItem(key, serialized);
    return { kind: 'ok' };
  } catch (error) {
    if (isQuotaError(error)) return { kind: 'quota_exceeded', key };
    return { kind: 'write_failed', key, detail: describe(error) };
  }
}

// --- Ocupación ------------------------------------------------------------

function listAppKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX) && key !== VERSION_KEY) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

/**
 * Ocupación aproximada (0..1) del almacenamiento por parte de esta aplicación.
 *
 * Es una estimación: la cuota real varía por navegador y no es consultable de
 * forma síncrona. Sirve para avisar con antelación, no para contabilidad exacta.
 */
export function getStorageUsageRatio(): number {
  if (!isStorageAvailable()) return 0;
  let units = 0;
  try {
    for (const key of listAppKeys()) {
      units += key.length + (window.localStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    return 0;
  }
  return units / ASSUMED_QUOTA_UNITS;
}

/** Borra los datos de la aplicación. Los deja apartados en cuarentena, no los destruye. */
export function resetAppStorage(): void {
  if (!isStorageAvailable()) return;
  for (const key of listAppKeys()) {
    if (key.includes(QUARANTINE_INFIX)) continue;
    quarantine(key, 'restablecimiento solicitado por el usuario');
  }
}

// --- Validadores de forma -------------------------------------------------

export const isArray = (value: unknown): boolean => Array.isArray(value);
export const isObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isObjectOrNull = (value: unknown): boolean => value === null || isObject(value);
