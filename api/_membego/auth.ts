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
 * CÓMO SE VALIDA — TRES PREGUNTAS
 *
 * El navegador manda el token de sesión de Supabase (`Authorization: Bearer`).
 * No se verifica la firma a mano —eso obliga a traer las claves y a acertar con
 * el algoritmo—: se le pregunta a Supabase, que es la autoridad.
 *
 *   1. ¿El token vale?  `GET /auth/v1/user`. Si no, 401.
 *   2. ¿Es un empleado activo con rol de mostrador?  Se lee `profiles` con SU
 *      token (la RLS le deja ver solo su fila). Un operario, que no cobra, no
 *      entra.
 *   3. ¿Es de ESTA empresa?  Este es el candado que faltaba. La base es
 *      multi-tenant en UN solo Supabase: muchas empresas conviven en `profiles`.
 *      Sin esta comprobación, un cajero de OTRO car wash del mismo Supabase
 *      pasaría los pasos 1 y 2 y podría pedir la ficha de un cliente de este
 *      local o gastarle un beneficio. Se exige que la empresa del que llama sea
 *      la que está VINCULADA a la empresa de Membego de este despliegue
 *      (`membego_company_links.membego_company_id == MEMBEGO_COMPANY_ID`),
 *      leído también con su token bajo RLS. El `companyId` fijo del servidor
 *      dice a QUÉ empresa de Membego se llama; esto dice QUIÉN puede llamar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PASO 3 DEPENDE DE UNA POLÍTICA RLS. NO LA ESTRECHE.
 *
 * `membego_company_links` se lee con el token de quien llama, así que su
 * política de SELECT decide, sin quererlo, quién pasa el paso 3. Cuando esa
 * política filtraba además por rol —propietario/administrador/superadmin— a los
 * cajeros les llegaban cero filas y el guard los acusaba de ser otra empresa.
 * La política es hoy `belongs_to_tenant` a secas y así debe seguir: quién puede
 * operar se decide AQUÍ, en el paso 2. `tests/api/auth-membego.test.mjs` lo
 * comprueba contra las migraciones.
 *
 * Se usa la `anon key`, que no es secreta (viaja en el bundle del navegador);
 * la `service_role` NO se trae aquí a propósito: ampliar su superficie a cuatro
 * bordes más sería regalar poder que estas funciones no necesitan.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
/** La empresa de Membego que este despliegue atiende. El candado del paso 3. */
const MEMBEGO_COMPANY_ID = process.env.MEMBEGO_COMPANY_ID ?? '';

/**
 * Roles que pueden OPERAR: canjear un lavado, revertirlo, registrar una
 * transacción, sincronizar el catálogo. Mueven saldo o configuración.
 * `operario` no cobra, así que no entra.
 */
const ROLES_MOSTRADOR = new Set([
  'cajero',
  'supervisor',
  'administrador',
  'propietario',
  'superadmin',
]);

/**
 * Roles que pueden CONSULTAR la ficha de un cliente: los de arriba más
 * `recepcionista`, que es quien recibe los carros.
 *
 * Negarle la ficha a la recepción no protegía nada: las membresías y las
 * promociones ya están en NUESTRA base y su política RLS (migración 0014) las
 * deja leer a cualquier empleado del tenant. Lo único que se conseguía era que
 * quien registra la llegada viera el distintivo «Membresía activa» sin poder
 * ver cuántos lavados le quedan — justo el dato que hace falta en la puerta.
 *
 * Consultar no gasta nada: `/benefits/evaluate` devuelve `reserved: false`.
 * Canjear sigue siendo de los roles de arriba.
 */
const ROLES_CONSULTA = new Set([...ROLES_MOSTRADOR, 'recepcionista']);

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
  // Sin esto el paso 3 no tiene contra qué comparar. Se exige aquí para FALLAR
  // CERRADO: mejor 503 que dejar entrar a cualquier empresa por un env vacío.
  if (!MEMBEGO_COMPANY_ID) faltan.push('MEMBEGO_COMPANY_ID');
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

