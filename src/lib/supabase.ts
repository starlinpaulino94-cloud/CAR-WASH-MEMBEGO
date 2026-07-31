import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

/**
 * Cliente de Supabase, tipado contra el esquema real.
 *
 * Sobre las claves: la `anon key` está diseñada para viajar en el bundle del
 * navegador. No es un secreto — lo que protege los datos es Row-Level Security
 * (supabase/migrations/..._rls_policies.sql), no la ocultación de esta clave.
 * La `service_role` sí es un secreto y NUNCA debe aparecer en código de cliente:
 * se salta RLS por completo.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Falla de forma explícita y temprana si falta configuración, en lugar de
 * dejar que un `undefined` se propague hasta un error incomprensible en medio
 * de un cobro.
 */
function createSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) {
    if (import.meta.env.DEV) {
      console.warn(
        '[supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
          'La aplicación sigue funcionando contra el almacenamiento local. ' +
          'Copie .env.example a .env.local para conectar la base de datos.'
      );
    }
    return null;
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // El token se renueva solo; sin esto, un turno de 8 horas terminaría
      // con la sesión caducada en mitad de la operación.
      detectSessionInUrl: true,
      storageKey: 'membego_cw_auth'
    },
    global: {
      headers: { 'x-application-name': 'membego-car-wash' }
    }
  });
}

export const supabase = createSupabaseClient();

/**
 * Acceso al cliente allí donde su ausencia es un error de programación.
 * Evita repetir comprobaciones de null en cada consulta.
 */
export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Defina VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}
