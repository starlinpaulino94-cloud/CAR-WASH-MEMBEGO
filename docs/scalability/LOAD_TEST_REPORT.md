# LOAD_TEST_REPORT

> Fase 54. Resultados de las pruebas de carga. **Estado: pendiente de correr
> contra staging.** Abajo van (1) el humo que prueba que el runner mide, y (2)
> la plantilla que el dueño llena con números reales de staging.

## Herramientas

- `tests/load/carga.mjs` — runner sin dependencias (Node ≥ 18). Corre en
  cualquier sitio. `TARGET=... SCENARIO=load|stress|spike|soak node tests/load/carga.mjs`.
- `tests/load/carga.k6.js` — para k6 (mejor precisión; recomendado para el
  informe formal). `k6 run -e TARGET=... -e SCENARIO=... tests/load/carga.k6.js`.

## Presupuesto de performance

| Métrica | Objetivo |
|---|---|
| p95 | < 800 ms |
| p99 | < 1500 ms |
| error rate | < 1% |

## 1) Humo local (NO representativo)

Corrido contra el PostgREST del arnés local (sin pooler, sin la red ni el
hardware de producción). **Solo prueba que el runner mide y evalúa el
presupuesto** — no dice nada sobre la capacidad real.

| Escenario | VUs | Dur | Peticiones | RPS | error | p50 | p95 | p99 |
|---|---|---|---|---|---|---|---|---|
| load  | 10 | 6s | 614 | 102.3 | 0% | 92.8 ms | 152.3 ms | 243.9 ms |
| spike | 8 (pico 5×) | 8s | 793 | 99.1 | 0% | — | 411.3 ms | 701.1 ms |

Observación esperada y confirmada: el `spike` sube el p95 (152→411 ms) respecto
al `load`, porque el pico concentra peticiones. El runner distingue los perfiles.

## 2) Staging (PENDIENTE — lo llena el dueño)

Correr los cuatro escenarios contra un despliegue de staging (Supabase + Vercel)
con datos de volumen realista. Sugerencia de parámetros:

| Escenario | Objetivo | Cómo |
|---|---|---|
| **load** | ¿aguanta la carga esperada (M ≈ 300 concurrentes)? | `SCENARIO=load VUS=300 DURATION=120` |
| **stress** | ¿dónde está el punto de ruptura? | `SCENARIO=stress` (rampa hasta 3×) |
| **spike** | ¿sobrevive un pico repentino (una promoción)? | `SCENARIO=spike` |
| **soak** | ¿hay fugas de memoria/conexiones en 30 min+? | `SCENARIO=soak DURATION=1800` |

Tabla a llenar:

| Escenario | Usuarios | RPS | p50 | p95 | p99 | error | CPU base | Conexiones | Resultado |
|---|---|---|---|---|---|---|---|---|---|
| load  | | | | | | | | | |
| stress | | | | | | | | | |
| spike | | | | | | | | | |
| soak  | | | | | | | | | |

## Veredicto de escala

**No se puede declarar LEVEL 5 (escala objetivo validada) sin la sección 2.** El
humo local prueba las herramientas; los números que importan salen de staging.
Hasta entonces el sistema es **LEVEL 4** en lo demás (ver PRODUCTION_READINESS)
y su capacidad real de escala queda **UNVERIFIED**, no PASS.