export interface OpcionesGuard {
  /**
   * `true` en los bordes que solo LEEN (la ficha del cliente). Admite además a
   * la recepción. Los que canjean, revierten o cobran no lo ponen.
   */
  soloLectura?: boolean;
}

/**
 * Exige que quien llama sea un empleado autenticado y con rol de mostrador.
 * Lanza `ErrorAuth` (401/403/503) si no. Devuelve el usuario si todo va bien.
 */
export async function exigirEmpleado(
  request: Request,
  opciones: OpcionesGuard = {}
): Promise<UsuarioAutenticado> {
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
  let rolDelPaso2: string;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,is_active`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new ErrorAuth('SIN_PERMISO', 'No se pudo comprobar el perfil.', 403);
    }
    const admitidos = opciones.soloLectura ? ROLES_CONSULTA : ROLES_MOSTRADOR;
    const filas = (await res.json()) as Array<{ role?: string; is_active?: boolean }>;
    const perfil = filas[0];
    if (!perfil || perfil.is_active === false || !perfil.role || !admitidos.has(perfil.role)) {
      throw new ErrorAuth('SIN_PERMISO', 'Su usuario no puede operar el mostrador.', 403);
    }
    rolDelPaso2 = perfil.role;
  } catch (e) {
    if (e instanceof ErrorAuth) throw e;
    throw new ErrorAuth('SIN_PERMISO', 'No se pudo comprobar el perfil.', 403);
  }

  // 3) ¿Es de ESTA empresa? La RLS deja al usuario ver solo el vínculo de SU
  //    empresa; se exige que ese vínculo apunte a la empresa de Membego de este
  //    despliegue y esté activo. Así un empleado de otro inquilino del mismo
  //    Supabase —que sí pasa los pasos 1 y 2— no alcanza a este local.
  //
  //    Los tres motivos por los que esto falla se dicen POR SEPARADO. Antes los
  //    tres daban «Su empresa no es la vinculada a este local», y como la
  //    política RLS de la tabla filtraba además por rol, a un cajero le salía
  //    ese mensaje aunque el vínculo estuviera perfecto: el sistema acusaba de
  //    ser otra empresa a quien solo no tenía permiso de lectura. Un mensaje
  //    exacto sobre lo que el código ve y falso sobre lo que pasa es lo que
  //    convierte un fallo de diez minutos en uno de tres días.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/membego_company_links?select=membego_company_id,is_active`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new ErrorAuth('SIN_PERMISO', 'No se pudo comprobar el vínculo con Membego.', 403);
    }
    const filas = (await res.json()) as Array<{ membego_company_id?: string; is_active?: boolean }>;

    // Ninguna fila: su empresa no tiene vínculo (o la migración que abre esta
    // lectura al mostrador todavía no se aplicó).
    if (filas.length === 0) {
      throw new ErrorAuth(
        'SIN_PERMISO',
        'Este local todavía no está vinculado con Membego. Un propietario o administrador puede vincularlo en Ajustes → Membego.',
        403
      );
    }

    const delLocal = filas.find((f) => f.membego_company_id === MEMBEGO_COMPANY_ID);

    // Hay vínculo, pero apunta a otra empresa de Membego. Eso es un despliegue
    // mal apuntado, no un empleado intruso: quien lo lee es un dato de SU
    // empresa, así que decirlo no filtra nada de nadie.
    if (!delLocal) {
      throw new ErrorAuth(
        'SIN_PERMISO',
        'Su empresa está vinculada a otra empresa de Membego, no a la de este local. Revise la vinculación en Ajustes → Membego.',
        403
      );
    }

    // Existe y es la correcta, pero alguien la apagó a mano.
    if (delLocal.is_active === false) {
      throw new ErrorAuth(
        'SIN_PERMISO',
        'El vínculo con Membego de este local está desactivado. Vuelva a activarlo en Ajustes → Membego.',
        403
      );
    }

    return { userId, rol: rolDelPaso2 };
  } catch (e) {
    if (e instanceof ErrorAuth) throw e;
    throw new ErrorAuth('SIN_PERMISO', 'No se pudo comprobar el vínculo con Membego.', 403);
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
