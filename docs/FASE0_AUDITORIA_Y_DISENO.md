# Fase 0 · Auditoría y diseño técnico de Fases 1 y 2

Fecha: 2026-09-11. Base auditada: `main` en `99c4eef`. 57 migraciones, 832
comprobaciones SQL, 118 pruebas de API.

Este documento es accionable, no un inventario. Cada hallazgo lleva archivo y
línea. Lo que no está aquí no se tocó.

---

## 1. Estado actual, en una frase por dominio

| Dominio | Estado | Veredicto |
|---|---|---|
| Base de datos | 57 migraciones, RLS en todo, dinero en centavos, RPC atómicas e idempotentes, 832 pruebas | **Fuerte. No se toca la lógica transaccional.** |
| Reportes | 1 RPC (`management_report`) con solo fecha + sucursal; UI expone solo 4 rangos; sin impresión; CSV solo en Ventas; sin drill-down | **Superficial. Prioridad máxima.** |
| Infraestructura común | Buen kit de listados (`DataViewShell`), paginación de servidor sólida (`usePagedQuery`), exportación que ignora filtros, impresión solo térmica | **Base buena con tres huecos concretos.** |
| Rendimiento por lavador | `washer_performance` calcula bien lavados, generado y comisión; no sabe de reprocesos, tiempos ni detalle por orden | **Base correcta, incompleta.** |

---

## 2. Fortalezas que se conservan tal cual

- **Modelo de datos completo para todo lo que pide el brief.** Se verificó tabla por tabla:
  - Método de pago: NO está en `invoices`; está en `cash_movements(method, amount_cents, invoice_id)`. Es la única fuente y es correcta.
  - Costo de insumos: `service_consumptions(work_order_id, service_id, product_id, cost_cents)`.
  - Reprocesos: `qc_reviews(work_order_id, attempt, result, reject_reason, washer_id)`.
  - Tiempos: `work_orders(arrival_at, started_at, finished_at, delivered_at)`.
  - Vehículos compartidos: `work_order_assignees`.
  - Nómina: `payroll_periods(period_from, period_to, status)` + `payroll_items(commissions_cents, …)`.
- **Paginación de servidor** con descarte de respuestas tardías: `src/hooks/usePagedQuery.ts:33-98`. Se reutiliza sin cambios.
- **Kit de listados**: `ViewHeader`, `ErrorState`, `InlineAlert`, `SearchBox`, `FilterChips`, `SkeletonRows`, `EmptyRow`, `Pagination`, `StatCard`, `ReadOnlyNotice`, `HelpNote` en `src/components/common/DataViewShell.tsx`. Se extiende, no se reemplaza.
- **Mecanismo de impresión** por isla visible (`--print-page-size`, `.print-ticket.is-page`) ya demuestra Carta/A4 en `TicketSupabaseModal.tsx:39-45`. Se generaliza.
- **Índices** para rangos de fecha: `invoices(company_id, created_at)`, `work_orders(company_id, arrival_at)`, `expenses(company_id, expense_date)`, `commissions(profile_id, earned_on)`.

---

## 3. Debilidades confirmadas (con evidencia)

### 3.1 Reportes

| # | Hallazgo | Evidencia | Gravedad |
|---|---|---|---|
| R1 | **«Hoy» devuelve mañana a partir de las 20:00 hora local.** `rangeDates` construye fechas locales y las serializa con `toISOString()` (UTC). Reproducido: a las 21:30 del 11/09 en RD, `today` → `2026-09-12`. El dueño que mira las ventas al cerrar ve cero. | `src/lib/reportRanges.ts:13` | **Crítica** |
| R2 | El corte de día en la RPC compara `timestamptz` contra `date` con la zona de la sesión (UTC), no la del negocio. Un lavado de las 22:00 cae en el día siguiente. | `20260729002900_branches.sql:467` | **Crítica** |
| R3 | `consumption_cents` y `service_margin` **ignoran la sucursal**: al filtrar por sucursal, la utilidad resta el consumo de toda la empresa. `service_consumptions` no tiene `branch_id`; hay que cruzar por `work_orders.branch_id`. | `:587-591`, `:618-623` | Alta |
| R4 | La RPC admite `p_branch_id` pero la UI **nunca lo manda** (llama con 2 args). | `SalesReportSupabaseView.tsx:125` | Alta |
| R5 | Sin filtro por cajero, lavador, servicio, categoría, método ni estado en ninguna RPC. Son solo dimensiones de salida. | `20260729002900_branches.sql:424-433` | Alta |
| R6 | Dos bases de cálculo que no cuadran: `by_service` usa `qty·precio − descuento` de renglón; `by_employee` usa `i.total_cents` (con ITBIS). Sumar una tabla no da la otra. | `:498` vs `:536` | Media |
| R7 | `by_employee` mide **cajeros**, no lavadores. El rendimiento del lavador vive en otra RPC sin cruce. | `:530-545` | Media |
| R8 | Rentabilidad se rotula «lo que de verdad queda» y «Utilidad bruta estimada» restando solo insumos y gastos; la nota admite que no incluye nómina ni comisiones. | `ProfitReportSupabaseView.tsx:66,78-96,159-162` | Alta (induce a error) |
| R9 | `receivables_cents` se devuelve y se descarta (ni en el tipo TS). | `adminRepository.ts:333-354` | Baja |
| R10 | Tres implementaciones distintas de rangos: `reportRanges.ts`, `ReportsSupabaseView.tsx:42-55`, `CommissionsSupabaseView` (quincena). Y tres `RANGES` redeclarados: `DashboardSupabaseView.tsx:12`, `TeamSupabaseView.tsx:35`, `ReportsSupabaseView.tsx:43`. | — | Media |
| R11 | `washer_performance` y `qc_rework_index` **no validan rol**; `management_report` sí. | `20260908160000:520`, `20260729002200:207` | Media |
| R12 | `washer_performance` reparte «generado» con división entera: se pierden centavos por orden compartida. | `20260908160000:547` | Baja |
| R13 | Sin impresión, sin PDF, sin drill-down, sin paginación en Ventas ni Rentabilidad. Auditoría no exporta. | — | Alta |

