# Membego · Estado de implementación (lado car wash)

Implementación del contrato `docs/INTEGRACIONES.md` que entregó Membego.

## ✅ Hecho — Webhooks (recepción de eventos)

- **Endpoint:** `POST /api/membego/webhook` (función serverless de Vercel,
  `api/membego/webhook.ts`). Se despliega sola con el frontend.
- Verifica `X-Membego-Firma` (HMAC-SHA256 del cuerpo crudo, en tiempo constante).
  Firma inválida → 401.
- Reenvía el sobre a la función de base `membego_ingest_event`, que hace todo con
  aislamiento por empresa. Firma correcta → 200; fallo de base → 502 (Membego
  reintenta).
- **Idempotente** por `id` de evento; **enruta por `companyId`** al tenant;
  **ignora** tipos desconocidos respondiendo 200.
- Eventos soportados hoy: `cliente.registrado`, `cliente.primera_visita`,
  `cliente.visita`, `cliente.compro_servicio`, `cliente.primera_compra`,
  `membresia.activada`, `referido.convirtio`. Los demás se aceptan y se ignoran.
- Verificado: 6 pruebas SQL del despachador (incl. idempotencia, empresa no
  vinculada, aislamiento) + 7 pruebas de la función (firma válida/ inválida).

## Para registrar este satélite en Membego (`sistemas_conectados`)

| Campo | Valor |
|---|---|
| `slug` | `carwash` |
| `categoria` | `CAR_WASH` |
| `urlBase` | `https://<TU-DOMINIO-VERCEL>` |
| `urlWebhook` | `https://<TU-DOMINIO-VERCEL>/api/membego/webhook` |
| `secreto` | 64 hex — el mismo que pondrás en `MEMBEGO_SECRETO` |

## Variables en Vercel (Settings → Environment Variables, sin `VITE_`)

```
MEMBEGO_SECRETO            = <el secreto de 64 hex de Membego>
SUPABASE_URL              = https://ewtuavdebwzrjojifqyr.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <service_role key del panel de Supabase>
```

> La `service_role` se salta RLS: solo aquí, en el servidor, nunca en el cliente.
> Tras ponerlas, **redesplega** para que la función las tome.

## Vincular tu empresa (una vez, en Supabase → SQL Editor)

Membego te da el `companyId` de tu empresa. Mapéalo a tu empresa de este sistema:

```sql
select public.membego_link_company('<TU_companyId_DE_MEMBEGO>');
```

Sin esto, los eventos de tu empresa se ignoran (empresa no vinculada). Cada car
wash del sistema hace su propio `membego_link_company` con su `companyId`.

## ✅ Hecho — SSO de empleados

- **Endpoint:** `GET /sso/membego?token=...` (rewrite a `api/sso/membego.ts`).
- Verifica el token HMAC de Membego (payload `sub/email/rol/companyId/exp`,
  vence en 90 s) con el código exacto del contrato.
- Asegura el usuario local y su perfil en la empresa del token (RPC
  `membego_sso_upsert_user`, service_role local), con el rol mapeado:

  | Rol Membego | Rol car wash |
  |---|---|
  | ADMIN_EMPRESA | administrador |
  | GERENTE | supervisor |
  | RECEPCION | recepcionista |
  | EMPLEADO | operario |
  | SUPERADMIN | superadmin |

- Acuña la sesión de Supabase (magic link) y redirige al panel.
- Verificado: 5 pruebas SQL (crea/actualiza el perfil, idempotencia por correo,
  mapeo de rol, empresa no vinculada) + 5 de la verificación del token.

### Para que el SSO funcione en producción

1. En **Supabase → Authentication → URL Configuration → Redirect URLs**, agrega
   tu dominio de Vercel (ej. `https://<tu-dominio>` y `https://<tu-dominio>/`).
2. En Membego, `urlBase` del satélite = `https://<tu-dominio>`; el SSO cae en
   `https://<tu-dominio>/sso/membego`.

> El acuñado de la sesión (magic link admin) solo se puede probar contra Supabase
> real: al desplegar, hagan una prueba de humo abriendo el SSO desde Membego.

## ✅ Hecho — SSO saliente (botón "Ir a Membego")

El inverso del anterior: el usuario ya logueado en el car wash entra **logueado**
a su cuenta de Membego con un clic (botón ámbar en la barra superior).

- **Botón** (`src/components/layout/Navbar.tsx`): con sesión, pide un pase a
  `POST /api/ir-a-membego` (con el `access_token` del usuario) y abre la URL que
  devuelve en pestaña nueva. Sin sesión o si algo falla, abre `membego.com`.
- **Borde** (`api/ir-a-membego.ts`): resuelve la identidad llamando a
  `membego_sso_saliente` **con el token del propio usuario** (no service_role),
  firma un pase corto (HMAC-SHA256, 90 s, no-JWT) con el secreto compartido y
  arma la URL de entrada de Membego.
- **Contrato de entrada de Membego:**
  `GET https://membego.com/sso/entrar?sistema=<slug>&token=<base64url(JSON).hmacHex>`
  con payload `{ sub?, email, companyId, exp }`. El `sub` va cuando el usuario
  entró alguna vez por el SSO de Membego (0015 lo guarda en `raw_user_meta_data`);
  el dueño creado por bootstrap va por `email` (Membego lo acepta como suficiente).
- **RPC** `membego_sso_saliente()` (migración 0016 / parche
  `supabase/membego_0017_sso_saliente.sql`): devuelve `{ email, companyId, sub }`
  del usuario autenticado; rechaza si su empresa no está vinculada.
- Verificado: 17 pruebas unitarias del borde + 4 SQL de la RPC.

### Para que el SSO saliente funcione en producción

1. Corre `supabase/membego_0017_sso_saliente.sql` en el editor SQL de Supabase.
2. En **Vercel**, agrega (sin `VITE_`): `MEMBEGO_SISTEMA_SLUG` = el slug que
   Membego confirme para tu sistema (el mismo de tus webhooks). Opcional:
   `MEMBEGO_SSO_ENTRADA_URL` (por defecto `https://membego.com/sso/entrar`).
   `MEMBEGO_SECRETO` y `SUPABASE_URL` ya deben estar. Redeploy.

> Hasta que exista `MEMBEGO_SISTEMA_SLUG`, el borde responde 503 y el botón
> cae a `membego.com` (nunca queda muerto).
