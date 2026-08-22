import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion, ErrorMembego } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Devolverle el lavado al cliente cuando se anula la factura.
 *
 * La otra mitad de `canjear`. Sin esto, anular una venta le quitaba al cliente
 * un lavado para siempre: el sistema devolvía el dinero y el inventario, pero
 * el beneficio consumido se quedaba consumido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE IDENTIFICA POR LA VISITA
 *
 * Membego devuelve dos identificadores al canjear: la transacción comercial y
 * la VISITA. Lo que consumió el lavado fue la visita, así que es la que se
 * revierte; la transacción se arrastra detrás. Por eso la factura guarda
 * `membego_visit_id` y no solo el de la transacción.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REVERTIR DOS VECES DEVUELVE UN LAVADO, NO DOS
 *
 * Membego responde 200 con `applied: false` si ya estaba revertida, y esta
 * función lo pasa tal cual. Es la respuesta correcta a «asegúrate de que esto
 * está revertido», que es exactamente lo que hace un reintento tras un timeout.
 */

interface Cuerpo {
  /** La visita en Membego, guardada en la factura al canjear. */
  visitId?: string;
  /** Por qué se devuelve. Obligatorio: Membego lo exige y con razón. */
  reason?: string;
}

interface RespuestaReversa {
  visitId: string;
  membershipId: string;
  customerId: string;
  companyId: string;
  usesLeft: number | null;
  applied: boolean;
  reversedAt: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await exigirEmpleado(request);
  } catch (e) {
    const r = respuestaDeAuth(e);
    if (r) return r;
    return respuestaDeError(e);
  }

  const faltan = faltaConfiguracion();
  if (faltan.length > 0) {
    return json(
      { error: 'SIN_CONFIGURAR', message: `Falta configurar en Vercel: ${faltan.join(', ')}.` },
      503
    );
  }

  let cuerpo: Cuerpo;
  try {
    cuerpo = (await request.json()) as Cuerpo;
  } catch {
    return json({ error: 'PETICION_INVALIDA', message: 'Cuerpo JSON inválido.' }, 400);
  }

  const visitId = cuerpo.visitId?.trim() ?? '';
  const reason = cuerpo.reason?.trim() ?? '';
  if (!visitId || !reason) {
    return json({ error: 'PETICION_INVALIDA', message: 'Faltan visitId o reason.' }, 400);
  }

  try {
    const reversa = await llamar<RespuestaReversa>(
      `/redemptions/${encodeURIComponent(visitId)}/reverse`,
      {
        metodo: 'POST',
        // Derivada de la visita: el reintento llega con la misma clave y no
        // devuelve dos lavados.
        claveIdempotencia: `cw-rev-${visitId}`,
        cuerpo: { companyId: COMPANY_ID, reason },
      }
    );

    return json(
      { visitId: reversa.visitId, usesLeft: reversa.usesLeft, applied: reversa.applied },
      200
    );
  } catch (e) {
    if (e instanceof ErrorMembego) {
      return json({ error: e.codigo, message: e.message, revertido: false }, e.status);
    }
    return respuestaDeError(e);
  }
}