### 3.2 Infraestructura transversal

| # | Hallazgo | Evidencia |
|---|---|---|
| I1 | **La exportación ignora los filtros de pantalla, por diseño.** `fetchAllRows(table, select, order, hardLimit)` no admite `where`. Las 11 llamadas pasan el spec sin argumentos. El aviso de truncado dice «acote el rango», pero no hay forma de acotarlo. | `importExportRepository.ts:70-87`, `ExportButton.tsx:8-13,39` |
| I2 | **Imprimir un reporte hoy sale en blanco.** `body * { visibility: hidden }` y solo `.print-ticket`/`.print-labels` se revelan. `@page` por defecto es 80 mm. No hay encabezado administrativo ni `thead` repetido por página. | `src/index.css:323-371` |
| I3 | No existe componente de rango de fechas: `<input type="date">` a mano en 8 vistas. | `ReportsSupabaseView.tsx:184`, `CommissionsSupabaseView.tsx:145`, `PayrollSupabaseView.tsx:539`… |
| I4 | No existe `DataTable`: el ternario `loading ? Skeleton : vacío ? EmptyRow : rows.map` se repite verbatim con `cols={N}` a mano. Dos vistas reimplementan la paginación entera: `InvoicesSupabaseView.tsx:44-60`, `OrdersSupabaseView.tsx:61-119`. | — |
| I5 | No existe panel de detalle reutilizable; cada vista lo maqueta. | `FleetsSupabaseView.tsx:380`, `PayrollSupabaseView.tsx:410`, `ReceivablesSupabaseView.tsx:224` |
| I6 | `StatCard` recibe `value: string`: ~30 llamadas repiten `formatCents(...)`. Sin skeleton de KPI, sin acción de drill-down. | `DataViewShell.tsx:177` |
| I7 | **Bajo stock filtra tras paginar.** `filter(p => p.stock <= p.min_stock)` sobre las 25 filas ya traídas; `total` sigue sin filtrar, así que «Mostrando 1–25 de 340» con 3 filas visibles. Mismo defecto en compras pendientes, sin aviso. | `adminRepository.ts:286-304`, `:469-495`; aviso en `ProductsSupabaseView.tsx:235-240` |

### 3.3 Riesgos

- **Zona horaria** (R1, R2) es el riesgo número uno: todo reporte diario está corrido para un turno nocturno. Arreglarlo cambia cifras que el dueño ya vio; hay que explicarlo.
- **Doble descuento de comisiones** en el nuevo estado de resultados: `payroll_items.commissions_cents` ya está dentro de la nómina. Si se restan comisiones para el margen de contribución y luego la nómina completa, se descuentan dos veces. La nómina debe entrar **sin** su columna de comisiones.
- **Cambiar `management_report` en sitio** rompería Dashboard y las dos vistas actuales. Se crean RPC nuevas y se migra la UI; la vieja se retira cuando nada la llame.
- **Rendimiento**: los filtros por cajero, sucursal y método sobre `invoices`/`cash_movements` no tienen índice propio. Con miles de facturas es aceptable por el índice de `(company_id, created_at)`; se medirá con `explain` antes de añadir índices.

### 3.4 Dependencias

- Reportes depende de: `invoices`, `invoice_items`, `cash_movements`, `work_orders`, `work_order_assignees`, `commissions`, `service_consumptions`, `expenses`, `qc_reviews`, `payroll_*`, `services.category` (nuevo), `profiles`, `branches`.
- Zona horaria del negocio: hay que confirmar si `companies` guarda `timezone`. Si no, se añade con default `America/Santo_Domingo`.
- Permiso de Reportes: `viewAuditLog` (`navigation.ts:147-149`). Se mantiene.

