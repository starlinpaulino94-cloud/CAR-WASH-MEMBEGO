# PRODUCT_SPEC — Membego Car Wash Operations

> Documento derivado por inspección del repositorio (rutas, vistas, endpoints,
> migraciones, esquema vivo), no del README. Fecha de auditoría: 2026-08-21.
> Commit base: `main` @ `642776d`.

## Problema

Un lavadero de autos (car wash) en República Dominicana necesita operar el día
a día: recibir vehículos, moverlos por el taller, cobrarlos con factura fiscal
(NCF), manejar caja, inventario, personal y clientes — y **honrar las
membresías de la plataforma MembeGo** (un cliente con membresía tiene lavados
incluidos que el mostrador debe aplicar y canjear).

Es un **SaaS multi-tenant**: una sola base de datos sirve a muchas empresas
(`companies`), cada una con sus sucursales (`branches`).

## Usuarios

Personal de un car wash, con roles jerárquicos. La identidad la maneja Supabase
Auth (GoTrue); el perfil y el rol viven en `profiles`.

## Roles (actores)

Verificado en `src/lib/auth.ts` y en las funciones `app.has_role` / `app.current_role` de la base:

| Rol | Alcance |
|---|---|
| `superadmin` | Plataforma. No cuenta como admin de empresa. |
| `propietario` | Dueño de la empresa, todas las sucursales. |
| `administrador` | Admin, puede estar limitado a una sucursal. |
| `supervisor` | Operación y cancelaciones. |
| `cajero` | Ventas, caja, facturación. |
| `operario` | Ejecuta lavados; recibe comisión. |

## Casos de uso (por módulo, verificado en `src/lib/navigation.ts` y las 36 vistas)

- **Inicio** — panel del día, avisos.
- **Operaciones** — tablero kanban (recepción → lavado → control de calidad → entrega), bahías, inspección de recepción, control de calidad, equipos, agenda.
- **Ventas** — punto de venta (POS), servicios, descuentos/promociones.
- **Facturación** — facturas fiscales (NCF), notas de crédito, configuración fiscal.
- **Caja** — sesiones de caja, movimientos, gastos.
- **Clientes** — fichas, vehículos, reclamos, cuentas por cobrar (crédito), flotillas corporativas.
- **Inventario** — productos, movimientos/kardex, compras, proveedores, recetas de insumos.
- **Personal** — empleados/roles, horarios, asistencia, nómina, comisiones.
- **Reportes** — ventas, márgenes.
- **Configuración** — empresa, apariencia, impresión, sucursales, usuarios, **integración MembeGo** (niveles de vehículo, vínculo).

## Datos que maneja

56 tablas. Dinero **siempre en `bigint` de centavos** (verificado: 0 columnas de dinero en tipos flotantes). Multi-tenant por `company_id` con FKs compuestas `(id, company_id)`. Identidad fiscal dominicana (NCF, ITBIS 18%).

## Operaciones críticas (las que pueden perder dinero / datos / exponer)

| Operación | Riesgo si falla |
|---|---|
| Emitir factura (`create_invoice`) | Pérdida de dinero, secuencia NCF rota, doble cobro |
| Anular factura (`annul_invoice`) | Fraude, descuadre de caja |
| Canjear membresía MembeGo (`/api/membego/canjear`) | Doble consumo de lavado, o lavado regalado |
| Revertir canje (`/api/membego/revertir`) | Lavado perdido o duplicado |
| Consultar ficha por teléfono (`/api/membego/ficha`) | **Exposición de datos personales de clientes** |
| Cerrar sesión de caja | Descuadre, cuadre imposible |
| Nómina y comisiones | Pago incorrecto a empleados |
| Aislamiento multi-tenant (RLS) | **Fuga de datos entre empresas** |

## Integración MembeGo (verificado)

El car wash es un "sistema satélite" de la plataforma MembeGo. Se autentica con
OAuth client-credentials (`MEMBEGO_CLIENT_ID` / `MEMBEGO_CLIENT_SECRET`), llama
a `/api/platform/v1`, y recibe webhooks firmados con HMAC-SHA256
(`MEMBEGO_SECRETO`). El `companyId` se fija en el servidor
(`MEMBEGO_COMPANY_ID`), no lo elige el cliente — **no hay fuga cross-tenant por
esa vía** (verificado en `api/membego/*.ts`).
