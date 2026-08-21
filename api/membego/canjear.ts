import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion, ErrorMembego } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Consumir el beneficio en Membego, DESPUÉS de haber facturado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN NO ES CASUAL
 *
 * Son dos sistemas y no hay transacción que abarque a los dos: uno de los pasos
 * queda primero y el otro puede fallar. La pregunta real es quién paga ese
 * error.
 *
 *   · Canjear primero — si falla la factura, el cliente perdió un lavado y no
 *     tiene comprobante. Perdió él, y no tiene cómo enterarse.
 *   · Facturar primero — si falla el canje, el cliente tiene su factura con el
 *     lavado descontado y su lavado sigue en el saldo. Perdió el negocio, sabe
 *     cuánto, y se puede reintentar.
 *
 * Se eligió el segundo, y por eso esta función recibe una factura que YA
 * existe. Un error que solo cuesta dinero al negocio y se puede reparar es
 * preferible a uno que se lo cobra al cliente en silencio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CLAVE DE IDEMPOTENCIA ES LA FACTURA
 *
 * No se inventa un UUID por intento: se deriva del identificador de la factura,
 * que es estable. Así el reintento de un cajero impaciente —o de la red— llega
 * a Membego con la MISMA clave y no consume dos lavados. Una clave nueva por
 * intento haría que la idempotencia de Membego no sirviera para nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN FALLO SE DEVUELVE, NO SE TRAGA
 *
 * Si Membego rechaza el canje, esta función responde con el motivo para que la
 * pantalla lo anote como `fallido` en la factura. Una factura cubierta cuyo
 * canje no se confirmó es un hecho que hay que poder ver y reintentar, no algo
 * que se pierde en un log del servidor.
 */

interface Cuerpo {
  /** Factura ya emitida que este canje respalda. Es la clave de idempotencia. */
  invoiceId?: string;
  membershipId?: string;
  /** Qué se le hizo al carro. Viaja al ticket de Membego. */
  servicio?: string;
  vehiculoId?: string | null;
  sucursalId?: string | null;
  notas?: string | null;
}

interface RespuestaCanje {
  redemptionId: string;
  visitId: string;
  codigo: string;
  ticketNumero: string;
  customerId: string;
  companyId: string;
  servicio: string;
  usesLeft: number | null;
  unlimited: boolean;
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
  const membershipId = cuerpo.membershipId?.trim() ?? '';
  const servicio = cuerpo.servicio?.trim() ?? '';

  if (!invoiceId || !membershipId || !servicio) {
    return json(
      { error: 'PETICION_INVALIDA', message: 'Faltan invoiceId, membershipId o servicio.' },
      400
    );
  }

  try {
    const canje = await llamar<RespuestaCanje>('/redemptions', {
      metodo: 'POST',
      // Derivada de la factura y no inventada por intento: así el reintento
      // llega con la MISMA clave y Membego no consume dos lavados.
      claveIdempotencia: `cw-inv-${invoiceId}`,
      cuerpo: {
        companyId: COMPANY_ID,
        membershipId,
        servicio,
        vehiculoId: cuerpo.vehiculoId?.trim() || null,
        sucursalId: cuerpo.sucursalId?.trim() || null,
        notas: cuerpo.notas?.trim() || null,
      },
    });

    return json(
      {
        visitId: canje.visitId,
        redemptionId: canje.redemptionId,
        usesLeft: canje.usesLeft,
        unlimited: canje.unlimited,
        redeemedAt: canje.redeemedAt,
      },
      200
    );
  } catch (e) {
    // El fallo viaja con su motivo para que la pantalla lo anote en la factura.
    // Tragárselo aquí dejaría una factura que dice «cubierto» y una membresía
    // que nunca se enteró, sin rastro de por qué.
    if (e instanceof ErrorMembego) {
      return json({ error: e.codigo, message: e.message, canjeado: false }, e.status);
    }
    return respuestaDeError(e);
  }
}
