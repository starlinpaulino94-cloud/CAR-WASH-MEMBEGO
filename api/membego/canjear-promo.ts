import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion, ErrorMembego } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Canjear una PROMOCIÓN en Membego, DESPUÉS de haber facturado.
 *
 * Hermano de `canjear.ts` (que consume una membresía), pero para promociones.
 * Todo lo demás vale igual: el orden factura→canje, la clave de idempotencia
 * derivada de la factura y el fallo que se devuelve en vez de tragarse. Ver la
 * cabecera de `canjear.ts` para el porqué de cada una — aquí no se repite.
 *
 * La única diferencia real: la promoción se identifica por su `promotionId`, que
 * es el `id` que devolvió `/benefits/evaluate` (el de la compra/cupón del
 * cliente), no el de una membresía.
 */

interface Cuerpo {
  /** Factura ya emitida que este canje respalda. Es la clave de idempotencia. */
  invoiceId?: string;
  /** id de la promoción del cliente = el `id` de `/benefits/evaluate`. */
  promotionId?: string;
  /** Qué se le hizo al carro. Viaja al ticket de Membego. */
  servicio?: string;
  sucursalId?: string | null;
}

interface RespuestaCanje {
  redemptionId: string;
  promotion: string;
  usesLeft: number;
  consumed: boolean;
  redeemedAt: string;
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

  const invoiceId = cuerpo.invoiceId?.trim() ?? '';
  const promotionId = cuerpo.promotionId?.trim() ?? '';
  const servicio = cuerpo.servicio?.trim() ?? '';

  if (!invoiceId || !promotionId) {
    return json(
      { error: 'PETICION_INVALIDA', message: 'Faltan invoiceId o promotionId.' },
      400
    );
  }

  try {
    const canje = await llamar<RespuestaCanje>('/promotions/redeem', {
      metodo: 'POST',
      // Misma clave que el canje de membresía derivaría de esta factura, pero con
      // su propio prefijo: una factura puede consumir una membresía Y una promo,
      // y las dos idempotencias no pueden pisarse.
      claveIdempotencia: `cw-promo-${invoiceId}`,
      cuerpo: {
        companyId: COMPANY_ID,
        promotionId,
        servicio: servicio || undefined,
        branchId: cuerpo.sucursalId?.trim() || null,
        externalId: invoiceId,
      },
    });

    return json(
      {
        redemptionId: canje.redemptionId,
        promotion: canje.promotion,
        usesLeft: canje.usesLeft,
        consumed: canje.consumed,
        redeemedAt: canje.redeemedAt,
      },
      200
    );
  } catch (e) {
    if (e instanceof ErrorMembego) {
      return json({ error: e.codigo, message: e.message, canjeado: false }, e.status);
    }
    return respuestaDeError(e);
  }
}
