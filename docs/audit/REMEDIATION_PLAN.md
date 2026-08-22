# REMEDIATION_PLAN

> Fase 52. Orden por riesgo. No empezar por lo cosmético mientras haya P0.
> Remediación **por piezas**: cada una lleva especificación → implementación →
> prueba → revisión independiente. No hay big-bang rewrite (no hace falta: la
> arquitectura es sana).

## Phase 0 — Bloqueadores de seguridad / datos (P0) · ✅ HECHO

1. **SEC-001 — Autenticar los 4 endpoints de MembeGo.** ✅ **Remediado.**
   - Guard único `api/_membego/auth.ts` (`exigirEmpleado`) invocado por los 4
     bordes antes de tocar Membego. Valida el JWT de Supabase vía `/auth/v1/user`
     y exige rol de mostrador + `is_active` leyendo `profiles` bajo RLS.
   - El cliente envía el token de sesión (`encabezadosMembego` en
     `src/lib/supabase.ts`), cableado en los 4 call sites.
   - Nueva variable en Vercel: `SUPABASE_ANON_KEY` (no secreta).
   - Test: `tests/api/auth-membego.test.mjs` — 8 unidad + 4 source-check = 12/12.
     Las 250 e2e siguen verdes. Ver ADR-004.
   - Revisión independiente: security-review sobre el diff (segundo agente).

## Phase 1 — Infraestructura de confianza (P1) · ✅ HECHO

2. **TEST-001/002 — Cablear pruebas + CI.** ✅
   - `npm test` = `typecheck` + `test:api` (rápido, sin dependencias externas);
     además `test:sql` y `test:e2e` (con `tests/e2e/run-all.sh`). `tsx` añadido
     como devDep.
   - Workflow `.github/workflows/ci.yml`: job **core** (typecheck+build+api+audit)
     y job **sql** (Postgres 16 de servicio, 45 migraciones + 701 pruebas). En
     cada push y PR. `npm audit` incluido (cubre DEP-002/SEC-002).
   - `run.sh` ahora respeta `PGHOST` (socket local / TCP en CI).
3. **OBS-001 — Observabilidad mínima.** ✅ (parcial, ver OBSERVABILITY.md)
   - Logger estructurado JSON en los bordes (`api/_lib/log.ts`), conectado en el
     manejo de fallos. `src/lib/observabilidad.ts` + enganche global en
     `main.tsx` + ErrorBoundary. Destino de monitoreo por `VITE_ERROR_REPORT_URL`
     (enganche listo; sin añadir el SDK de Sentry). Sin PII.
   - Follow-up: correlación de petición extremo a extremo, métricas, alertas.
4. **SCALE-001 — Verificar pooling.** ✅ → **informativo.**
   - Evidencia: 0 clientes `pg` crudos; todo el acceso va por HTTP a
     PostgREST/GoTrue, que poolea del lado de Supabase. El modo de fallo temido
     (agotar conexiones) no aplica. Queda medir con carga real (Phase 5).

## Phase 2 — Lógica crítica y datos (P2) · ✅ HECHO

5. **BL-001/TEST-003 — Pruebas de concurrencia.** ✅ `supabase/tests/concurrency.sh`:
   abre transacciones solapadas reales. Los candados YA eran correctos (NCF y
   bahía con FOR UPDATE, stock serializado por row-lock); ahora está demostrado.
   4/4: NCF distintos, secuencia +2 exacta, una sola orden por bahía, stock sin
   lost update. Cableado a `npm run test:concurrency` y CI.
6. **DB-001 — Indexar las FK de las tablas calientes.** ✅ Migración
   `20260821120000_indices_fk_calientes.sql`: 15 índices sobre
   inventory_movements, invoice_items, commissions, work_order_items,
   payroll_items, audit_logs y appointments. Justificación estructural (JOIN de
   vista + borrado de padre), no las 98. Reejecutable (IF NOT EXISTS).
7. **DB-002 — Snapshots históricos.** ✅ Verificado: invoice_items congela
   nombre+precio, commissions congela tasa(bps)+importe, work_order_items
   congela precio, invoices congela ITBIS. Prueba nueva en 20_billing_tests.sql:
   cambiar el catálogo tras facturar NO altera la línea emitida (703/703).

## Phase 3 — Fiabilidad de integraciones (P2) · ✅ HECHO

8. **TEST-004/005 — Contract + failure testing.** ✅
   - **Arreglo de fiabilidad:** las llamadas a Membego ahora tienen TIMEOUT
     (AbortController, 8s configurable por `MEMBEGO_TIMEOUT_MS`). Antes no había
     techo: un Membego colgado dejaba la función abierta hasta el límite de
     plataforma (Fase 13). Al vencer → NO_DISPONIBLE (503), reintentable.
   - **Contract/failure tests** (`tests/api/membego-contrato.test.mjs`, 6):
     timeout, caída de red, 4xx tal cual, 5xx→502, retry-una-vez del 401 sin
     bucle.
   - **Webhook duplicado**: ya era idempotente (guard por event_id que corta
     antes de cualquier efecto); reforzada la prueba en 50_membego_tests.sql
     (no deja rastro ni segundo cliente).

## Phase 4 — Recuperación (P2/P3) · ✅ MECANISMO PROBADO

9. **Restore test.** ✅ `supabase/tests/restore.sh`: ciclo pg_dump→pg_restore
   verificado (56 tablas, 124 políticas, 196 funciones, 217 índices, datos, y
   RLS FORCE preservada). Runbook completo en DISASTER_RECOVERY.md. El simulacro
   contra el backup REAL de producción queda para el dueño (staging).
10. **Rollback.** ✅ Documentado en DISASTER_RECOVERY.md: Instant Rollback de
   Vercel + `git revert`. El CI (Phase 1) hace raro que un build roto llegue a
   main. Un simulacro real lo hace el dueño.

## Phase 5 — Rendimiento a escala (cuando se acerque M)

11. Load / stress / spike / soak tests con presupuesto de performance definido
    (p50/p95/p99, error rate). Requisito para declarar LEVEL 5.

## Phase 6 — Limpieza (P3/P4)

12. Justificar/retirar los 5 `@ts-*`; `any`→`unknown` en el tipo de log;
    confirmar si `PhaseArchitectureReportModal` es código muerto y documentarlo.

## Regla de causa raíz

SEC-001 es **una** causa (asumir confianza en funciones públicas), no cuatro
bugs: se arregla en un solo lugar (un helper de autenticación reutilizado por los
4 endpoints), no parcheando cada uno por separado.
