import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Empuja una factura del car wash a Membego como TRANSACCIÓN (venta), para que
 * el comprobante quede también del lado de Membego, en la ficha del cliente y en
 * los informes del dueño.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO EL IMPORTE, NO EL DETALLE FISCAL
 *
 * Membego lleva la venta como un monto y una descripción, no el desglose NCF/
 * ITBIS —eso es del car wash y de la DGII, no de la fidelización—. El `externalId`
 * (el id de la factura) permite cruzar ambos sistemas sin duplicar el dato.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENTE POR FACTURA
 *
 * La clave se deriva de la factura (`cw-txn-<invoiceId>`): un reintento de red no
 * duplica la venta en los informes de Membego. Igual criterio que el canje.
 *
 * MONTO EN PESOS, NO EN CENTAVOS: Membego guarda `monto` como Decimal(10,2). El
 * car wash trabaja en centavos, así que aquí se divide entre 100 una sola vez.
 */

interface Cuerpo {
  /** Factura ya emitida. Clave de idempotencia y referencia cruzada. */
  invoiceId?: string;
  /** Total de la factura EN CENTAVOS (lo que guarda el car wash). */
  amountCents?: number;
  /** Descripción corta para el informe de Membego. */
  descripcion?: string;
  /** Cliente de Membego, para que la venta caiga en su ficha. */
  membegoCustomerId?: string | null;
  /** Sucursal de Membego, si se conoce. */
  membegoBranchId?: string | null;
}

interface RespuestaTransaccion {
  transactionId: string;
  codigo: string;
  ticketNumero: string;
  companyId: string;
  amount: number;
  recordedAt: string;
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
  const centavos = typeof cuerpo.amountCents === 'number' ? cuerpo.amountCents : NaN;

  if (!invoiceId || !Number.isFinite(centavos) || centavos < 0) {
    return json(
      { error: 'PETICION_INVALIDA', message: 'Faltan invoiceId o amountCents válido.' },
      400
    );
  }

  try {
    const txn = await llamar<RespuestaTransaccion>('/transactions', {
      metodo: 'POST',
      // Derivada de la factura: el reintento llega con la MISMA clave y Membego
      // no duplica la venta.
      claveIdempotencia: `cw-txn-${invoiceId}`,
      cuerpo: {
        companyId: COMPANY_ID,
        // Pesos, no centavos: Membego guarda Decimal(10,2).
        amount: Math.round(centavos) / 100,
        customerId: cuerpo.membegoCustomerId?.trim() || null,
        branchId: cuerpo.membegoBranchId?.trim() || null,
        description: cuerpo.descripcion?.trim() || 'Venta car wash',
        externalId: invoiceId,
      },
    });

    return json({ ok: true, transactionId: txn.transactionId, ticketNumero: txn.ticketNumero }, 200);
  } catch (e) {
    return respuestaDeError(e);
  }
}
