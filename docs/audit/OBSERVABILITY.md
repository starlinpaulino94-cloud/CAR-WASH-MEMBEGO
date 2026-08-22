# OBSERVABILITY — estado tras Phase 1

> Cierra parcialmente OBS-001. Antes: cero observabilidad (solo `console.error`
> suelto). Ahora: logs estructurados en los bordes y reporte de errores del
> frontend con enganche de monitoreo.

## Lo que hay ahora

### Bordes serverless (`api/`)
- `api/_lib/log.ts` — logger estructurado. Cada evento sale como **una línea
  JSON** con `requestId`, `ruta`, `evento`, `status`, `durationMs`, sin datos
  personales del cliente. Vercel captura stdout/stderr y lo indexa: se puede
  filtrar por `requestId` o por `evento`.
- Conectado en `respuestaDeError` (cliente Membego): todo fallo de un borde
  —error de Membego o inesperado— queda registrado con su código y status.

### Frontend (`src/`)
- `src/lib/observabilidad.ts` — `reportarError(error, contexto)`: log JSON en
  consola siempre, y reenvío a `VITE_ERROR_REPORT_URL` si está definida
  (best-effort, `keepalive`, nunca lanza). Sin PII.
- `engancharErroresGlobales()` en `main.tsx`: captura promesas rechazadas sin
  catch y errores fuera del árbol de React (lo que el ErrorBoundary no ve).
- `ErrorBoundary` ahora reporta estructurado con `componentStack` recortado.

## El enganche de Sentry (deliberadamente NO incluido)

No se añadió el SDK de Sentry ni ninguna dependencia de monitoreo: sería
vaporware sin un DSN y una decisión de proveedor. En su lugar queda el punto de
conexión (`VITE_ERROR_REPORT_URL` en el front; el logger JSON en el back, que
cualquier drain de Vercel recoge). El día que se elija destino, se conecta ahí
sin reescribir nada.

## Lo que falta (honesto, follow-up)

- **Correlación de petición extremo a extremo**: hoy cada evento lleva su propio
  `requestId`; el log de auth y el de la llamada a Membego de UNA misma petición
  no comparten id todavía. Falta hilar un `requestId` desde el handler.
- **Métricas y tracing** (Fase 21): no hay. Solo logs de error.
- **Alertas** (Fase 21): no hay; dependen de conectar el destino de monitoreo.

## SCALE-001 — actualización con evidencia (buena noticia)

La auditoría temía agotamiento de conexiones (serverless + Postgres sin pooling).
**Evidencia nueva:** `grep` de `pg`/`DATABASE_URL`/`new Pool`/`postgres://` en
`api/` y `src/` → **0**. TODO el acceso a datos (funciones y SPA) va por **HTTP a
PostgREST/GoTrue** (`/rest/v1`, `/auth/v1`, `supabase-js`), que poolea del lado
de Supabase. **No hay conexiones crudas de PostgreSQL que agotar**, así que el
riesgo de pool-exhaustion es mucho menor de lo previsto. SCALE-001 baja de P1 a
informativo: sigue pendiente medir con carga real (Phase 5), pero el modo de
fallo que se temía no aplica a esta arquitectura.
