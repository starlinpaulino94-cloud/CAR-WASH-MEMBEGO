# SYSTEM_MAP — Inventario de funcionalidades

> Evidencia: `find`, `grep`, esquema vivo del arnés PostgreSQL, suite e2e.
> Estado de cada feature clasificado WORKING / PARTIAL / BROKEN / MOCK / DEAD / UNKNOWN.

## Métricas del repositorio (verificadas)

| Métrica | Valor |
|---|---|
| Vistas React | 36 |
| Modales | 8 |
| Endpoints serverless (`api/`) | 8 |
| Migraciones SQL | 45 |
| Tablas | 56 |
| Políticas RLS | 124 |
| Funciones (`app`+`public`) | 196 (60 SECURITY DEFINER) |
| Triggers | 84 |
| Foreign keys | 187 |
| CHECK constraints | 147 |
| Índices | 217 |
| Pruebas SQL (archivos) | 28 |
| Suites e2e | 6 (250 comprobaciones) |
| LoC `src/` | 27.977 |
| LoC `api/` + migraciones | 16.022 |

## Inventario por módulo

Todos los flujos con cobertura e2e o de prueba SQL se marcan WORKING **con la
salvedad de que las pruebas corren contra el arnés local, no contra Supabase de
producción** (ver TESTING_AUDIT). Ningún dato es MOCK: la búsqueda de
`mock/fake/dummy/Math.random/hardcoded` devolvió **0 coincidencias reales**.

| Feature | Ruta/vista | Criticidad | Estado | Evidencia |
|---|---|---|---|---|
| Tablero kanban | `KanbanSupabaseView` | P0 | WORKING | e2e orders-kanban 43/43; índice `work_orders_active_queue_idx` |
| POS / cobro | `PosSupabaseView` | P0 | WORKING | e2e pos-cash 38/38; RPC `create_invoice` atómico |
| Facturación NCF | `InvoicesSupabaseView` | P0 | WORKING | e2e invoices 26/26 |
| Canje MembeGo | `PosSupabaseView` + `api/membego/canjear` | P0 | WORKING (ver SEC-001) | e2e membego-canje 29/29 |
| Membresía en checkout | `coberturaMembego.ts` | P0 | WORKING | módulo puro; e2e |
| Caja | `CashSupabaseView` | P0 | WORKING | e2e pos-cash |
| Inventario/kardex | `InventoryMovementsSupabaseView` | P1 | WORKING | prueba SQL 60_inventory |
| Compras/proveedores | `Purchases/Suppliers` | P1 | WORKING | 70_purchases |
| Recetas/costo | `RecipeModal` | P1 | WORKING | 80_recipes |
| Reportes con margen | `SalesReport/ProfitReport` | P1 | WORKING | 90_reports |
| Crédito / por cobrar | `ReceivablesSupabaseView` | P1 | WORKING | 96_credit |
| Flotillas | `FleetsSupabaseView` | P1 | WORKING | 97_fleets |
| Nómina/asistencia | `Payroll/Attendance/Shifts` | P1 | WORKING | 98_payroll |
| Multisucursal | `BranchesSupabaseView` | P1 | WORKING | 99_branches |
| Promociones | `PromotionsSupabaseView` | P2 | WORKING | prueba SQL promos |
| Inspección recepción | `InspectionModal` | P2 | WORKING | 91_inspections |
| Control de calidad | `QcReviewModal` | P2 | WORKING | 92_quality |
| Equipos | `EquipmentSupabaseView` | P2 | WORKING | 93_equipment |
| Agenda | `AppointmentsSupabaseView` | P2 | WORKING | 94_appointments |
| Reclamos | `ClaimsSupabaseView` | P2 | WORKING | 95_claims |
| Editar/eliminar catálogo | `adminRepository` + 0040/0041 | P1 | WORKING | A7/A8 pruebas SQL |
| SSO a MembeGo | `api/ir-a-membego`, `api/sso/membego` | P2 | UNVERIFIED | sin prueba automatizada del handshake |
| Webhook MembeGo | `api/membego/webhook` | P1 | WORKING (firma OK) | HMAC timing-safe verificado en código |

## Código muerto / no cableado (documentado, no eliminado)

- `src/components/modals/PhaseArchitectureReportModal.tsx` — modal de reporte interno de arquitectura; usa `as any`. Candidato DEAD, verificar si algo lo monta.
- `src/types/index.ts:405-406` — `requestPayload: any` / `responsePayload: any` en un tipo de log; posible tipo legado.

## No verificable desde este entorno (marcado UNVERIFIED, no PASS)

- Comportamiento contra **Supabase de producción** (red bloqueada; solo arnés local).
- Handshake SSO real con MembeGo en vivo.
- Latencias reales de producción (sin datos de tráfico).
