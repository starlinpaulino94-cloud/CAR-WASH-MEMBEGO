# ADR-001 — La lógica de negocio y la autorización viven en la base de datos

## Estado
Aceptada (decisión ya materializada en el código; documentada retroactivamente en la auditoría).

## Contexto
SaaS multi-tenant sobre Supabase (PostgreSQL + PostgREST + GoTrue). Hay que
decidir dónde vive la regla de negocio y la frontera de seguridad.

## Decisión
La autorización es **RLS en la base** (ENABLE+FORCE en las 56 tablas). La lógica
crítica (facturar, anular, cancelar orden, canjear) son **funciones PL/pgSQL
(RPC) SECURITY DEFINER con search_path fijo**, llamadas desde el cliente. Los
gates de `src/lib/auth.ts` son solo UX, no seguridad.

## Consecuencias
- (+) Una sola frontera de seguridad, imposible de saltar desde el cliente.
- (+) Atomicidad gratis (cada RPC es una transacción).
- (+) Portable: es PostgreSQL estándar.
- (−) La lógica en SQL es menos accesible para desarrolladores solo-JS.
- (−) Acopla a PostgreSQL (aceptable; ver DEPENDENCY_AUDIT).