---

## 4. Diseño técnico · Fase 1 (infraestructura transversal)

Regla: **nada de esto es navegación**. Vive en `src/components/common/` y `src/lib/`, se estrena en Reportes y después se adopta módulo a módulo.

### 4.1 `src/lib/rangosFecha.ts` (sustituye a `reportRanges.ts`)

- Presets: `hoy`, `ayer`, `7dias`, `este_mes`, `mes_anterior`, `fecha` (un día), `rango`, `mes` (mes concreto), `anio`.
- Fechas como `YYYY-MM-DD` construidas **en local**, nunca por `toISOString()`. Función pura `rangoDeFechas(preset, hoy: Date, extra?)` para poder probar con reloj fijo.
- Etiqueta legible del rango para cabeceras de impresión: `describirRango()`.
- Pruebas: reloj a las 21:30 hora RD, cambio de mes, febrero bisiesto, mes anterior en enero.
- `reportRanges.ts` queda como reexportación deprecada hasta migrar Dashboard, Team y Auditoría.

### 4.2 `FiltroFechas` (`src/components/common/FiltroFechas.tsx`)

Chips de preset + inputs de fecha exacta / rango / mes / año según el preset. Emite `{desde, hasta, preset}`. Un solo componente para las 8 vistas que hoy maquetan inputs a mano.

### 4.3 `FiltrosReporte` (`AdvancedFilters`)

Contenedor plegable con selects de **sucursal, empleado, lavador, servicio, categoría de servicio, método de pago, estado**. Cada select es opcional por props. Emite un objeto `FiltrosReporte` tipado que viaja tal cual a la RPC y a la exportación: **un solo universo para KPIs, tablas, exportación e impresión**.

### 4.4 `BarraReporte` (`ReportToolbar`)

Fila con los filtros, resumen textual del universo («01/09–10/09 · Bávaro · Pedro») y acciones `Imprimir`, `Exportar filtrado`, `Exportar todo` (esta última solo si aplica).

### 4.5 `ReporteImprimible` (`PrintableReport`) + CSS `.print-report`

- Nuevo modo en `index.css`: `.print-report` se revela igual que `.print-ticket`, con `@page size: letter` (o A4 por variable), márgenes 12 mm, `thead { display: table-header-group }` para repetir cabeceras, `tr { break-inside: avoid }`, `.print-hide` para controles.
- Cabecera fija: nombre comercial, título, periodo, filtros activos, «Generado por», «Fecha de impresión». Pie con paginación CSS donde el navegador lo permita.
- Se imprime lo que hay en pantalla con los mismos datos: sin volver a consultar.

### 4.6 `RejillaKpi` (`KpiGrid`)

Tarjetas con `value` en centavos o número (formatea sola), `hint`, tono, **skeleton de carga** y `onClick` opcional para drill-down. Sustituye al patrón `grid grid-cols-2 md:grid-cols-4` + `StatCard` a mano.

### 4.7 `TablaDatos` (`DataTable`)

Definición de columnas `{id, label, align, render, sortable, total?}`; estados de carga/vacío/error integrados; `onRowClick`; cabecera sticky; fila de totales; responsive (columnas `ocultarEnMovil`). No sustituye a `usePagedQuery`: se le conecta.

### 4.8 `PanelDetalle` (`DetailDrawer`)

Panel lateral con título, sub-título, acciones y cuerpo. Focus trap y Escape como los modales actuales.

### 4.9 Exportación filtrada

`ExportSpec` gana `fetchRows(filtros?)`. `ExportButton` recibe `filtros` y muestra **«Exportar resultados filtrados»**; «Exportar todo» solo cuando el spec lo declare. En Reportes, exportar usa el mismo JSON que pinta la pantalla: universo idéntico por construcción.

---

## 5. Diseño técnico · Fase 2 (Reportes)

### 5.1 Migración `reportes_gerenciales`

**Zona horaria.** `companies.timezone text not null default 'America/Santo_Domingo'` (si no existe). Toda RPC de reporte convierte `created_at at time zone tz` antes de comparar con fechas.

