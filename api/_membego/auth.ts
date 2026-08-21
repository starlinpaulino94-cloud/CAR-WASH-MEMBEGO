/**
 * Puerta de entrada de los bordes de Membego. SOLO SERVIDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (SEC-001)
 *
 * Las funciones de `api/membego/*` actúan usando la credencial de Membego del
 * negocio: consultan la ficha de un cliente, gastan un lavado de membresía, lo
 * revierten. Una función serverless es una URL pública: sin esta verificación,
 * cualquiera que la conozca puede pedir la ficha de un cliente por su teléfono
 * —datos personales— o consumir un beneficio, sin ser empleado de nadie.
 *
 * El `companyId` lo fija el servidor (MEMBEGO_COMPANY_ID), así que no hay fuga
 * ENTRE empresas por esta vía. Lo que faltaba era la otra mitad: que quien llama
 * sea de VERDAD un empleado de ESTA empresa. Eso es lo que se comprueba aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE VALIDA
 *
 * El navegador manda el token de sesión de Supabase (`Authorization: Bearer`).
 * No se verifica la firma a mano —eso obliga a traer las claves y a acertar con
 * el algoritmo—: se le pregunta a Supabase, que es la autoridad, con
 * `GET /auth/v1/user`. Si el token vale, Supabase devuelve el usuario; si no,
 * responde 401 y aquí se traduce a 401. Después se consulta `profiles` CON EL
 * TOKEN DEL USUARIO —la RLS le deja ver solo su fila— para exigir que esté
 * activo y con rol de mostrador o superior. Un operario, que no cobra, no entra.
 *
 * Se usa la `anon key`, que no es secreta (viaja en el bundle del navegador);
 * la `service_role` NO se trae aquí a propósito: ampliar su superficie a cuatro
 * bordes más sería regalar poder que estas funciones no necesitan.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

/** Roles que pueden operar el mostrador. `operario` no cobra, así que no entra. */
const ROLES_MOSTRADOR = new Set([
  'cajero',
  'supervisor',
  'administrador',
  'propietario',
  'superadmin',
]);

export class ErrorAuth extends Error {
  constructor(
    readonly codigo: 'NO_AUTENTICADO' | 'SIN_PERMISO' | 'SIN_CONFIGURAR',
    mensaje: string,
    readonly status: number
  ) {
    super(mensaje);
  }
}

/** Lo que le falta a ESTE guard para funcionar (aparte de lo del cliente Membego). */
export function faltaConfiguracionAuth(): string[] {
  const faltan: string[] = [];
  if (!SUPABASE_URL) faltan.push('SUPABASE_URL');
  if (!ANON_KEY) faltan.push('SUPABASE_ANON_KEY');
  return faltan;
}

/** Extrae el token del encabezado `Authorization: Bearer <jwt>`. */
function tokenDeLaPeticion(request: Request): string {
  const cabecera = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!cabecera) return '';
  const [tipo, valor] = cabecera.split(' ');
  return tipo?.toLowerCase() === 'bearer' && valor ? valor.trim() : '';
}

export interface UsuarioAutenticado {
  userId: string;
  rol: string;
}

/**
 * Exige que quien llama sea un empleado autenticado y con rol de mostrador.
 * Lanza `ErrorAuth` (401/403/503) si no. Devuelve el usuario si todo va bien.
 */
export async function exigirEmpleado(request: Request): Promise<UsuarioAutenticado> {
  const faltan = faltaConfiguracionAuth();
  if (faltan.length > 0) {
    throw new ErrorAuth('SIN_CONFIGURAR', `Falta configurar en Vercel: ${faltan.join(', ')}.`, 503);
  }

  const token = tokenDeLaPeticion(request);
  if (!token) {
    throw new ErrorAuth('NO_AUTENTICADO', 'Falta la sesión: inicie sesión de nuevo.', 401);
  }

  // 1) ¿El token vale? Se lo preguntamos a Supabase, que es la autoridad.
  let userId: string;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new ErrorAuth('NO_AUTENTICADO', 'La sesión no es válida o expiró.', 401);
    }
    const user = (await res.json()) as { id?: string };
    if (!user.id) throw new ErrorAuth('NO_AUTENTICADO', 'La sesión no identifica a nadie.', 401);
    userId = user.id;
  } catch (e) {
    if (e instanceof ErrorAuth) throw e;
    throw new ErrorAuth('NO_AUTENTICADO', 'No se pudo verificar la sesión.', 401);
  }

  // 2) ¿Es un empleado activo con rol de mostrador? La RLS deja al usuario ver
  //    solo su propia fila de `profiles`, así que esta consulta con SU token no
  //    puede leer la de nadie más.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,is_active`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new ErrorAuth('SIN_PERMISO', 'No se pudo comprobar el perfil.', 403);
    }
    const filas = (await res.json()) as Array<{ role?: string; is_active?: boolean }>;
    const perfil = filas[0];
    if (!perfil || perfil.is_active === false || !perfil.role || !ROLES_MOSTRADOR.has(perfil.role)) {
      throw new ErrorAuth('SIN_PERMISO', 'Su usuario no puede operar el mostrador.', 403);
    }
    return { userId, rol: perfil.role };
  } catch (e) {
    if (e instanceof ErrorAuth) throw e;
    throw new ErrorAuth('SIN_PERMISO', 'No se pudo comprobar el perfil.', 403);
  }
}

/** Traduce un `ErrorAuth` a la respuesta JSON del borde. `null` si no lo es. */
export function respuestaDeAuth(e: unknown): Response | null {
  if (e instanceof ErrorAuth) {
    return new Response(JSON.stringify({ error: e.codigo, message: e.message }), {
      status: e.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
