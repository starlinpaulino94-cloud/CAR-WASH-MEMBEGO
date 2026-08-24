# ADR-002 — La integración con MembeGo pasa por funciones serverless, no por el cliente

## Estado
Aceptada, con hallazgo de seguridad abierto (SEC-001).

## Contexto
El car wash consume la API de MembeGo con OAuth client-credentials. El
`client_secret` NO puede vivir en el navegador.

## Decisión
Las llamadas a MembeGo pasan por funciones Vercel (`api/membego/*`) que guardan
el secreto en variables de entorno del servidor y fijan el `companyId` en el
servidor (no lo elige el cliente). El webhook entrante valida HMAC-SHA256.

## Consecuencias
- (+) El secreto nunca sale al cliente. El companyId server-side evita fuga cross-tenant.
- (+) El webhook es a prueba de manipulación (firma en tiempo constante).
- (−) **SEC-001 (P0):** las funciones no autentican al usuario del car wash que
  las llama → deben exigir el JWT de Supabase. Pendiente de remediación.