**`sales_report(p_from date, p_to date, p_filtros jsonb) → jsonb`**
- `p_filtros`: `{branch_id, cashier_id, washer_id, service_id, service_category, payment_method, status}`; todos opcionales.
- Universo base: facturas vigentes del periodo que cumplan todos los filtros. `washer_id` se resuelve por `work_order_assignees`; `service_id`/`service_category` por existencia en `invoice_items`; `payment_method` por existencia en `cash_movements`.
- Devuelve: `kpis` (ventas brutas, descuentos, ventas netas, facturas, vehículos, servicios, ticket promedio, anulado, notas de crédito, beneficio Membego, por método [efectivo, tarjeta, transferencia, crédito], consumo de insumos, comisiones, margen de contribución, clientes atendidos, clientes Membego/propios, nuevos/recurrentes), `por_servicio`, `por_categoria`, `por_metodo`, `por_cajero`, `por_lavador`, `por_dia` (tendencia), `gastos`.
- **Una sola base de cálculo**: renglón = `quantity·unit_price − discount`; total de factura = suma de renglones + ITBIS. Se documenta en el JSON (`bases`).
- Guard de rol igual que `management_report`.

**`sales_report_invoices(p_from, p_to, p_filtros, p_page, p_size) → (rows, total)`**
Drill-down paginado: las facturas que forman cualquier número del reporte, con los mismos filtros.

**`washer_report(p_from, p_to, p_branch_id, p_profile_id) → jsonb`**
Extiende `washer_performance` sin duplicarlo (la llama para lavados/generado/comisión/metas) y añade por lavador: compartidos, ticket atribuible, comisión pagada/pendiente, % del ingreso, reprocesos y % (de `qc_reviews`), aprobación a la primera, tiempo promedio por vehículo (`delivered_at − started_at` cuando ambos existen), productividad por día. Reparto de «generado» con resto asignado al primero, sin perder centavos.

**`washer_report_orders(p_from, p_to, p_profile_id, p_page, p_size)`**
Drill-down: fecha, orden, placa, servicio, monto atribuible, comisión, compartido con quién, resultado de calidad.

**`profit_report(p_from, p_to, p_branch_id) → jsonb`**
Estado de resultados con esta estructura y estos rótulos, y nada más fuerte:
```
Ingresos por ventas
− Descuentos
− Notas de crédito
= Ingreso neto
− Costo de insumos consumidos      (service_consumptions, por sucursal vía work_orders)
− Comisiones directas              (commissions.earned_on en el periodo)
= Margen de contribución
− Gastos operativos                (expenses)
− Nómina atribuible al periodo     (payroll_periods aprobadas/pagadas que solapan,
                                    prorrateadas por días, SIN commissions_cents)
= Resultado operativo estimado
```
Más `margen_por_servicio` con ventas, cantidad, insumos, comisiones, margen y margen %, y banderas: bajo costo, margen bajo (< umbral), más vendidos, mucho volumen y poco margen.

**Rol.** Se añade guard a `washer_performance` y `qc_rework_index` (misma lista que `management_report`).

**Índices.** Solo tras medir. Candidatos: `invoices(company_id, branch_id, created_at)`, `cash_movements(invoice_id, method)` ya cubierto parcialmente.

### 5.2 Vistas

- **Ventas**: `BarraReporte` + `FiltrosReporte` (todos los filtros del brief) → `RejillaKpi` con drill-down a `sales_report_invoices` en `PanelDetalle` → tablas por servicio, categoría, método, cajero, lavador, día → `Imprimir` (Carta) y `Exportar filtrado`.
- **Rentabilidad**: estado de resultados en cascada con cada línea clicable a su detalle; margen por servicio con banderas; sin la frase «lo que de verdad queda»; fórmulas documentadas en un `HelpNote`.
- **Auditoría**: adopta `FiltroFechas` (retira su `RANGES` propio) y gana exportación filtrada e impresión.
- **Personal → Comisiones y metas**: gana el detalle por lavador (`washer_report_orders`) e impresión. Reportes compara lavadores; Personal profundiza en uno. Sin duplicar.

### 5.3 Pruebas

- SQL: fixture con facturas en dos sucursales, dos cajeros, dos lavadores compartiendo una orden, un pago mixto, una anulación, una nota de crédito, una revisión de calidad rechazada y una nómina que solapa el periodo. Se comprueba: totales por filtro, que KPI y drill-down sumen igual, corte de día en la zona del negocio, que la nómina entre sin comisiones, reparto sin pérdida de centavos.
- API: `rangosDeFechas` con reloj fijo, formateo de cabecera de impresión, construcción de filtros → parámetros de RPC.

### 5.4 Orden de entrega

1. PR «Infraestructura transversal»: 4.1–4.9, aplicado a las tres vistas de Reportes **sin cambiar aún sus datos** (mismo `management_report`), más el arreglo de R1. Verificable de inmediato: «Hoy» correcto a las 21:00, Imprimir funciona, Exportar respeta el rango.
2. PR «Reportes de ventas y lavador»: migración con `sales_report`, `sales_report_invoices`, `washer_report`, `washer_report_orders`, guards y zona horaria; vistas de Ventas y Comisiones.
3. PR «Rentabilidad»: `profit_report` y su vista.
4. Después, Inventario (Fase 3) empezando por I7.
