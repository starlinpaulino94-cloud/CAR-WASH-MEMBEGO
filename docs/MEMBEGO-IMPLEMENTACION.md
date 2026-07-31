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
