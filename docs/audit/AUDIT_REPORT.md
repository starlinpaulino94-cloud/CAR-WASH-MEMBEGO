# AUDIT_REPORT — Membego Car Wash Operations

> Auditoría de producción. Commit `main` @ `642776d`. Evidencia: código, esquema
> vivo (arnés PostgreSQL 16 con las 45 migraciones), suite de pruebas, `npm audit`.
> Todo lo no comprobable desde este entorno está marcado **UNVERIFIED**, no PASS.

## Hallazgos por severidad

### P0 — CRITICAL (1)

**SEC-001 · Endpoints serverless de MembeGo sin autenticación de usuario**
- **Archivos:** `api/membego/ficha.ts`, `canjear.ts`, `revertir.ts`, `tipos-vehiculo.ts`
- **Problema:** no verifican JWT ni rol del usuario. `grep getUser|Bearer|verifyJwt` → 0.
- **Exploit:** `POST /api/membego/ficha {telefono}` expone PII de clientes; `/canjear` y `/revertir` manipulan lavados de membresía. Público con solo la URL.
- **Mitigante:** `companyId` server-side → sin fuga cross-tenant (solo clientes de esta empresa).
- **Impacto:** exposición de datos personales + manipulación de un activo.
- **Causa raíz:** se asumió que solo la propia SPA llamaría; una función pública no puede confiar sin verificar.
- **Solución:** exigir `Authorization: Bearer` (JWT Supabase) + rol mínimo en los 4 endpoints; 401 si falta.
- **Riesgo de migración:** bajo (añadir verificación; el POS ya tiene sesión).

### P1 — HIGH (4)

| ID | Título | Evidencia | Solución |
|---|---|---|---|
| TEST-002 | Sin CI: `main` se despliega sin correr pruebas ni typecheck | `.github/workflows` no existe | Workflow: lint+tsc+build+e2e+sql+audit, gate de PR |
| TEST-001 | Pruebas no cableadas a `npm test` | scripts: sin `test` | Añadir `test`/`test:e2e`/`test:sql` |
| OBS-001 | Cero observabilidad | grep sentry/pino/tracing vacío | Error monitoring + logs estructurados con request_id/user_id |
| SCALE-001 | Pooling de conexiones en serverless sin verificar | funciones abren conexión por invocación | Verificar uso del pooler de Supabase (6543) — **UNVERIFIED** |

### P2 — MEDIUM (6)

| ID | Título | Evidencia |
|---|---|---|
| DB-001 | 98 FKs sin índice líder (indexar solo las ~8 tablas calientes) | catálogo pg |
| BL-001 | Race conditions no probadas (NCF, stock, bahía) | sin pruebas de concurrencia |
| TEST-003 | Faltan pruebas de concurrencia | Fase 8 |
| TEST-004 | Faltan contract tests con MembeGo | Fase 33 |
| TEST-005 | Failure testing incompleto (timeout/webhook duplicado) | Fase 34 |
| DEP-002 | Sin escaneo de dependencias en CI | — |
| DB-002 | Cobertura de snapshots históricos sin verificar del todo | UNVERIFIED |

### P3 / P4 — LOW / IMPROVEMENT

| ID | Título |
|---|---|
| SEC-002 / DEP-001 | nanoid<3.3.18 (dev-only, transitivo) → `npm audit fix` |
| AI-DEBT-001 | Duplicación controlada de la cobertura (preview vs. autoridad) |
| AI-DEBT-002 | 5 supresiones `@ts-*`/`eslint-disable` por justificar |
| AI-DEBT-003 | `any` en tipo de log |

## Fortalezas verificadas (no todo es hallazgo)

- **Aislamiento multi-tenant completo:** 56/56 tablas RLS ENABLE+FORCE; 124 políticas.
- **60/60 funciones SECURITY DEFINER con `search_path` fijo** — 0 escalables.
- **Dinero en centavos enteros** — 0 columnas flotantes.
- **Idempotencia del canje** derivada de la factura — correcta.
- **Transacciones atómicas** vía RPC único.
- **0 datos mock, 0 catch silencioso, 0 secretos expuestos.**
- **Webhook con HMAC timing-safe**, firma antes de escribir.
- **250 comprobaciones e2e + 28 pruebas SQL** cubriendo dinero/permisos/flujos.
