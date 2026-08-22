# SCALABILITY_AUDIT

> Fases 16-20. Sin datos de tráfico reales → escenarios como SUPUESTOS.

## Escenarios (supuestos, no medidos)

Un car wash SaaS. Carga por naturaleza modesta por tenant:

| Escala | Empresas | Usuarios concurrentes | Supuesto |
|---|---|---|---|
| S (hoy) | 1-10 | 5-30 | operación real actual |
| M | ~100 | ~300 | crecimiento 12 meses |
| L | ~1.000 | ~3.000 | crecimiento 36 meses |

**El perfil de carga es bajo**: cajeros y operarios de lavaderos, no un
e-commerce con picos. La escritura caliente es el POS y el kanban.

## SCALE-001 — Connection pooling en serverless · **P1 / UNVERIFIED**

**El riesgo #1 de escalabilidad de este stack.** Vercel (funciones serverless) +
PostgreSQL sin pooling adecuado = cada invocación abre una conexión; con
concurrencia, se agota `max_connections` de Postgres. Funciona con 20 usuarios,
cae con 2.000 (Fase 18, textual).

**Estado:** la SPA habla con PostgREST (que sí poolea). Pero las funciones
`api/membego/*` y el webhook abren conexiones a Supabase por invocación. **No
verificado** que usen el pooler de Supabase (PgBouncer, puerto 6543) en lugar de
la conexión directa. → verificar la cadena de conexión en producción.

## Capacidad y cuellos de botella

- **Consultas calientes indexadas** (kanban): OK, Index Scan.
- **98 FKs sin índice** (DB-001): a escala M/L, los borrados en tablas padre y
  algunos JOINs se degradan. Es el cuello de botella de base de datos conocido.
- **Sin cache**: no hay Redis ni cache de aplicación. Para este perfil de carga
  **es correcto** — el catálogo se lee de Postgres y no es un cuello a escala S/M.
  No introducir cache sin medir (Fase 15/55).
- **Sin jobs asíncronos**: reportes y (eventual) envío masivo corren en el
  request. A escala S está bien; un reporte de margen sobre 100k facturas debería
  ir a un job. → P2 futuro, no bloqueante hoy.

## Backpressure (Fase 20 — UNVERIFIED)

No hay mecanismo de degradación controlada si entran operaciones más rápido de lo
que se procesan. Para el perfil de carga actual no es crítico; documentado como
hueco.

## Costo a escala (Fase 41 — no modelado)

No se modeló el costo por escala (Supabase + Vercel + MembeGo API). Para escala S
es trivial; a M/L habría que estimar. Pendiente.

## Estado tras Phase 5

Herramientas de carga y plan listos (`tests/load/`, SCALABILITY_PLAN.md,
LOAD_TEST_REPORT.md); presupuesto p95<800/p99<1500/err<1%. Falta correr contra
staging para números reales — hasta entonces la escala es UNVERIFIED.

## Veredicto de escala

**Hasta qué carga opera con SLO razonables: no medido (no hay load test).** Por
diseño soporta cómodamente la escala S actual. El paso a M/L está bloqueado por:
(1) verificar pooling, (2) indexar las FK calientes, (3) ejecutar load tests
reales. **No se puede declarar LEVEL 5 sin pruebas de carga** — y no las hay.
