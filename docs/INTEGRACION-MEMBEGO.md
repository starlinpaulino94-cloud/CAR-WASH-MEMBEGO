# Integración Membego ↔ Car Wash — Contrato

Este documento define cómo Membego se conecta con el sistema de car wash. El
**lado del car wash ya está construido y probado** (migración `0014`, 11 pruebas
SQL). Aquí se especifica lo que el **equipo de Membego** debe implementar.

Principio rector: **un cliente, membresía o promoción solo entra en un car wash
cuando tiene una relación real con ESE comercio.** Un administrador nunca ve
clientes de otro car wash solo porque existan en Membego.

---

## 1. Mapa de comercios (aislamiento multi-tenant)

Cada car wash es un **comercio** en Membego, identificado por un `merchant_id`.
Ese `merchant_id` se mapea a UNA empresa del car wash.

**Alta (una sola vez, la hace el dueño del car wash):**
El propietario entra a su sistema y ejecuta (hoy por SQL / pronto por pantalla):

```sql
select public.membego_link_merchant('<MERCHANT_ID_DE_MEMBEGO>');
```

Devuelve un **secreto de webhook** (48 caracteres) que se muestra **una sola
vez**. El dueño lo entrega a Membego. Membego lo envía en cada llamada. Rotarlo
es volver a ejecutar la función.

- Un `merchant_id` pertenece a una sola empresa (restricción única).
- El secreto se guarda **hasheado** (sha256) en el car wash; Membego guarda el
  texto plano.

---

## 2. Autenticación de las llamadas

Membego llama a la API REST de Supabase del car wash (PostgREST), server-to-server:

```
POST https://<PROYECTO>.supabase.co/rest/v1/rpc/<funcion>
Headers:
  apikey: <SERVICE_ROLE_KEY del car wash>
  Authorization: Bearer <SERVICE_ROLE_KEY del car wash>
  Content-Type: application/json
Body: { "p_merchant_id": "...", "p_secret": "...", ... }
```

- La `service_role key` es una credencial de servidor: **solo en el backend de
  Membego**, nunca en un cliente.
- Además, **cada llamada verifica `p_secret`** contra el comercio: doble barrera.
- Si el comercio o el secreto no coinciden, la llamada falla con error.

> Endurecimiento futuro (opcional): firma HMAC del cuerpo, en vez de secreto
> como parámetro. El contrato de datos no cambia.

---

## 3. Eventos entrantes (Membego → Car Wash)

Membego llama a estas funciones cuando ocurren los eventos. Todas son
**idempotentes** por el id de Membego (reintentar no duplica).

### 3.1 Cliente sigue al comercio → `membego_sync_customer`
Cuando un cliente se registra en Membego y **sigue** a este car wash (o en
cualquier cambio de sus datos).

| Parámetro | Tipo | Nota |
|---|---|---|
| `p_merchant_id` | text | comercio |
| `p_secret` | text | secreto |
| `p_membego_customer_id` | text | id del cliente en Membego (clave de enlace) |
| `p_name` | text | nombre |
| `p_phone` | text? | opcional |
| `p_email` | text? | opcional |
| `p_tier` | text? | nivel de fidelidad (ej. "oro") |
| `p_status` | text? | `active` / `inactive` / `none` (def. `active`) |

Devuelve el `uuid` del cliente en el car wash. Crea o actualiza el cliente en la
empresa de ese comercio.

### 3.2 Adquiere/renueva membresía → `membego_grant_membership`
| Parámetro | Tipo | Nota |
|---|---|---|
| `p_merchant_id`, `p_secret` | text | |
| `p_membego_customer_id` | text | |
| `p_membership_id` | text | id de la membresía en Membego |
| `p_plan_name` | text | ej. "Plan Oro" |
| `p_tier` | text? | |
| `p_status` | text? | `active` / `paused` / `cancelled` / `expired` |
| `p_is_paid` | boolean? | membresía de pago o gratuita |
| `p_valid_from`, `p_valid_until` | date? | vigencia |

Si el cliente aún no existe en el car wash, se crea el enlace mínimo (adquirir
una membresía ya es una relación).

### 3.3 Adquiere promoción/oferta → `membego_grant_promotion`
| Parámetro | Tipo | Nota |
|---|---|---|
| `p_merchant_id`, `p_secret` | text | |
| `p_membego_customer_id` | text | |
| `p_promotion_id` | text | id de la promoción en Membego |
| `p_title` | text | ej. "Lavado gratis" |
| `p_kind` | text | **`free`** o **`paid`** (gratis o de pago) |
| `p_code` | text? | código de canje |
| `p_value_cents` | bigint? | valor en centavos (si aplica) |
| `p_expires_at` | timestamptz? | vencimiento |

### 3.4 Cambia estado de una promoción → `membego_set_promotion_status`
Para marcar una promoción como canjeada (o cancelada/expirada) desde Membego.

| Parámetro | Tipo | Nota |
|---|---|---|
| `p_merchant_id`, `p_secret` | text | |
| `p_promotion_id` | text | |
| `p_status` | text | `available` / `redeemed` / `expired` / `cancelled` |

---

## 4. Qué ve el car wash

- **Clientes**: en `customers`, con su `membego_customer_id`, `membego_status` y
  `membego_tier`. Solo los de su empresa.
- **Membresías**: en `memberships` (plan, nivel, estado, vigencia, si es de pago).
- **Promociones**: en `customer_promotions` (título, tipo free/paid, estado,
  valor, vencimiento).

Todo acotado por RLS a la empresa del comercio. **Beta jamás ve lo de Alfa**
(probado). La pantalla que muestra esto en la app es la **Fase 2** (en curso).

---

## 5. Pendiente por acordar con Membego

- **SSO de empleados (Fase 3):** que un empleado entre al car wash con su cuenta
  de Membego. Requiere que Membego actúe como proveedor **OIDC** (endpoints de
  authorize/token/userinfo, `client_id`/`client_secret`, y el `merchant_id`/rol
  en los *claims* para mapear al tenant). Se detallará cuando abordemos la fase.
- **Eventos salientes (Car Wash → Membego), opcional:** notificar a Membego de
  visitas y canjes hechos en el mostrador, para que la fidelidad se acumule allá.
  Requiere el endpoint receptor de Membego.

---

## 6. Para el equipo de Membego: checklist

1. Guardar, por cada car wash, su `SUPABASE_URL`, `service_role key` y el
   `secret` que devuelve `membego_link_merchant`.
2. Al seguir / adquirir / canjear, llamar la función correspondiente (§3).
3. Reintentar en fallo de red: las funciones son idempotentes.
4. Nunca exponer la `service_role key` fuera del backend.
