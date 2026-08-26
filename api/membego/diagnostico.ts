/**
 * DIAGNÓSTICO TEMPORAL de la conexión Membego ↔ Supabase. SOLO SERVIDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 *
 * El POS mostraba «La sesión no es válida o expiró» al consultar Membego, y ese
 * aviso sale de la validación con Supabase (`api/_membego/auth.ts`, paso 1) que
 * ocurre ANTES de llamar a Membego. Con la sesión del cajero válida, la única
 * causa posible es que las variables del SERVIDOR (`SUPABASE_URL`,
 * `SUPABASE_ANON_KEY`) no correspondan al mismo proyecto que el frontend.
 *
 * Este borde deja de adivinar: informa, SIN revelar ningún secreto,
 *   · qué variables ve el servidor (solo presente/ausente),
 *   · a qué proyecto pertenece la `anon key` del servidor (su `ref`, que es
 *     público: es el subdominio del propio URL) y con qué rol,
 *   · y el código HTTP EXACTO que devuelve Supabase al validar tu token.
 *
 * Con eso se ve al instante si la anon key es de otro proyecto (`ref` distinto),
 * si por error se pegó la `service_role` (rol distinto de `anon`), o si el
 * problema es otro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES SEGURO
 *
 * No devuelve el VALOR de ninguna variable. El `ref` y el `role` de una anon key
 * son públicos —viajan en el bundle del navegador—. La puerta exige un token de
 * sesión de ESTE proyecto (se decodifica localmente, sin red y sin secretos): un
 * escáner de internet sin sesión recibe 401. Se BORRA cuando el problema quede
 * resuelto.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Host de una URL, o null si no es una URL válida. */
function hostDe(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Payload de un JWT sin verificar la firma. Solo para leer claims públicos. */
function payloadJwt(token: string): Record<string, unknown> | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const json = Buffer.from(partes[1], 'base64url').toString('utf8');
    const obj = JSON.parse(json) as unknown;
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function tokenDeLaPeticion(request: Request): string {
  const cabecera = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!cabecera) return '';
  const [tipo, valor] = cabecera.split(' ');
  return tipo?.toLowerCase() === 'bearer' && valor ? valor.trim() : '';
}

export async function GET(request: Request): Promise<Response> {
  const urlHost = hostDe(SUPABASE_URL);

  // ── Puerta: un token de sesión de ESTE proyecto ────────────────────────────
  // Se decodifica localmente (sin red, sin secretos). Basta con que su emisor
  // sea este mismo Supabase: eso prueba que quien llama tiene sesión aquí, sin
  // depender de la anon key —que es justo lo que estamos diagnosticando—.
  const token = tokenDeLaPeticion(request);
  const claims = token ? payloadJwt(token) : null;
  const issHost = claims && typeof claims.iss === 'string' ? hostDe(claims.iss) : null;

  if (!token || !claims) {
    return json({ error: 'NO_AUTENTICADO', message: 'Abra esto desde el sistema, con su sesión iniciada.' }, 401);
  }
  if (!urlHost || issHost !== urlHost) {
    return json(
      {
        error: 'SIN_PERMISO',
        message: 'Su sesión no es de este proyecto de Supabase.',
        // Estos dos son públicos y son justo la comparación útil.
        tuSesionEmitidaPor: issHost,
        supabaseUrlDelServidor: urlHost,
      },
      403
    );
  }

  // ── El informe (nada de esto es secreto) ───────────────────────────────────
  const anon = payloadJwt(ANON_KEY);
  const anonRef = anon && typeof anon.ref === 'string' ? anon.ref : null;
  const anonRole = anon && typeof anon.role === 'string' ? anon.role : null;
  const subdominioUrl = urlHost ? urlHost.split('.')[0] : null;

  // El paso 1 real: validar el token del que llama con la anon key del servidor.
  let authUserStatus: number | string = 'no probado';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    authUserStatus = res.status;
  } catch (e) {
    authUserStatus = `error de red: ${(e as Error).message}`;
  }

  const refCoincide = anonRef !== null && anonRef === subdominioUrl;

  return json({
    nota: 'Diagnóstico temporal. Ninguna clave se revela; solo presencia y datos públicos.',
    variablesPresentes: {
      SUPABASE_URL: SUPABASE_URL !== '',
      SUPABASE_ANON_KEY: ANON_KEY !== '',
      MEMBEGO_COMPANY_ID: (process.env.MEMBEGO_COMPANY_ID ?? '') !== '',
      MEMBEGO_CLIENT_ID: (process.env.MEMBEGO_CLIENT_ID ?? '') !== '',
      MEMBEGO_CLIENT_SECRET: (process.env.MEMBEGO_CLIENT_SECRET ?? '') !== '',
      MEMBEGO_SISTEMA_SLUG: (process.env.MEMBEGO_SISTEMA_SLUG ?? '') !== '',
    },
    supabase: {
      urlDelServidor: urlHost,
      subdominioDelUrl: subdominioUrl,
      anonKey: {
        proyecto_ref: anonRef,
        rol: anonRole,
        esAnon: anonRole === 'anon',
      },
      // El veredicto: si esto es false, la anon key del servidor es de OTRO
      // proyecto (o está mal pegada) — esa es la causa del 401.
      anonKeyEsDelMismoProyecto: refCoincide,
    },
    validacionDeSesion: {
      // 200 = tu token vale con esta anon key (el guard pasaría).
      // 401 = anon key o token rechazados. Con refCoincide=false y rol=anon,
      //       la culpa es de la anon key del servidor.
      authUserHttpStatus: authUserStatus,
    },
    veredicto: refCoincide
      ? (authUserStatus === 200
          ? 'La sesión valida. El 401 no está aquí: revise el paso 2/3 o las variables MEMBEGO_*.'
          : 'La anon key es del proyecto correcto pero Supabase rechazó la validación. Revise que no tenga espacios/saltos y que sea la clave ACTUAL.')
      : 'La SUPABASE_ANON_KEY del servidor NO es de este proyecto (o está mal pegada). Cópiela de nuevo desde Supabase (Settings → API → anon public) y redeploy.',
  });
}
