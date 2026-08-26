# Credenciales de plataforma Membego para el car wash

Este car wash es un **sistema satélite** de Membego. Para que el POS pueda
consultar la ficha de un cliente (membresías, promociones, citas) y canjear
beneficios, Membego tiene que emitirle una **credencial de plataforma**
(`client_id` + `client_secret`).

Esa credencial **no se saca de ninguna pantalla**: se genera corriendo un
script en Membego, que la imprime **una sola vez**. Si se pierde, se vuelve a
correr y se rota.

## 1. Manifiesto

El sistema se declara en [`manifiesto-carwash.json`](./manifiesto-carwash.json).
**Antes de usarlo, reemplaza el dominio** en `urlBase` y `webhookUrl` por el
dominio real de este car wash en producción (por ejemplo tu URL de Vercel).

Las `capabilities` son exactamente las que el car wash usa (mínimo privilegio):

| Capability | Para qué |
|---|---|
| `CUSTOMER_LOOKUP` | leer la ficha del cliente y sus vehículos |
| `MEMBERSHIP_LOOKUP` | ver la membresía y los lavados que le quedan |
| `BENEFIT_EVALUATION` | saber si la membresía cubre ESE vehículo |
| `BENEFIT_REDEMPTION` | canjear un lavado y revertirlo |
| `PROMOTION_LOOKUP` | traer las promociones de la empresa |
| `APPOINTMENT_LOOKUP` | traer las citas de la empresa |
| `BRANCH_LOOKUP` | traer las sucursales de la empresa |

## 2. Generar la credencial (se corre en el repo de **Membego**, no en este)

Con acceso a la base de datos de Membego (variable `DATABASE_URL` apuntando a
producción), desde la raíz del repo de Membego:

```bash
# 1) Validar el manifiesto sin tocar la base (opcional pero recomendado)
tsx scripts/registrar-sistema.ts ruta/al/manifiesto-carwash.json --validar

# 2) Registrar el sistema y emitir la credencial, habilitándolo para tu empresa.
#    <empresa> es el SLUG o el id (cm…) de tu empresa del car wash en Membego.
tsx scripts/registrar-sistema.ts ruta/al/manifiesto-carwash.json --empresa <empresa>
```

El segundo comando **imprime en pantalla**, una sola vez:

- `client_id`  → empieza con `mgc_`
- `client_secret` → empieza con `mgs_`
- el secreto de webhooks → empieza con `whs_`

Cópialos en el momento. En la base solo queda el hash; no se pueden volver a ver.

## 3. Poner las variables en Vercel (proyecto del **car wash**)

En Vercel → Settings → Environment Variables (Production), **sin** prefijo `VITE_`:

| Variable | Valor |
|---|---|
| `MEMBEGO_CLIENT_ID` | el `mgc_…` que imprimió el script |
| `MEMBEGO_CLIENT_SECRET` | el `mgs_…` que imprimió el script |
| `MEMBEGO_COMPANY_ID` | el id `cm…` de tu empresa en Membego |
| `MEMBEGO_SISTEMA_SLUG` | `car-wash-membego` (el mismo `slug` del manifiesto) |
| `MEMBEGO_API_URL` | *(opcional)* `https://membego.com/api/platform/v1` — solo si tu Membego corre en otro dominio |
| `MEMBEGO_SSO_ENTRADA_URL` | *(opcional)* `https://membego.com/sso/entrar` — para el botón «Ir a Membego» |

El secreto de webhooks (`whs_…`) va en Membego, no aquí.

Después de guardarlas hay que **redeploy** en Vercel (las variables no se aplican
a despliegues ya hechos).

## Importante: esto NO es el error que ves ahora

El aviso *«La sesión no es válida o expiró»* del POS viene de la verificación con
**Supabase**, que ocurre **antes** de llamar a Membego. Primero hay que dejar
coherentes `SUPABASE_URL` y `SUPABASE_ANON_KEY` (iguales a las `VITE_…` del mismo
proyecto). Estas credenciales de Membego resuelven un problema distinto: que la
ficha traiga datos de verdad una vez la sesión ya se valida.
