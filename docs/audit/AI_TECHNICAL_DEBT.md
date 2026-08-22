# AI_TECHNICAL_DEBT

> Fase 35-36. Patrones típicos de "vibe coding" — buscados agresivamente.

## Veredicto: deuda de IA BAJA para el origen del proyecto

Este proyecto fue construido con asistencia de IA, pero **no exhibe los
síntomas graves** del vibe coding. La búsqueda dirigida encontró poco:

| Patrón buscado | Resultado |
|---|---|
| `mock` / `fake` / `dummy` / `Math.random` / datos hardcoded | **0 reales** |
| `catch {}` / catch que solo hace `console.log` | **0** |
| `@ts-ignore` / `@ts-expect-error` / `eslint-disable` | 5 (revisar caso a caso) |
| `: any` / `as any` | **3** (2 en un tipo de log, 1 `as any` en un modal) |
| Falso éxito (UI dice "guardado" cuando la API falló) | no encontrado; el patrón `.select()`+verificación está presente |
| Cálculo de negocio duplicado (pricing/tax/commission) | **1 canónico** (cobertura), no disperso |
| Secretos expuestos | 0 |

## Consistencia de conceptos (Fase 36 — PASS con nota)

La IA suele crear sinónimos (customer/client/user, company/business/org). Aquí
el modelo es **consistente**: `customer`, `company`, `branch`, `profile`,
`work_order`, `invoice` — un término por concepto, en inglés en la base y en el
código. No se encontraron conceptos equivalentes con nombres distintos.

**Nota:** existe la dualidad `customer` (car wash) vs. el cliente en MembeGo,
pero es **deliberada** — son dos sistemas — y está documentada en el código.

## AI-DEBT-001 — Duplicación controlada de la cobertura · P3

`coberturaMembego.ts` (preview en cliente) y la plataforma MembeGo (autoridad)
implementan la misma regla. Es intencional (previsualizar sin ida y vuelta), pero
es un punto donde dos implementaciones pueden divergir. **Mitigación:** el
cliente nunca decide el cobro final; MembeGo manda. Mantener sincronizadas con
pruebas de contrato (ver TESTING_AUDIT).

## AI-DEBT-002 — 5 supresiones de tipo/lint · P3

Localizar y justificar los 5 `@ts-*/eslint-disable`. No asumir que están mal,
pero cada uno debe llevar comentario de por qué. Sin verificar aún que ninguno
oculta un bug real.

## AI-DEBT-003 — `any` en tipo de log · P4

`src/types/index.ts:405-406` (`requestPayload/responsePayload: any`). Aceptable
para un payload opaco de log, pero podría ser `unknown` + narrowing.

## Lo que NO es deuda de IA (importante)

- La arquitectura (lógica en la base, RLS como frontera) es **coherente y
  elegida**, no accidental.
- Los comentarios en español son **densos y explican el "por qué"** de las
  decisiones (visto en `api/membego/canjear.ts`, migración 0040). Esto es lo
  contrario del vibe coding: el conocimiento está en el código, no solo en un
  chat.

## Prueba de la Fase 58 (dependencia de las conversaciones)

**¿Si desaparecen los chats que construyeron esto, se puede seguir?** En gran
medida **sí**: hay 45 migraciones versionadas, 28 archivos de prueba SQL, 6
suites e2e, y comentarios extensos. Lo que falta para un "sí" rotundo: CI que
ejecute esas pruebas, y los documentos de arquitectura (ADRs) que esta auditoría
empieza a crear. → ver DEPENDENCY/TESTING.
