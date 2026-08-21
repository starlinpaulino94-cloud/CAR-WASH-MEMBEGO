# SECURITY_AUDIT

> Referencia: OWASP Top 10:2025, ASVS 5.0. Cada hallazgo con evidencia y archivo.

## Resumen

El proyecto tiene una **base de seguridad fuerte y deliberada**: RLS ENABLE+FORCE
en las 56 tablas, 60 funciones SECURITY DEFINER **todas con `search_path` fijo**
(0 sin blindar), webhook con HMAC timing-safe, dinero en enteros, secretos solo
en comentarios de advertencia (0 exposiciones reales). El problema grave está en
**un** punto: los endpoints serverless de MembeGo no autentican al usuario.

---

## SEC-001 — Endpoints serverless de MembeGo sin autenticación de usuario · **P0**

**Archivos:** `api/membego/ficha.ts`, `api/membego/canjear.ts`,
`api/membego/revertir.ts`, `api/membego/tipos-vehiculo.ts`

**Problema:** Ninguno de los cuatro verifica la identidad ni la sesión del
usuario que llama. No leen el JWT de Supabase, no comprueban rol. `grep` de
`getUser|Authorization.*Bearer|verifyJwt` sobre estos archivos: 0 coincidencias.
Cualquiera que conozca la URL pública (`https://SU-CARWASH.vercel.app/api/membego/ficha`)
puede invocarlos, y el servidor ejecuta la acción usando la credencial MembeGo
del negocio.

**Exploit:**
1. `POST /api/membego/ficha` con `{ "telefono": "809-..." }` → devuelve la ficha
   MembeGo (membresías, vehículos, datos personales) de cualquier cliente cuyo
   teléfono se adivine o se itere. **Fuga de datos personales.**
2. `POST /api/membego/canjear` o `/revertir` → consumir o revertir lavados de
   membresía sin ser empleado. **Manipulación de un activo con valor.**

**Mitigante parcial (verificado):** el `companyId` se fija en el servidor desde
`MEMBEGO_COMPANY_ID`, no lo elige el cliente. Por eso **no** hay fuga
cross-tenant: un atacante solo alcanza los clientes de *esta* empresa. La
gravedad sigue siendo P0 por la exposición de PII y la manipulación del canje.

**Impacto de negocio:** exposición de datos de clientes (privacidad, posible
obligación legal), y consumo/reversión fraudulenta de beneficios.

**Causa raíz:** las funciones se escribieron para ser llamadas "desde nuestra
propia SPA" y se asumió esa confianza, pero una función serverless pública no
tiene forma de saber quién la llama sin verificarlo.

**Solución recomendada:** exigir el JWT de Supabase del usuario en cada uno de
los cuatro endpoints (leer `Authorization: Bearer`, validar contra el JWKS de
Supabase o con `auth.getUser`), y comprobar el rol mínimo (cajero+). Rechazar
con 401 si falta. El webhook (`api/membego/webhook.ts`) NO entra aquí: valida
firma HMAC y es correcto.

**Validación requerida:** prueba que un `POST` sin token devuelve 401; e2e que
el POS siga funcionando enviando el token.

---

## SEC-002 — Dependencia transitiva vulnerable (nanoid < 3.3.18) · **P3**

**Evidencia:** `npm audit` → 1 high (nanoid), vía `autoprefixer > postcss > nanoid`.
**Es dependencia de desarrollo** (PostCSS en build), no llega al bundle de
producción. Riesgo real bajo. **Solución:** `npm audit fix` y fijarlo en CI.

---

## Controles que PASAN (con evidencia)

| Control | Resultado | Evidencia |
|---|---|---|
| Aislamiento multi-tenant (RLS) | PASS | 56/56 tablas ENABLE+FORCE; 124 políticas |
| Escalada por SECURITY DEFINER | PASS | 60/60 con `search_path` fijo |
| Secretos en código/bundle | PASS | 0 exposiciones; solo comentarios de advertencia; no hay `.env` en git |
| `service_role` en cliente | PASS | usada solo en `api/membego/webhook` (server), nunca en `src/` |
| Webhook injection | PASS | HMAC-SHA256 en cuerpo crudo, `timingSafeEqual`, firma antes de escribir |
| Dinero / precisión | PASS | 0 columnas de dinero en flotante; centavos bigint |
| DELETE silencioso por RLS | PASS | `adminRepository` hace `.select()` y verifica filas (patrón documentado) |
| SQL injection en RPC | PASS (revisión) | RPCs parametrizadas; `search_path` fijo |

## No verificado (UNVERIFIED, no PASS)

- **Rate limiting** en login/registro/reset/endpoints públicos: no hay evidencia
  de límites en el código; Supabase Auth trae algunos por defecto pero **no está
  verificado** para los endpoints `api/membego/*`. → tratar como hueco (ver
  REMEDIATION).
- **CSRF**: la SPA usa JWT en header (no cookies de sesión para las mutaciones
  de datos vía PostgREST), lo que reduce el riesgo, pero los endpoints `api/`
  aceptan POST sin token anti-CSRF — mitigado si SEC-001 exige Bearer.
- Comportamiento de auth real contra GoTrue de producción.
