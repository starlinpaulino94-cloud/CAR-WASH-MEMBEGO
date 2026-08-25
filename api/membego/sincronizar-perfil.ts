import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Sincroniza el PERFIL de la empresa desde Membego (Fase 1).
 *
 * Trae lo que la API de plataforma de Membego expone hoy en bloque a nivel de
 * empresa: el perfil (`GET /companies/{id}`) y las sucursales (`GET /branches`).
 * Lo vuelca a las tablas snapshot vía `membego_sync_perfil` (SECURITY DEFINER).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN PUEDE DISPARARLO
 *
 * Solo un empleado de mostrador de ESTA empresa (guard `exigirEmpleado`, la
 * misma barrera SEC-001 que el resto de bordes). El `companyId` lo fija el
 * servidor (MEMBEGO_COMPANY_ID); nunca llega por la red. La escritura va con
 * service_role, que no sale de este borde.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS SUCURSALES SON OPCIONALES
 *
 * `GET /branches` exige el scope `branches:read`. Si la credencial no lo tiene,
 * Membego responde 403: no es un fallo de la operación, así que el perfil se
 * sincroniza igual y las sucursales se reportan como no disponibles. El perfil
 * (`/companies/{id}`) no exige scope, así que siempre entra.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

interface CompanyDTO {
  id: string;
  nombre: string;
  slug: string;
  logoUrl: string | null;
  moneda: string;
  zonaHoraria: string;
  idioma: string;
}
interface BranchDTO {
  id: string;
  companyId: string;
  nombre: string;
  direccion: string | null;
  activa: boolean;
}

/** Un GET solo confirma que la ruta existe: 405, no 404. */
export async function GET(): Promise<Response> {
  return json({ error: 'method_not_allowed', hint: 'use POST' }, 405);
}

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Barrera: solo un empleado de mostrador de esta empresa.
    await exigirEmpleado(request);

    // 2. Config: Membego + Supabase (service_role para escribir el snapshot).
    const faltan = [...faltaConfiguracion()];
    if (!SUPABASE_URL) faltan.push('SUPABASE_URL');
    if (!SERVICE_ROLE) faltan.push('SUPABASE_SERVICE_ROLE_KEY');
    if (faltan.length) return json({ error: 'config_faltante', faltan }, 503);

    // 3. Perfil (sin scope) y sucursales (scope branches:read; puede faltar).
    const perfil = await llamar<CompanyDTO>(`/companies/${encodeURIComponent(COMPANY_ID)}`);

    let branches: BranchDTO[] = [];
    let sucursalesError: string | null = null;
    try {
      const resp = await llamar<{ branches: BranchDTO[] }>(
        `/branches?companyId=${encodeURIComponent(COMPANY_ID)}`
      );
      branches = resp.branches ?? [];
    } catch (e) {
      // Sin scope u otra causa: se sigue con el perfil, y se dice por qué.
      sucursalesError = e instanceof Error ? e.message : 'No se pudieron leer las sucursales.';
    }

    // 4. Volcado atómico al snapshot vía la RPC.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/membego_sync_perfil`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_membego_company_id: COMPANY_ID,
        p_company: perfil,
        p_branches: branches,
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
        perfil: { nombre: perfil.nombre, moneda: perfil.moneda },
        sucursales: branches.length,
        sucursalesError,
        result,
      },
      200
    );
  } catch (e) {
    const auth = respuestaDeAuth(e);
    if (auth) return auth;
    return respuestaDeError(e, 'sincronizar-perfil');
  }
}
