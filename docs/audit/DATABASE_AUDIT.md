# DATABASE_AUDIT

> Evidencia: consultas al catálogo de PostgreSQL 16 sobre el arnés con las 45
> migraciones aplicadas. La estructura es idéntica a producción (mismas
> migraciones).

## Panorama

| Objeto | Cantidad |
|---|---|
| Tablas | 56 |
| Índices | 217 |
| Foreign keys | 187 |
| CHECK constraints | 147 |
| Políticas RLS | 124 |
| Triggers | 84 |
| Funciones | 196 |

## Integridad y aislamiento (PASS)

- **RLS**: 56/56 tablas con ENABLE **y** FORCE. Ninguna tabla sin RLS. Es la
  frontera de seguridad y está completa.
- **Multi-tenant**: FKs compuestas `(id, company_id)` (patrón "tenant FK")
  presente; los CHECK "same_company" (visto en nombres de constraint) impiden
  cruzar empresa dentro de una fila.
- **ON DELETE** (187 FKs): 78 CASCADE, 73 SET NULL, 23 RESTRICT, 12 NO ACTION.
  Los RESTRICT protegen borrados con historia (facturas, kardex) — verificado en
  la migración 0040, que documenta explícitamente que la FK RESTRICT es la
  autoridad del borrado, no el trigger.
- **Dinero**: 0 columnas monetarias en tipo flotante. Todo `bigint` centavos.

## DB-001 — FKs sin índice en tablas calientes · **P2** · ✅ REMEDIADO (Phase 2)

> Migración `20260821120000_indices_fk_calientes.sql`: 15 índices en las tablas
> que crecen sin techo. Las FK de tablas de bajo volumen se dejan a propósito.
> Texto original abajo.

**Evidencia:** de 186 FKs analizadas, **98 no tienen un índice cuyo primer campo
sea la columna de la FK.** Ejemplos: `appointments.service_id`,
`invoice_items.product_id`, `invoice_items.service_id`,
`inventory_movements.work_order_id`, `commissions.work_order_id`,
`cash_movements.session_id`, `claims.customer_id`, `customers.branch_id`.

**Impacto:** dos costos concretos:
1. **DELETE/UPDATE lento en la tabla padre**: PostgreSQL escanea la tabla hija
   entera para validar la FK en cada borrado del padre. Con volumen, un borrado
   de producto o de orden se degrada.
2. **JOINs y filtros por esa FK** hacen seq scan.

**Matiz honesto:** NO todas las 98 necesitan índice. Las tablas de bajo volumen
(p. ej. `fleet_rates`, `equipment`) no lo justifican todavía. **No crear 98
índices indiscriminadamente** — la Fase 6.2 lo prohíbe. Hay que priorizar por
patrón real: las FK de tablas de alto volumen y alta escritura
(`inventory_movements`, `invoice_items`, `cash_movements`, `commissions`,
`work_order_items`, `audit_logs`) primero.

**Solución recomendada:** crear índices solo para las FK de las ~8 tablas
calientes, justificados por EXPLAIN, en una migración. Documentar por qué las
demás se dejan.

## Consultas calientes (EXPLAIN, PASS)

- **Tablero kanban** (`work_orders` activas por empresa, orden por llegada):
  usa `work_orders_arrival_idx` (Index Scan, no seq). Además existe
  `work_orders_active_queue_idx` parcial. **Bien resuelto.**
- **Paginación**: `fetchCustomerPage` y las demás usan `.range()` — hay límite,
  no hay `SELECT *` sin tope en las rutas de listado.

## DB-002 — Snapshots históricos · ✅ VERIFICADO (Phase 2)

> invoice_items congela nombre+precio, commissions congela tasa+importe,
> work_order_items congela precio, invoices congela ITBIS. Prueba en
> 20_billing_tests.sql demuestra que cambiar el catálogo no altera lo facturado.
> Texto original abajo.

Precio vendido, ITBIS y comisión **deben** congelarse en el momento de la venta
(no seguir al catálogo). `invoice_items` guarda importes propios (evidencia: la
columna de dinero existe por línea), lo que sugiere que sí se hace snapshot. **No
verificado exhaustivamente** que TODA condición histórica (tasa, término de
crédito de flotilla) se congele. → revisar en la fase de remediación P2.

## Backups / restore (UNVERIFIED)

Supabase gestiona backups automáticos según el plan. **No hay evidencia en el
repo de**: frecuencia configurada, política de retención, ni un restore test
ejecutado. La Fase 25 exige probar el restore — **no se ha probado**. Marcado
UNVERIFIED, no PASS.
