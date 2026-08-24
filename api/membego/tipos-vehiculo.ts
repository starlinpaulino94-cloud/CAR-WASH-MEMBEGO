import { llamar, json, respuestaDeError, COMPANY_ID, faltaConfiguracion } from '../_membego/cliente.js';
import { exigirEmpleado, respuestaDeAuth } from '../_membego/auth.js';

/**
 * Los tipos de vehículo de Membego con su nivel tarifario.
 *
 * Para qué: la tabla de niveles de Configuración pedía teclear ocho números que
 * el usuario no tenía de dónde sacar. Los niveles los define Membego, y un
 * número que allá no existe no casa con nada — el mostrador cobraría mal para
 * siempre y el cliente solo vería «no cubierto», sin explicación posible.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO SÍ SE PUEDE PINTAR
 *
 * Es catálogo, no saldo. A diferencia de `/benefits/evaluate` —que no se copia
 * nunca porque decide dinero— aquí lo que llega es «en Membego, la jeepeta es
 * nivel 2», que cambia cuando alguien lo cambia a mano y no con cada lavado.
 *
 * Aun así no se guarda en nuestra base: se enseña al lado de las casillas para
 * que el dueño mapee mirando, y la decisión de qué nivel poner en cada categoría
 * sigue siendo suya. Copiar el catálogo de Membego a nuestras tablas crearía dos
 * verdades que se separan el día que él cambie un nivel allá.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * GET Y NO POST
 *
 * No lleva cuerpo ni identificador de nadie: es el catálogo de la propia empresa
 * que pregunta. El resto de bordes son POST porque mandan datos del cliente que
 * está en el mostrador; este no manda nada.
 */

interface TipoVehiculoMembego {
  id: string;
  nombre: string;
  nivelTarifario: number;
}

export async function GET(request: Request): Promise<Response> {
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

  try {
    const datos = await llamar<{ vehicleTypes: TipoVehiculoMembego[] }>(
      `/vehicle-types?companyId=${encodeURIComponent(COMPANY_ID)}`,
      { metodo: 'GET' }
    );

    const tipos = datos.vehicleTypes ?? [];

    return json(
      {
        vehicleTypes: tipos,
        /*
         * Se manda calculado y no se deja para la pantalla: es la diferencia
         * entre «hay niveles» y «los niveles no están diferenciados», y de ella
         * depende que el aviso diga la verdad. Con todos en 1, cualquier plan
         * cubre cualquier vehículo y no hay diferencia que cobrar.
         */
        sinDiferenciar: tipos.length > 0 && tipos.every(t => t.nivelTarifario === 1)
      },
      200
    );
  } catch (e) {
    return respuestaDeError(e);
  }
}
