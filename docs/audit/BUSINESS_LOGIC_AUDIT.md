# BUSINESS_LOGIC_AUDIT

> Fases 5, 7, 8, 9. Concurrencia, transacciones, idempotencia, cálculos.

## Transacciones (Fase 7 — PASS)

Las operaciones compuestas se ejecutan como **una sola función PL/pgSQL**, que
en PostgreSQL es atómica por defecto (todo o nada):

- `create_invoice` — un RPC único (verificado en `20260729000800_billing_rpc.sql`).
  Emisión de factura + líneas + secuencia NCF + pagos en una transacción.
- `annul_invoice`, `cancel_work_order`, `advance_work_order`,
  `record_membego_redemption`, `record_membego_reversal` — todos RPC atómicos.

No hay patrón de "3 inserts sueltos desde el cliente" que pueda quedar a medias.
**Esto está bien resuelto.**

## Concurrencia / race conditions (Fase 8 — ✅ PASS, probado)

**BL-001 — Race conditions probadas · ✅ CERRADO** (Phase 2)

`supabase/tests/concurrency.sh` abre transacciones solapadas reales y demuestra: NCF distintos bajo concurrencia (FOR UPDATE en la secuencia), una sola orden por bahía (FOR UPDATE en la bahía), stock sin lost update. Los candados ya existían; ahora hay prueba. 4/4.

> Texto original abajo como registro.

La lógica vive en RPC dentro de la base, lo que da un candado natural por fila
en muchos casos, pero **no hay ninguna prueba de concurrencia** en la suite (la
Fase 8 la exige como obligatoria). Los recursos disputables reales:

- **Secuencia NCF** (número de factura fiscal): dos cobros simultáneos no pueden
  recibir el mismo NCF. Requiere verificar que `create_invoice` toma la
  secuencia con un candado adecuado (`SELECT … FOR UPDATE` o secuencia nativa).
  → **UNVERIFIED**: hay que leer la implementación y probar con 2 sesiones.
- **Stock de productos** en el POS: dos ventas del último producto no pueden
  dejar stock negativo. → verificar el decremento y su CHECK.
- **Última bahía** al iniciar lavado: dos operarios tomando la misma bahía.

**Acción:** escribir pruebas de concurrencia (2 sesiones PL/pgSQL simultáneas)
para NCF, stock y bahía antes de declarar PASS.

## Idempotencia (Fase 9 — PASS en MembeGo, PARCIAL en el resto)

- **Canje MembeGo (PASS):** la clave de idempotencia se **deriva de la factura**
  (`cw-inv-${invoiceId}`), no se inventa por intento. Verificado en
  `api/membego/canjear.ts`. Un doble clic o un reintento de red llega con la
  misma clave y MembeGo no consume dos lavados. **Excelente.**
- **Doble-submit en el POS (PASS):** `PosSupabaseView` bloquea con
  `submitting` + `canCheckout`; el botón se deshabilita durante el envío.
- **Emisión de factura (UNVERIFIED):** ¿`create_invoice` es idempotente ante un
  reintento del cliente si la respuesta se perdió pero la factura se creó? No hay
  clave de idempotencia de extremo a extremo para el cobro local (a diferencia
  del canje). Con red inestable, un reintento podría emitir dos facturas. →
  revisar si el patrón submitting basta o si hace falta idempotency key.

## Cálculos (Fase 3.6 — PASS)

- **Cobertura de membresía** tiene **una implementación canónica**:
  `src/lib/coberturaMembego.ts` (preview) que refleja la decisión de MembeGo
  (autoridad). No hay lógica de pricing duplicada en varias vistas.
- **Dinero**: centavos enteros en toda la cadena; sin `parseFloat` en las rutas
  de cálculo de dinero (los 2 hits de `toFixed` son de formato de presentación).
- **ITBIS 18%** y márgenes: calculados en la base (reportes con margen real,
  prueba SQL 90_reports).

## Datos inesperados (Fase 5 — PARCIAL)

Validación en tres capas presente donde importa: CHECK constraints en la base
(147), validación de servidor en los RPC, y validación de UX en formularios. **No
se probó exhaustivamente** cada entrada con null/negativo/unicode/muy largo por
endpoint (la Fase 5 lo pide). Marcado PARCIAL: la frontera dura (base) existe;
la cobertura de casos límite en pruebas es incompleta.
