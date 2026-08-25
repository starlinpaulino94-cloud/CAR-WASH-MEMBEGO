import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Sincroniza el CATÁLOGO de la empresa desde Membego (Fase 2).
 *
 * Trae en bloque promociones (`GET /promotions`), citas (`GET /appointments`) y
 * membresías activas (`GET /memberships`) y las vuelca a las tablas snapshot vía
 * `membego_sync_catalogo` (SECURITY DEFINER).
 *
 * Como el perfil de la Fase 1: solo un empleado de mostrador de ESTA empresa lo
 * dispara, el companyId lo fija el servidor, y cada recurso es OPCIONAL — si a
 * la credencial le falta un scope, Membego responde 403, ese recurso se reporta
 * como no disponible y los demás entran igual. Nada de esto AUTORIZA un canje:
 * son proyecciones para pintar.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function jalar<T>(ruta: string): Promise<{ datos: T | null; error: string | null }> {
  try {
    return { datos: await llamar<T>(ruta), error: null };
  } catch (e) {
    return { datos: null, error: e instanceof Error ? e.message : 'No disponible' };
  }
}

/** Un GET solo confirma que la ruta existe: 405, no 404. */
export async function GET(): Promise<Response> {
  return json({ error: 'method_not_allowed', hint: 'use POST' }, 405);
}

export async function POST(request: Request): Promise<Response> {
  try {
    await exigirEmpleado(request);

    const faltan = [...faltaConfiguracion()];
    if (!SUPABASE_URL) faltan.push('SUPABASE_URL');
    if (!SERVICE_ROLE) faltan.push('SUPABASE_SERVICE_ROLE_KEY');
    if (faltan.length) return json({ error: 'config_faltante', faltan }, 503);

    const cid = encodeURIComponent(COMPANY_ID);
    const [promos, citas, mems] = await Promise.all([
      jalar<{ promotions: unknown[] }>(`/promotions?companyId=${cid}`),
      jalar<{ appointments: unknown[] }>(`/appointments?companyId=${cid}`),
      jalar<{ memberships: unknown[] }>(`/memberships?companyId=${cid}`),
    ]);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/membego_sync_catalogo`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_membego_company_id: COMPANY_ID,
        p_promotions: promos.datos?.promotions ?? [],
        p_appointments: citas.datos?.appointments ?? [],
        p_memberships: mems.datos?.memberships ?? [],
      }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      return json({ error: 'sync_fallido', status: res.status, detalle: detalle.slice(0, 500) }, 502);
    }
    const result = await res.json().catch(() => ({}));

    return json(
      {
        ok: true,
        promociones: promos.datos?.promotions?.length ?? 0,
        citas: citas.datos?.appointments?.length ?? 0,
        membresias: mems.datos?.memberships?.length ?? 0,
        errores: {
          promociones: promos.error,
          citas: citas.error,
          membresias: mems.error,
        },
        result,
      },
      200
    );
  } catch (e) {
    const auth = respuestaDeAuth(e);
    if (auth) return auth;
    return respuestaDeError(e, 'sincronizar-catalogo');
  }
}
