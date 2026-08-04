/**
 * SSO desde Membego (función de Vercel — formato Web Handler oficial).
 *
 * Membego redirige al empleado a  GET /sso/membego?token=<TOKEN>
 * El token es `base64url(JSON) + "." + hmacSha256Hex(base64url(JSON), secreto)`
 * con payload { sub, email, rol, companyId, exp } y vence en 90 s.
 *
 * Verifica la firma, asegura el usuario local en la empresa del token (RPC con
 * service_role local), acuña una sesión de Supabase (magic link) y redirige.
 *
 * Variables (Vercel, sin VITE_): MEMBEGO_SECRETO, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY. El dominio debe estar en las Redirect URLs de
 * Supabase (Auth → URL Configuration).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.MEMBEGO_SECRETO ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

interface TokenMembego {
  sub: string;
  email: string;
  rol: string;
  companyId: string;
  exp: number;
}

/** Verificación del token, tal cual el contrato de Membego (§ SSO). */
export function verificarTokenMembego(token: string): TokenMembego | null {
  if (!SECRET) return null;
  const punto = token.lastIndexOf('.');
  if (punto <= 0) return null;
  const cuerpo = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  const esperada = createHmac('sha256', SECRET).update(cuerpo, 'utf8').digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let datos: TokenMembego;
  try {
    datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof datos.exp !== 'number' || datos.exp < Math.floor(Date.now() / 1000)) return null;
  if (!datos.sub || !datos.companyId) return null;
  return datos;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const datos = verificarTokenMembego(token);
  if (!datos) return new Response('Token de Membego inválido o vencido.', { status: 401 });

  // 1) Asegurar el usuario local y su perfil en la empresa del token.
  const upsert = await fetch(`${SUPABASE_URL}/rest/v1/rpc/membego_sso_upsert_user`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_membego_company_id: String(datos.companyId),
      p_sub: String(datos.sub),
      p_email: String(datos.email),
      p_rol: String(datos.rol),
    }),
  });
  if (!upsert.ok) return new Response('No se pudo preparar la cuenta del empleado.', { status: 502 });

  // 2) Acuñar la sesión de Supabase con un enlace mágico y redirigir el navegador.
  const gen = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: String(datos.email), options: { redirect_to: `${url.origin}/` } }),
  });
  if (!gen.ok) return new Response('No se pudo iniciar la sesión.', { status: 502 });

  const link = await gen.json().catch(() => ({} as Record<string, unknown>));
  const dest =
    (link as { action_link?: string }).action_link ??
    (link as { properties?: { action_link?: string } }).properties?.action_link;
  if (!dest) return new Response('El proveedor no devolvió un enlace de sesión.', { status: 502 });

  return new Response(null, { status: 302, headers: { Location: dest } });
}
