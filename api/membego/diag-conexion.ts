/**
 * DIAGNÓSTICO TEMPORAL de la conexión del car wash con la Platform API de Membego.
 *
 * Reproduce, desde el servidor, EXACTAMENTE lo que hace el POS al consultar la
 * ficha de un cliente:
 *   1. dice a qué Membego llama (BASE = MEMBEGO_API_URL),
 *   2. le pide su /diag (para ver la huella del secreto y el commit de ESE Membego),
 *   3. pide un token con las credenciales del car wash,
 *   4. usa ese token contra un endpoint real (/branches) y reporta qué responde.
 *
 * Así se ve si el `INVALID_TOKEN` viene de que el car wash habla con OTRO Membego
 * (huella distinta), de que el token no verifica, o de otra cosa.
 *
 * No revela secretos: el client_secret nunca se imprime; del token solo se
 * muestran sus claims públicos (cid/scopes/exp), no el token en sí. TEMPORAL:
 * se borra cuando el problema quede resuelto.
 */

const BASE = process.env.MEMBEGO_API_URL ?? 'https://membego.com/api/platform/v1';
const CLIENT_ID = process.env.MEMBEGO_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.MEMBEGO_CLIENT_SECRET ?? '';
const COMPANY_ID = process.env.MEMBEGO_COMPANY_ID ?? '';
const SCOPES =
  'customers:read memberships:read benefits:read benefits:redeem promotions:read appointments:read branches:read';

function j(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function claimsDe(token: string): unknown {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Cabeceras de Vercel que identifican QUÉ deployment atendió la petición. */
function cabecerasVercel(r: Response): Record<string, string | null> {
  return {
    xVercelId: r.headers.get('x-vercel-id'),
    xMatchedPath: r.headers.get('x-matched-path'),
    server: r.headers.get('server'),
    xVercelCache: r.headers.get('x-vercel-cache'),
  };
}

export async function GET(): Promise<Response> {
  const out: Record<string, unknown> = {
    nota: 'Diagnóstico temporal. No se revela el client_secret ni el token.',
    base: BASE,
    clientIdPrefix: CLIENT_ID.slice(0, 12),
    clientSecretPresente: CLIENT_SECRET !== '',
    companyIdPresente: COMPANY_ID !== '',
  };

  // 1) /diag del Membego que ve el car wash — su huella y su commit.
  try {
    const r = await fetch(`${BASE}/diag`, { headers: { Accept: 'application/json' } });
    const txt = await r.text();
    let body: unknown = txt.slice(0, 400);
    try { body = JSON.parse(txt); } catch { /* no era JSON: se deja el texto */ }
    out.membegoDiag = { status: r.status, headers: cabecerasVercel(r), body };
  } catch (e) {
    out.membegoDiag = { error: (e as Error).message };
  }

  // 2) Pedir token con las credenciales del car wash.
  let token = '';
  try {
    const r = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: SCOPES,
      }),
    });
    const txt = await r.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(txt) as Record<string, unknown>; } catch { /* */ }
    token = typeof body.access_token === 'string' ? body.access_token : '';
    out.mint = {
      status: r.status,
      headers: cabecerasVercel(r),
      gotToken: token !== '',
      claims: token ? claimsDe(token) : null,
      bodyIfError: r.ok ? undefined : txt.slice(0, 300),
    };
  } catch (e) {
    out.mint = { error: (e as Error).message };
  }

  // 3) Usar el token contra un endpoint real (/branches). Reproduce el 401.
  if (token) {
    try {
      const r = await fetch(`${BASE}/branches?companyId=${encodeURIComponent(COMPANY_ID)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const txt = await r.text();
      out.resourceCall = {
        endpoint: '/branches',
        status: r.status,
        headers: cabecerasVercel(r),
        body: r.ok ? 'OK (200)' : txt.slice(0, 300),
      };
    } catch (e) {
      out.resourceCall = { error: (e as Error).message };
    }
  }

  return j(out);
}
