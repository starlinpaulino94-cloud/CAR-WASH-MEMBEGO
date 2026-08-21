# REMEDIATION_PLAN

> Fase 52. Orden por riesgo. No empezar por lo cosmético mientras haya P0.
> Remediación **por piezas**: cada una lleva especificación → implementación →
> prueba → revisión independiente. No hay big-bang rewrite (no hace falta: la
> arquitectura es sana).

## Phase 0 — Bloqueadores de seguridad / datos (P0)

1. **SEC-001 — Autenticar los 4 endpoints de MembeGo.**
   - Spec: exigir `Authorization: Bearer <jwt supabase>`; validar y comprobar
     rol ≥ cajero; 401 si falta o no es válido.
   - Test: `POST` sin token → 401; con token de cajero → 200; e2e del POS sigue verde.
   - Revisión independiente: `/security-review` o segundo modelo sobre el diff.
   - Esfuerzo: ~medio día.

## Phase 1 — Infraestructura de confianza (P1)

2. **TEST-001/002 — Cablear pruebas + CI.**
   - `npm test` → lint + `tsc --noEmit` + build + e2e + sql.
   - Workflow GitHub Actions en cada PR; gate de merge a `main`.
   - Incluir `npm audit` (cierra DEP-002 y SEC-002).
3. **OBS-001 — Observabilidad mínima.**
   - Error monitoring (p. ej. Sentry) en la SPA y en las funciones `api/`.
   - Logs estructurados con `request_id`, `user_id`, `company_id`, operación,
     duración, resultado — sin PII.
4. **SCALE-001 — Verificar pooling.**
   - Confirmar que las funciones usan el pooler de Supabase (6543). Corregir la
     cadena de conexión si van directas.

## Phase 2 — Lógica crítica y datos (P2)

5. **BL-001/TEST-003 — Pruebas de concurrencia:** NCF, stock, última bahía (2
   sesiones simultáneas). Corregir el candado si alguna falla.
6. **DB-001 — Indexar las FK de las ~8 tablas calientes** (invoice_items,
   inventory_movements, cash_movements, commissions, work_order_items,
   audit_logs…), justificadas por EXPLAIN. Una migración. NO las 98.
7. **DB-002 — Verificar snapshots históricos** (precio/ITBIS/comisión/tasa/término).

## Phase 3 — Fiabilidad de integraciones (P2)

8. **TEST-004/005 — Contract tests con MembeGo + failure testing** (timeout,
   webhook duplicado, respuesta inválida).

## Phase 4 — Recuperación (P2/P3)

9. **Restore test** de Supabase; documentar RPO/RTO, frecuencia, retención
   (DATABASE_AUDIT / Fase 25). Un backup sin restore probado no cuenta.
10. **Rollback probado** en Vercel (Fase 29).

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
