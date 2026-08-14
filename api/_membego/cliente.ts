/**
 * Cliente de la Platform API de Membego. SOLO SERVIDOR.
 *
 * Vive en `api/` y nunca en `src/` por una razón que no admite excepción: usa
 * `MEMBEGO_CLIENT_SECRET`, y una credencial que llega al navegador está
 * publicada. Por eso tampoco lleva el prefijo `VITE_` — Vite solo inyecta en el
 * bundle las variables que lo llevan, así que el propio nombre de la variable
 * es la primera barrera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOKEN SE GUARDA EN MEMORIA, Y ESO ES UNA DECISIÓN, NO UN ATAJO
 *
 * Cada función de Vercel es un proceso que puede morir entre peticiones. La
 * caché sirve para las llamadas seguidas del mismo mostrador —buscar cliente,
 * evaluar, cobrar— y se pierde sin consecuencias cuando el proceso se recicla:
 * lo peor que pasa es pedir otro token. Guardarlo en la base sería inventar un
 * almacén de credenciales para ahorrar una llamada de red.
 *
 * Se renueva 60 segundos ANTES de vencer. Un token que caduca en el viaje de
 * ida da un 401 en mitad de un cobro, y el cajero no tiene forma de saber que
 * el problema era un reloj.
 */

const BASE = process.env.MEMBEGO_API_URL ?? 'https://membego.com/api/platform/v1';
const CLIENT_ID = process.env.MEMBEGO_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.MEMBEGO_CLIENT_SECRET ?? '';
/** Empresa de Membego con la que está vinculado este car wash. */
export const COMPANY_ID = process.env.MEMBEGO_COMPANY_ID ?? '';

/** Qué se pide al autenticar. Menos que esto no alcanza; más, sobra. */
const SCOPES = 'customers:read vehicles:read memberships:read benefits:read benefits:redeem';

export function faltaConfiguracion(): string[] {
  const faltan: string[] = [];
  if (!CLIENT_ID) faltan.push('MEMBEGO_CLIENT_ID');
  if (!CLIENT_SECRET) faltan.push('MEMBEGO_CLIENT_SECRET');
  if (!COMPANY_ID) faltan.push('MEMBEGO_COMPANY_ID');
  return faltan;
}

let tokenEnCurso: { valor: string; venceEn: number } | null = null;
/** Una sola petición de token aunque lleguen diez llamadas a la vez. */
let pidiendo: Promise<string> | null = null;

async function pedirToken(): Promise<string> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: SCOPES,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new ErrorMembego(
      res.status === 401 ? 'CREDENCIAL_RECHAZADA' : 'SIN_TOKEN',
      `Membego rechazó las credenciales (HTTP ${res.status}). ${detalle.slice(0, 200)}`
    );
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new ErrorMembego('SIN_TOKEN', 'Membego no devolvió token.');

  // 60 s de colchón: un token que vence en el viaje de ida da un 401 en mitad
  // de un cobro.
  const vida = Math.max(60, (body.expires_in ?? 3600) - 60);
  tokenEnCurso = { valor: body.access_token, venceEn: Date.now() + vida * 1000 };
  return body.access_token;
}

async function token(): Promise<string> {
  if (tokenEnCurso && tokenEnCurso.venceEn > Date.now()) return tokenEnCurso.valor;
  // Sin esta bandera, diez peticiones simultáneas piden diez tokens y Membego
  // ve una ráfaga de autenticaciones cada vez que se abre el mostrador.
  if (!pidiendo) pidiendo = pedirToken().finally(() => { pidiendo = null; });
  return pidiendo;
}

export type CodigoErrorMembego =
  | 'SIN_CONFIGURAR'
  | 'CREDENCIAL_RECHAZADA'
  | 'SIN_TOKEN'
  | 'NO_DISPONIBLE'
  | 'RECHAZADO';

export class ErrorMembego extends Error {
  constructor(readonly codigo: CodigoErrorMembego, mensaje: string, readonly status = 502) {
    super(mensaje);
  }
}

interface OpcionesLlamada {
  metodo?: 'GET' | 'POST';
  cuerpo?: unknown;
  /** Obligatoria en todo lo que escribe. La reenviamos tal cual. */
  claveIdempotencia?: string;
}

/**
 * Una llamada a Membego, con el token puesto.
 *
 * Un 401 se reintenta UNA vez con token nuevo: el caso real es un token que
 * venció antes de lo que decía, y reintentar en bucle contra un 401 legítimo
 * —credencial revocada— sería martillear a Membego con la credencial mala.
 */
export async function llamar<T>(ruta: string, opciones: OpcionesLlamada = {}): Promise<T> {
  const faltan = faltaConfiguracion();
  if (faltan.length > 0) {
    throw new ErrorMembego(
      'SIN_CONFIGURAR',
      `Falta configurar en Vercel: ${faltan.join(', ')}.`,
      503
    );
  }

  const ejecutar = async (jwt: string) => {
    const cabeceras: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    };
    if (opciones.claveIdempotencia) cabeceras['Idempotency-Key'] = opciones.claveIdempotencia;

    return fetch(`${BASE}${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: cabeceras,
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  };

  let res: Response;
  try {
    res = await ejecutar(await token());
    if (res.status === 401) {
      tokenEnCurso = null;
      res = await ejecutar(await token());
    }
  } catch (e) {
    if (e instanceof ErrorMembego) throw e;
    throw new ErrorMembego('NO_DISPONIBLE', 'No se pudo contactar con Membego.', 503);
  }

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new ErrorMembego(
      'RECHAZADO',
      `Membego respondió ${res.status}: ${detalle.slice(0, 300)}`,
      // 4xx de Membego se devuelven tal cual: son problemas de la petición, no
      // caídas. Aplanarlos todos a 502 haría que el mostrador reintentara algo
      // que nunca va a funcionar.
      res.status >= 400 && res.status < 500 ? res.status : 502
    );
  }

  return (await res.json()) as T;
}

/** Respuesta JSON uniforme para las funciones de este borde. */
export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Traduce un fallo a la respuesta que el mostrador puede entender. */
export function respuestaDeError(e: unknown): Response {
  if (e instanceof ErrorMembego) {
    console.warn('[membego]', e.codigo, e.message);
    return json({ error: e.codigo, message: e.message }, e.status);
  }
  console.error('[membego] inesperado', e);
  return json({ error: 'NO_DISPONIBLE', message: 'No se pudo contactar con Membego.' }, 503);
}
