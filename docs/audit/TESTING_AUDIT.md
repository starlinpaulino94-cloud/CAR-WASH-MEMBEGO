# TESTING_AUDIT

> Fase 32-34. La cobertura existe pero no está cableada ni corre en CI.

## Lo que existe (bueno)

| Tipo | Cantidad | Evidencia |
|---|---|---|
| Pruebas SQL (unidad de reglas de negocio) | 28 archivos | `supabase/tests/*.sql` con helpers `test.check`, `test.expect_error` |
| E2E (flujos críticos, Playwright) | 6 suites, **250 comprobaciones** | `tests/e2e/*.e2e.mjs` |

Cubren lo que importa según la Fase 32: dinero, permisos (RLS), integridad,
flujos críticos (POS, factura, canje, kanban). **Es una base de pruebas seria,
poco habitual en un proyecto generado por IA.**

## TEST-001 — Las pruebas no están cableadas a `npm test` · **P1**

**Evidencia:** `package.json` scripts = `dev build preview clean lint db:types
db:push db:diff`. **No hay `test`.** Las suites e2e y SQL se ejecutan a mano con
scripts sueltos (`tests/e2e/reset.sh`, `supabase/tests/run.sh`). Un desarrollador
nuevo no sabe que existen ni cómo correrlas de un tirón.

**Impacto:** las pruebas que existen no protegen contra regresiones porque nada
las obliga a correr. Se pueden romper sin que nadie se entere.

**Solución:** añadir `"test"`, `"test:e2e"`, `"test:sql"` a package.json.

## TEST-002 — No hay CI · **P1**

**Evidencia:** `.github/workflows/` no existe. Ninguna prueba corre
automáticamente en push/PR. La Fase 28 exige como mínimo: install, lint,
typecheck, tests, build, security check.

**Impacto:** cada merge a `main` (que Vercel despliega solo) va a producción **sin
que se haya ejecutado ni una prueba ni el typecheck**. Un cambio que rompe el
build del POS llega a producción.

**Solución:** workflow que corra lint + `tsc --noEmit` + build + e2e + SQL +
`npm audit` en cada PR. Gate de merge.

## TEST-003 — Pruebas de concurrencia · ✅ HECHO (Phase 2)

> `supabase/tests/concurrency.sh`, 4/4, en CI. Ver BL-001.

La Fase 8 las declara obligatorias. No existen. Ver BL-001 (NCF, stock, bahía).

## TEST-004 — Contract tests con MembeGo · ✅ HECHO (Phase 3)

> `tests/api/membego-contrato.test.mjs` (6): timeout→503, caída→NO_DISPONIBLE,
> 4xx tal cual, 5xx→502, retry-una-vez del 401, no-bucle. Ver abajo.

La Fase 33 los pide para integraciones externas (pagos, webhooks). El canje, la
ficha y el webhook dependen del contrato de la API de MembeGo; si MembeGo cambia
un campo, se rompe en producción sin aviso. No hay prueba de contrato.

## TEST-005 — Failure testing · ✅ HECHO (Phase 3)

> Cubierto por los tests de contrato + idempotencia del webhook duplicado
> (50_membego_tests.sql: evento repetido no deja rastro ni segundo cliente).
> Ver abajo.

La Fase 34 pide probar el camino infeliz: MembeGo timeout, webhook duplicado,
respuesta inválida. El código maneja errores (los devuelve, no los traga), pero
**no hay pruebas** que ejerciten esos caminos.

## Advertencia metodológica importante

Las 250 comprobaciones e2e y las 28 pruebas SQL corren **contra el arnés local
(PostgreSQL 5433 + PostgREST), no contra Supabase de producción.** Prueban la
lógica (migraciones, RLS, RPC), que es idéntica. **No** prueban: configuración
real de Supabase, GoTrue de producción, ni las funciones serverless de Vercel
(que no tienen ninguna prueba). Por eso los flujos MembeGo end-to-end están
marcados WORKING-en-lógica pero el despliegue serverless es UNVERIFIED.
