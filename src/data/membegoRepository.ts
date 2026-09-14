import { encabezadosMembego, requireSupabase } from '../lib/supabase';

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
  /** 'production' | 'preview' | 'development'. Vacío si no se pudo saber. */
  entorno?: string;
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

// ───────────────────────────────── Qué lavado incluye cada plan

export interface PlanConCobertura {
  plan_name: string;
  /** Cuántos clientes del local tienen ese plan. Ordena la atención. */
  clientes: number;
  service_id: string | null;
  service_name: string | null;
  is_active: boolean;
}

/**
 * Los planes que este local ha visto, con su lavado incluido si lo tiene.
 *
 * Salen de las membresías que llegaron por el webhook, no de una lista escrita
 * a mano: un nombre de plan mal tecleado no casa con nada, y el fallo aparece
 * días después en la caja sin pista de dónde mirar.
 */
export async function fetchPlanesMembego(): Promise<PlanConCobertura[]> {
  const { data, error } = await requireSupabase().rpc('membego_planes_con_cobertura');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlanConCobertura[];
}

/** Asigna —o quita, con `serviceId` nulo— el lavado que incluye un plan. */
export async function asignarLavadoDelPlan(
  planName: string,
  serviceId: string | null
): Promise<void> {
  const supabase = requireSupabase();
  const { data: empresa } = await supabase.from('profiles')
    .select('company_id').limit(1).maybeSingle();
  const companyId = (empresa as { company_id?: string } | null)?.company_id;
  if (!companyId) throw new Error('No se pudo determinar la empresa.');

  if (serviceId === null) {
    const { error } = await supabase.from('membego_plan_coberturas')
      .delete().eq('plan_name', planName);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from('membego_plan_coberturas')
    .upsert({ company_id: companyId, plan_name: planName, service_id: serviceId, is_active: true },
            { onConflict: 'company_id,plan_name' });
  if (error) throw new Error(error.message);
}

/**
 * Lo que la caja necesita: del nombre del plan al lavado que incluye y su
 * precio EN LA CATEGORÍA del vehículo que está en el mostrador.
 */
export async function fetchCoberturasDePlan(): Promise<Map<string, { servicio: string; serviceId: string }>> {
  const { data, error } = await requireSupabase()
    .from('membego_plan_coberturas')
    .select('plan_name, service_id, services(name)')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  const mapa = new Map<string, { servicio: string; serviceId: string }>();
  for (const fila of (data ?? []) as unknown as
       { plan_name: string; service_id: string; services: { name: string } | null }[]) {
    mapa.set(fila.plan_name.trim().toLowerCase(),
             { servicio: fila.services?.name ?? 'su lavado', serviceId: fila.service_id });
  }
  return mapa;
}
