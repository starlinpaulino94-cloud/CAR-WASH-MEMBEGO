/// <reference types="vite/client" />

/**
 * Variables de entorno declaradas explícitamente.
 *
 * Sin esto, `import.meta.env.LO_QUE_SEA` sería `any` y una errata en el nombre
 * de una variable pasaría desapercibida hasta fallar en producción.
 */
interface ImportMetaEnv {
  /** URL del proyecto Supabase. Pública. */
  readonly VITE_SUPABASE_URL: string;
  /** Clave anónima. Pública por diseño: lo que protege los datos es RLS. */
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
