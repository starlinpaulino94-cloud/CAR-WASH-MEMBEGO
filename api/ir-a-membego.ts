/**
 * SSO saliente: entrar a Membego ya logueado (función de Vercel, Web Handler).
 *
 * El botón "Ir a Membego" del car wash llama aquí con el token de sesión del
 * usuario (header Authorization: Bearer <access_token de Supabase>). Este borde:
 *   1. resuelve la identidad del usuario llamando a `membego_sso_saliente` CON SU
 *      PROPIO token (así auth.uid() lo identifica; no usa service_role),
 *   2. firma un pase corto (HMAC-SHA256, 90 s) con el secreto compartido,
 *   3. devuelve la URL de entrada de Membego con ?sistema=<slug>&token=<pase>.
 *
 * El navegador abre esa URL en pestaña nueva. Contrato de Membego (§ SSO entrada):
 *   GET https://membego.com/sso/entrar?sistema=<slug>&token=<base64url(JSON).hmacHex>
 *   payload = { sub?, email, companyId, exp }   (no-JWT, firma hex minúsculas)
 *
 * Variables (Vercel, sin VITE_): MEMBEGO_SECRETO, SUPABASE_URL,
 * MEMBEGO_SISTEMA_SLUG, y opcional MEMBEGO_SSO_ENTRADA_URL (por defecto
 * https://membego.com/sso/entrar).
 */
import { createHmac } from 'node:crypto';

const SECRET = process.env.MEMBEGO_SECRETO ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SLUG = process.env.MEMBEGO_SISTEMA_SLUG ?? '';
const ENTRADA = process.env.MEMBEGO_SSO_ENTRADA_URL ?? 'https://membego.com/sso/entrar';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Pase de salida: base64url(JSON) + "." + hmacSha256Hex(base64url(JSON)). */
export function firmarPase(payload: Record<string, unknown>): string {
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const firma = createHmac('sha256', SECRET).update(cuerpo, 'utf8').digest('hex');
  return `${cuerpo}.${firma}`;
}

/** Arma la URL de entrada a Membego a partir de la identidad resuelta. */
export function construirUrl(datos: { email?: string; sub?: string | null; companyId?: string }): string {
  const payload: Record<string, unknown> = {
    email: datos.email,
    companyId: datos.companyId,
    exp: Math.floor(Date.now() / 1000) + 90, // vence en 90 s (igual que el de entrada)
  };
  if (datos.sub) payload.sub = datos.sub; // preferido por Membego cuando existe
  const pase = firmarPase(payload);
  return `${ENTRADA}?sistema=${encodeURIComponent(SLUG)}&token=${encodeURIComponent(pase)}`;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const faltan: string[] = [];
    if (!SECRET) faltan.push('MEMBEGO_SECRETO');
    if (!SUPABASE_URL) faltan.push('SUPABASE_URL');
    if (!SLUG) faltan.push('MEMBEGO_SISTEMA_SLUG');
    if (faltan.length) return json({ error: 'config_faltante', faltan }, 503);

    const auth = request.headers.get('authorization') ?? '';
    if (!/^bearer\s+/i.test(auth)) return json({ error: 'sin_sesion' }, 401);
    const accessToken = auth.replace(/^bearer\s+/i, '').trim();

    // Resolver identidad con el TOKEN DEL USUARIO. En Supabase, un access_token
    // de usuario es un JWT válido y sirve también como apikey del gateway.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/membego_sso_saliente`, {
      method: 'POST',
      headers: {
        apikey: accessToken,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      return json({ error: 'no_identificado', status: res.status, detalle: detalle.slice(0, 300) }, 403);
    }

    const datos = (await res.json().catch(() => ({}))) as {
      email?: string; sub?: string | null; companyId?: string;
    };
    if (!datos.email || !datos.companyId) {
      return json({ error: 'identidad_incompleta' }, 403);
    }

    return json({ url: construirUrl(datos) }, 200);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    return json({ error: 'excepcion_no_controlada', detalle: detalle.slice(0, 300) }, 500);
  }
}
