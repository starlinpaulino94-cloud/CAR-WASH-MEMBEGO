# SCALABILITY_PLAN

> Fase 53. Hasta qué carga opera el sistema manteniendo sus SLO, dónde se rompe
> primero, y qué se hace cuando se acerque ese punto. Los escenarios de escala
> son SUPUESTOS (no hay datos de tráfico reales todavía) y se marcan como tales.

## Capacidad actual (medida) vs. objetivo (supuesto)

| | Empresas | Usuarios concurrentes | Estado |
|---|---|---|---|
| **Hoy (S)** | 1-10 | 5-30 | Operación real. Holgado por diseño. |
| **12 meses (M)** | ~100 | ~300 | Objetivo. Requiere los pasos de abajo. |
| **36 meses (L)** | ~1.000 | ~3.000 | Objetivo. Requiere réplica de lectura y revisión de plan Supabase. |

El perfil de carga es **bajo por naturaleza**: cajeros y operarios de lavaderos,
no un e-commerce con picos masivos. La escritura caliente es el POS y el kanban.

## Estrategia por capa

- **Base de datos:** PostgreSQL de Supabase. Las consultas calientes están
  indexadas (kanban con índice parcial; FK calientes indexadas en Phase 2). A
  escala M el cuello será el plan de Supabase (CPU/conexiones), no el esquema.
- **Conexiones:** todo el acceso va por HTTP a PostgREST/GoTrue, que poolea del
  lado de Supabase (verificado en Phase 1: 0 clientes `pg` crudos). El modo de
  fallo de "serverless agota conexiones" NO aplica. Vigilar el pooler de
  Supabase igualmente al crecer.
- **Cache:** ninguna, y **es correcto** a escala S/M. No introducir Redis sin
  medir un cuello real (Fase 15/55). El catálogo se lee de Postgres y no es un
  cuello a este volumen.
- **Asíncrono:** hoy los reportes corren en el request. A escala L, un reporte
  de margen sobre cientos de miles de facturas debería ir a un job. P2 futuro,
  no bloqueante hoy.
- **Almacenamiento:** sin archivos pesados propios; los tickets se imprimen.

## Punto de ruptura esperado

No medido aún (requiere correr `stress` contra staging — ver LOAD_TEST_REPORT).
Hipótesis a validar: el primer límite será el **plan de Supabase** (CPU de la
base o tope de conexiones del pooler), no el código ni el esquema. El escenario
`stress` de `tests/load/` está para encontrar ese número.

## Presupuesto de performance (SLO)

Fijado según el producto (mostrador), no con valores universales:

| Métrica | Objetivo |
|---|---|
| p95 latencia API | < 800 ms |
| p99 latencia API | < 1500 ms |
| error rate | < 1% |
| disponibilidad | 99.9% (ver SLO en AUDIT) |

## Señales a monitorear

- Latencia p95/p99 de la API (cuando se conecte el destino de observabilidad).
- CPU y conexiones activas de la base en el panel de Supabase.
- Error rate de las funciones en Vercel.
- Profundidad de la cola del kanban en horas pico (señal de negocio, no técnica).

## Cómo escalar cuando toque (en orden, solo si se mide el cuello)

1. Subir el plan de Supabase (más CPU/conexiones). Lo más simple, primero.
2. Réplica de lectura para reportes y listados (separar lectura de escritura).
3. Mover reportes pesados a jobs asíncronos.
4. Recién entonces, evaluar cache para catálogo/configuración.

Nada de microservicios/Kafka/CQRS sin una razón demostrable (Fase 55-56): el
monolito modular sobre Supabase soporta S→M→L con estos pasos.
