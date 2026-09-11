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

Todo va en **un solo proyecto de Vercel: el del car wash**. No hay nada que
poner en ningún despliegue de Membego.

Pero los valores salen de **dos sitios distintos**, y confundirlos es el fallo
más caro de esta integración:

| Grupo | De dónde sale |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | del Supabase **del car wash** — el mismo proyecto de las `VITE_*` |
| `MEMBEGO_CLIENT_ID`, `MEMBEGO_CLIENT_SECRET`, `MEMBEGO_SECRETO`, `MEMBEGO_COMPANY_ID` | de **Membego**: los tres primeros los imprime el script de arriba; el último es el id de tu empresa |

> ⚠️ **Del panel de Supabase de Membego no se saca nada.** Son dos proyectos de
> Supabase distintos. Si en `SUPABASE_URL` se pega el de Membego, el navegador
> crea la sesión contra el car wash y el servidor la valida contra Membego,
> donde ese usuario no existe: el mostrador lee «La sesión no es válida o
> expiró» para siempre y nada más lo delata. El diagnóstico compara los dos
> lados justo por esto.

En Vercel → Settings → Environment Variables (Production), **sin** prefijo `VITE_`:

| Variable | Valor |
|---|---|
| `MEMBEGO_CLIENT_ID` | el `mgc_…` que imprimió el script |
| `MEMBEGO_CLIENT_SECRET` | el `mgs_…` que imprimió el script |
| `MEMBEGO_COMPANY_ID` | el id `cm…` de tu empresa en Membego |
| `MEMBEGO_SISTEMA_SLUG` | `car-wash-membego` (el mismo `slug` del manifiesto) |
| `MEMBEGO_API_URL` | *(opcional)* `https://membego.com/api/platform/v1` — **ponla explícita** si tu Membego responde en otro host (ver el aviso de abajo) |
| `MEMBEGO_SSO_ENTRADA_URL` | *(opcional)* `https://membego.com/sso/entrar` — para el botón «Ir a Membego» |

El secreto de webhooks (`whs_…`) va en Membego, no aquí.

Después de guardarlas hay que **redeploy** en Vercel (las variables no se aplican
a despliegues ya hechos).

### Cuidado con el `www`: una redirección rompe el token y no lo parece

Si `MEMBEGO_API_URL` apunta a un host que **redirige** al canónico (el caso
clásico: `membego.com` cuando el bueno es `www.membego.com`), la petición del
token es un `POST` y **una redirección lo convierte en `GET` y tira el cuerpo**.
Membego recibe una petición sin `client_id` y contesta 400/405; el mostrador lee
«Membego rechazó las credenciales» y el que va a arreglarlo se pasa el día
rotando un secreto que estaba perfecto.

Desde la auditoría, el borde **corta ante cualquier redirección** y dice a qué
host redirige — que es justo el valor que hay que poner en la variable. Si ves
ese mensaje, copia el destino en `MEMBEGO_API_URL` y vuelve a desplegar.

## Cuando algo falle: el botón de diagnóstico

No adivines cuál de los seis eslabones está roto. En **Ajustes → Membego →
Comprobar la integración** hay un botón que los recorre todos y dice cuál falla
y qué hacer. El mismo botón aparece en la caja, junto al aviso, cuando la ficha
de un cliente no se puede consultar.

**Que lo pulse quien tiene el problema.** Dos de las comprobaciones —el rol y la
lectura del vínculo bajo RLS— dependen de quién llama: si a un cajero le falla y
al dueño le sale todo verde, eso no descarta el fallo, lo **localiza**.

## Importante: esto NO es el error que ves ahora

El aviso *«La sesión no es válida o expiró»* del POS viene de la verificación con
**Supabase**, que ocurre **antes** de llamar a Membego. Primero hay que dejar
coherentes `SUPABASE_URL` y `SUPABASE_ANON_KEY` (iguales a las `VITE_…` del mismo
proyecto). Estas credenciales de Membego resuelven un problema distinto: que la
ficha traiga datos de verdad una vez la sesión ya se valida.
