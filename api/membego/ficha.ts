import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Ficha de Membego de un cliente: sus vehículos y qué beneficios tiene AHORA.
 *
 * Una sola llamada desde el mostrador y dos hacia Membego, en paralelo. Podrían
 * ser dos llamadas desde el navegador, pero entonces la recepción vería
 * aparecer el vehículo y la membresía en momentos distintos, y con mala red
 * una de las dos se queda a medias sin que nadie sepa cuál.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS VEHÍCULOS SE PIDEN, LOS BENEFICIOS SE PREGUNTAN
 *
 * `GET /vehicles` es una proyección: se puede copiar y pintar. `/benefits/
 * evaluate` NO se proyecta nunca —lo dice el propio contrato de Membego— porque
 * decide dinero, y una copia desfasada regala un beneficio ya consumido. Por
 * eso este borde no guarda nada de lo que devuelve.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SI MEMBEGO NO CONTESTA, EL CARRO ENTRA IGUAL
 *
 * Esta función devuelve el error con su código, y la pantalla que la llama lo
 * enseña como un aviso al lado del cliente — no como un fallo que impida
 * registrar la llegada. Un lavadero no puede dejar de trabajar porque un
 * servicio de fidelización esté caído.
 */

interface Cuerpo {
  /** `customers.membego_customer_id` del cliente elegido en el mostrador. */
  membegoCustomerId?: string;
  /** Placa del carro que llegó, para saber si la membresía LO cubre. */
  plate?: string | null;
  /** Nivel tarifario de su categoría, si el car wash lo tiene configurado. */
  vehicleLevel?: number | null;
}

interface VehiculoMembego {
  id: string;
  customerId: string;
  placa: string | null;
  marca: string;
  modelo: string;
}

interface Cobertura {
  vehicleLevelMax: number | null;
  unlimited: boolean;
  washesIncluded: number;
  vehicles: { vehiculoId: string; placa: string | null; nivelTarifario: number }[];
  covers: boolean | null;
  reason: string | null;
}

/** Efecto monetario de una promoción; solo lo traen las promociones. */
type EfectoPromocion =
  | { kind: 'PERCENT'; value: number; label: string }
  | { kind: 'AMOUNT'; amountCents: number; label: string }
  | { kind: 'FREE'; label: string }
  | { kind: 'NONE'; label: string };

interface Beneficio {
  type: 'MEMBERSHIP' | 'PROMOTION';
  id: string;
  nombre: string;
  eligible: boolean;
  usesLeft: number;
  expiresAt: string | null;
  reason: string | null;
  coverage: Cobertura | null;
  effect?: EfectoPromocion;
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

  const customerId = cuerpo.membegoCustomerId?.trim() ?? '';
  if (!customerId) {
    return json({ error: 'PETICION_INVALIDA', message: 'Falta membegoCustomerId.' }, 400);
  }

  // La placa se normaliza aquí y no en el navegador: el contrato de Membego
  // pide la placa normalizada, y dejar esa responsabilidad en el cliente
  // significa que cualquier pantalla nueva puede olvidarla y romper la
  // comparación sin que nada avise.
  const placa = cuerpo.plate ? cuerpo.plate.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;

  try {
    const [vehiculos, beneficios] = await Promise.all([
      llamar<{ vehicles: VehiculoMembego[] }>(
        `/vehicles?companyId=${encodeURIComponent(COMPANY_ID)}&customerId=${encodeURIComponent(customerId)}`
      ),
      llamar<{ benefits: Beneficio[]; eligible: boolean; evaluatedAt: string }>(
        '/benefits/evaluate',
        {
          metodo: 'POST',
          cuerpo: {
            companyId: COMPANY_ID,
            customerId,
            // Solo se manda contexto si hay algo que preguntar. Un contexto
            // vacío haría que Membego respondiera `covers: null` igual, pero
            // mandarlo sugiere que se preguntó y no se obtuvo respuesta.
            ...(placa || cuerpo.vehicleLevel != null
              ? { context: { plate: placa, vehicleLevel: cuerpo.vehicleLevel ?? null } }
              : {}),
          },
        }
      ),
    ]);

    const membresias = beneficios.benefits.filter((b) => b.type === 'MEMBERSHIP');
    const promociones = beneficios.benefits.filter((b) => b.type === 'PROMOTION');

    return json(
      {
        vehicles: vehiculos.vehicles,
        memberships: membresias,
        promotions: promociones,
        /** Cuándo lo dijo Membego. Una respuesta guardada envejece. */
        evaluatedAt: beneficios.evaluatedAt,
      },
      200
    );
  } catch (e) {
    return respuestaDeError(e);
  }
}
