/**
 * Webhook de Membego (función de Vercel — formato Web Handler oficial).
 *
 * Membego EMPUJA aquí los eventos, firmados con HMAC-SHA256 del cuerpo crudo
 * (header `X-Membego-Firma`). Este borde delgado:
 *   1. verifica la firma en tiempo constante,
 *   2. reenvía el sobre a `membego_ingest_event` de Supabase (que hace TODO el
 *      trabajo: idempotencia, enrutado por companyId, aislamiento).
 *
 * Variables (Vercel, sin VITE_): MEMBEGO_SECRETO, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY. La service_role nunca sale de aquí.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.MEMBEGO_SECRETO ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** HMAC-SHA256 hex del cuerpo crudo, comparado en tiempo constante. */
export function firmaValida(raw: string, firma: string): boolean {
  if (!SECRET || !firma) return false;
  const esperada = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Un GET sirve para comprobar que la ruta existe: debe dar 405, no 404.
 *  Mismo formato que /api/sso/membego (async + Request), que sí despliega bien. */
export async function GET(_request?: Request): Promise<Response> {
  return json({ error: 'method_not_allowed', hint: 'use POST' }, 405);
}

export async function POST(request: Request): Promise<Response> {
  // Toda la ruta va envuelta: un throw no controlado se vería como un 500 opaco
  // de la plataforma (justo lo que Membego reporta). Aquí lo convertimos en una
  // respuesta con causa, y elegimos el código según la regla de Membego:
  // 5xx SOLO cuando un reintento puede ayudar; 2xx para lo que nunca procesaremos.
  try {
    // Config faltante = 5xx a propósito: en cuanto se corrige la variable en
    // Vercel y se redepliega, los eventos en cola reintentan y entran solos.
    // Sin esto, `fetch` con SUPABASE_URL vacío lanza y da un 500 sin pista.
    const faltan: string[] = [];
    if (!SUPABASE_URL) faltan.push('SUPABASE_URL');
    if (!SERVICE_ROLE) faltan.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!SECRET) faltan.push('MEMBEGO_SECRETO');
    if (faltan.length) return json({ error: 'config_faltante', faltan }, 503);

    // El HMAC es del cuerpo CRUDO EXACTO: no re-serializar el JSON.
    const raw = await request.text();
    const firma = request.headers.get('x-membego-firma') ?? '';
    if (!firmaValida(raw, firma)) return json({ error: 'firma_invalida' }, 401);

    let evento: { id?: string; tipo?: string; companyId?: string; payload?: unknown };
    try {
      evento = JSON.parse(raw);
    } catch {
      return json({ error: 'json_invalido' }, 400);
    }
    if (!evento.id || !evento.tipo || !evento.companyId) {
      return json({ error: 'sobre_incompleto' }, 400);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/membego_ingest_event`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_event_id: String(evento.id),
        p_tipo: String(evento.tipo),
        p_membego_company_id: String(evento.companyId),
        p_payload: evento.payload ?? {},
      }),
    });

    // La función de base ya devuelve 2xx para lo permanente (empresa/tipo
    // desconocido, duplicado, error de esquema): eso llega aquí como res.ok y
    // sale 200. Un !res.ok es un fallo posiblemente transitorio de PostgREST →
    // 502 para que Membego reintente. Adjuntamos el detalle para diagnóstico.
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      return json({ error: 'ingesta_fallida', status: res.status, detalle: detalle.slice(0, 500) }, 502);
    }
    const result = await res.json().catch(() => ({}));
    return json({ ok: true, result }, 200);
  } catch (err) {
    // Excepción inesperada (red caída, SUPABASE_URL malformado, etc.): tratamos
    // como transitorio → 502 para reintento, pero con causa visible en el cuerpo.
    const detalle = err instanceof Error ? err.message : String(err);
    return json({ error: 'excepcion_no_controlada', detalle: detalle.slice(0, 500) }, 502);
  }
}
