# Base de datos — Supabase

Cimientos del backend real: esquema, aislamiento multi-tenant y autenticación.
Corresponde al bloque *Corto plazo* (§20) de `AUDITORIA-ESCALABILIDAD-PRODUCCION.md`.

> **Estado:** el esquema está escrito y **verificado contra PostgreSQL 16 real**
> (45/45 comprobaciones, incluidas las de RLS ejecutadas con el rol
> `authenticated`, no como superusuario). Todavía **no está aplicado** al
> proyecto alojado ni conectado a las pantallas: la aplicación sigue funcionando
> contra `localStorage`. Migrar las vistas es la fase siguiente.

---

## Qué resuelve

| Riesgo de la auditoría | Cómo queda resuelto |
|---|---|
| **C2** · Sin autenticación | `auth.users` + `public.profiles` con los 8 roles. El PIN de caja se guarda como hash, nunca en claro |
| **C10** · Sin aislamiento multi-tenant | RLS activo **y forzado** en las 20 tablas. Todo acceso pasa por `company_id = app.current_company_id()` |
| **C6** · Numeración fiscal aleatoria | Rangos NCF autorizados (`ncf_sequences`) y asignación correlativa con bloqueo de fila. Falla si el rango se agota o vence, en vez de improvisar |
| **I1/I2** · Colisión de identificadores | UUID generados por la base y contadores transaccionales. Se acabó `Date.now()` y `Math.random()` |
| **I12** · Tres fórmulas de ITBIS divergentes | Una sola implementación: `app.recalc_work_order_totals()`. Los totales se derivan de las líneas, el cliente no los envía |
| **I13** · Histórico de caja destruido | `cash_sessions` conserva todas las sesiones; índice único que permite una sola abierta por sucursal |
| **§7.6** · Bitácora que se perdía | `audit_logs` de solo inserción, garantizado por permisos, RLS y trigger. El actor lo sella el servidor |
| **§5.5** · Dinero en coma flotante | Todos los importes son `bigint` en centavos |

---

## Estructura

```
supabase/
├── migrations/
│   ├── ..._0100_foundation.sql          extensiones, esquema app, enums, utilidades
│   ├── ..._0200_tenancy_identity.sql    empresas, sucursales, perfiles, helpers RLS
│   ├── ..._0300_catalog_customers.sql   servicios, precios, productos, bahías, clientes, vehículos
│   ├── ..._0400_operations.sql          órdenes, líneas, numeración, totales derivados
│   ├── ..._0500_cash_billing_fiscal.sql caja, movimientos, NCF, facturas, gastos, comisiones
│   ├── ..._0600_audit_log.sql           bitácora inalterable
│   └── ..._0700_rls_policies.sql        TODA la superficie de seguridad, en un archivo
└── tests/
    ├── 00_supabase_shim.sql             simula auth.uid() para poder probar en local
    └── 10_rls_tests.sql                 45 comprobaciones de esquema y RLS
```

Las políticas RLS viven en **un solo archivo** a propósito: la seguridad debe
poder revisarse de una lectura, no reconstruirse juntando siete migraciones.

---

## Aplicar

```bash
npm i -g supabase          # o: brew install supabase/tap/supabase
supabase link --project-ref ewtuavdebwzrjojifqyr
supabase db push           # aplica las migraciones en orden
npm run db:types           # regenera src/lib/database.types.ts desde el esquema
```

Después, en `.env.local`:

```
VITE_SUPABASE_URL=https://ewtuavdebwzrjojifqyr.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key del panel de Supabase>
```

La `anon key` es pública por diseño; lo que protege los datos es RLS. La
`service_role` **nunca** va en el cliente: se salta RLS por completo.

---

## Probar en local

No hace falta Docker ni conexión:

```bash
supabase/tests/run.sh
```

Levanta un PostgreSQL limpio, aplica el shim de `auth`, ejecuta las migraciones
y corre las 45 comprobaciones. Las pruebas se ejecutan con el rol
`authenticated`, **no** como superusuario: un superusuario se salta RLS y la
prueba no demostraría nada.

### Qué cubren

- **Aislamiento**: la empresa Beta no ve órdenes, facturas, caja, bitácora ni
  rangos NCF de la empresa Alfa. Inserción cruzada rechazada.
- **Fallo cerrado**: un usuario recién registrado no ve *nada*.
- **Escalada de privilegios**: nadie cambia su propia empresa ni su propio rol;
  un administrador no puede fabricar propietarios; el `company_id` que venga en
  los metadatos del registro se ignora.
- **Fiscalidad**: NCF correlativos con formato DGII; al agotarse el rango, error
  explícito en lugar de un número inventado.
- **Dinero**: precios negativos, cantidad cero y descuentos superiores al importe
  de la línea, rechazados por restricciones CHECK.
- **Caja**: el efectivo esperado solo cuenta efectivo, admite valores negativos
  (un descuadre debe verse) y solo hay una caja abierta por sucursal.
- **Auditoría**: UPDATE y DELETE rechazados; el actor lo sella el servidor.
- **Cobertura**: ninguna tabla de `public` puede quedarse sin RLS por olvido.

---

## Dos cosas que conviene saber

**1. RLS filtra en silencio.** Un `UPDATE` o `DELETE` bloqueado por RLS **no
lanza error**: afecta a 0 filas y devuelve éxito. Solo el `WITH CHECK` de un
`INSERT` produce excepción. La interfaz **debe comprobar el número de filas
afectadas**; si no, una anulación denegada se le mostrará al cajero como
realizada. Este comportamiento hizo fallar cuatro pruebas escritas de la forma
ingenua, y quedó documentado en el helper `test.expect_no_effect`.

**2. Las políticas permisivas se combinan con OR.** Fue el origen del único
agujero real que encontró la batería: `profiles_admin_manage` permitía a un
propietario editar cualquier fila de su empresa —la suya incluida— anulando el
`WITH CHECK` de `profiles_update_self`, de modo que podía auto-ascenderse a
`superadmin` con un solo `UPDATE`. Se corrigió con políticas `RESTRICTIVE`, que
se combinan con AND y se aplican siempre. **Ese fallo no se vio en la revisión
visual: lo encontró la prueba.**

---

## Lo que falta

Fuera del alcance de esta fase, en orden de prioridad:

1. **RPC transaccional de facturación** — factura + caja + stock + orden en una
   sola transacción. Hoy el esquema lo permite pero no lo obliga (riesgo C9).
2. **Nota de crédito B04** al anular, con reversión de inventario y caja.
3. **Migrar las 16 vistas** de `AppContext` a consultas contra Supabase.
4. **Migración de datos** desde `localStorage` para las instalaciones piloto.
5. **Claims de tenant en el JWT** (Custom Access Token Hook) para evitar el
   `SELECT` sobre `profiles` en cada evaluación de política. Optimización, no
   corrección: `app.current_company_id()` es `STABLE` y se evalúa una vez por
   sentencia, lo cual es suficiente hasta bastante escala.
6. **Realtime** en el Kanban.
