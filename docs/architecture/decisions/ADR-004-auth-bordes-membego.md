# ADR-004 — Los bordes de Membego exigen el JWT de Supabase del usuario

## Estado
Aceptada. Implementa la remediación de SEC-001 (Phase 0 del REMEDIATION_PLAN).

## Contexto
Los cuatro endpoints serverless `api/membego/*` actúan con la credencial de
Membego del negocio (consultar ficha por teléfono, canjear/revertir lavados).
Una función serverless es una URL pública: sin verificar quién llama, cualquiera
con la URL podía exponer PII de clientes o manipular beneficios. El `companyId`
ya era server-side (sin fuga entre empresas), pero faltaba probar que el llamante
es un empleado de ESTA empresa.

## Decisión
Un guard único (`api/_membego/auth.ts` → `exigirEmpleado`) que los cuatro bordes
invocan como primera acción, antes de tocar Membego:
1. Exige `Authorization: Bearer <jwt de Supabase>`; sin él, 401.
2. Valida el token preguntando a Supabase (`GET /auth/v1/user`) — la autoridad,
   sin verificar firma a mano.
3. Exige rol de mostrador (cajero/supervisor/administrador/propietario/superadmin)
   y `is_active`, consultando `profiles` con el token del usuario (la RLS le deja
   ver solo su fila). `operario` no entra: no cobra.

Se usa la `anon key` (no secreta), NO la `service_role`, para no ampliar la
superficie de la credencial más poderosa.

## Alternativas descartadas
- **Verificar la firma del JWT a mano (JWKS):** obliga a traer las claves y
  acertar con el algoritmo; más superficie de error para el mismo resultado.
- **Usar service_role para leer profiles:** funcionaría pero regala a cuatro
  bordes más el poder de saltarse la RLS. Innecesario.

## Consecuencias
- (+) El agujero se cierra en UN lugar reutilizado (causa raíz única).
- (+) `operario` y anónimos quedan fuera; el POS (cajero+) sigue funcionando.
- (−) Dos round-trips a Supabase por llamada (validar token + leer perfil).
  Aceptable: estos bordes no son ruta caliente.
- (−) Requiere una variable nueva en Vercel: `SUPABASE_ANON_KEY` (no secreta).

## Validación
`tests/api/auth-membego.test.mjs`: 8 casos de unidad del guard + 4 source-checks
(un borde por endpoint) de que el guard va antes de tocar Membego. 12/12.
Las 250 comprobaciones e2e siguen verdes.
