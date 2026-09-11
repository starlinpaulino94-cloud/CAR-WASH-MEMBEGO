import { encabezadosMembego } from '../lib/supabase';

/**
 * El diagnóstico de la integración con Membego, del lado del navegador.
 *
 * Vive en su propio archivo y no en `customersRepository` porque no habla de
 * clientes: habla del despliegue. Lo llaman dos pantallas muy distintas —la
 * caja, cuando al cajero le falla algo, y Ajustes → Membego— y las dos tienen
 * que ver exactamente el mismo informe.
 */

export type EstadoPaso = 'ok' | 'falla' | 'aviso' | 'omitido';

export interface PasoDiagnostico {
  clave: string;
  titulo: string;
  estado: EstadoPaso;
  detalle: string;
  arreglo?: string;
}

export interface DiagnosticoMembego {
  pasos: PasoDiagnostico[];
  ok: boolean;
  resumen: string;
  apiMembego: string;
}

/**
 * Corre el diagnóstico CON LA SESIÓN DE QUIEN LO PIDE.
 *
 * Eso no es un detalle de implementación: dos de las comprobaciones (el rol y
 * la lectura del vínculo bajo RLS) dependen de quién llama. Si el dueño corre
 * el diagnóstico para averiguar por qué le falla al cajero, obtiene el
 * diagnóstico del dueño, que suele estar verde. Por eso el botón está donde el
 * fallo se ve, y lo pulsa quien lo sufre.
 *
 * `membegoCustomerId` es opcional: con él se prueba además la llamada de
 * verdad contra Membego, que es la única que reproduce el fallo del mostrador.
 */
export async function diagnosticarMembego(
  membegoCustomerId?: string | null
): Promise<DiagnosticoMembego> {
  const res = await fetch('/api/membego/diagnostico', {
    method: 'POST',
    headers: await encabezadosMembego({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      // Se manda el proyecto de Supabase que usa ESTE bundle para que el
      // servidor lo compare con el suyo. Cuando no coinciden, todas las
      // sesiones son «inválidas» y nada más en el sistema lo delata.
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? null,
      membegoCustomerId: membegoCustomerId ?? null
    })
  }).catch(() => null);

  if (!res) {
    throw new Error('No se pudo contactar con el servidor para diagnosticar.');
  }

  const body = (await res.json().catch(() => null)) as DiagnosticoMembego | null;
  if (!body || !Array.isArray(body.pasos)) {
    // Un borde que no responde el informe es, en sí mismo, un hallazgo: quiere
    // decir que las funciones de `api/` no están desplegadas.
    throw new Error(
      `El servidor respondió ${res.status} sin informe. ` +
        'Suele significar que las funciones de /api no están desplegadas en este entorno.'
    );
  }
  return body;
}
