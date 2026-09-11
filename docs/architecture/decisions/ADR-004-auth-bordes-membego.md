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
invocan como primera acción, antes de tocar Membego. Tres preguntas:
1. Exige `Authorization: Bearer <jwt de Supabase>`; sin él, 401.
2. Valida el token preguntando a Supabase (`GET /auth/v1/user`) — la autoridad,
   sin verificar firma a mano.
3. Exige rol de mostrador (cajero/supervisor/administrador/propietario/superadmin)
   y `is_active`, consultando `profiles` con el token del usuario (la RLS le deja
   ver solo su fila). `operario` no entra: no cobra.
4. **Exige que sea de ESTA empresa**: el Supabase es multi-tenant (muchas
   empresas en un proyecto), así que un cajero de OTRO car wash pasaría 1-3. Se
   comprueba que el vínculo de su empresa (`membego_company_links`, leído bajo
   RLS) apunte al `MEMBEGO_COMPANY_ID` de este despliegue y esté activo.

Se usa la `anon key` (no secreta), NO la `service_role`, para no ampliar la
superficie de la credencial más poderosa.

## Historia
La primera versión omitió el paso 4. Una **revisión de seguridad independiente**
(implementer ≠ sole auditor) lo detectó como H1: sin el binding de empresa,
cualquier empleado de mostrador de cualquier inquilino del mismo Supabase podía
alcanzar los clientes de este local. Se corrigió antes de cerrar Phase 0. Es la
demostración de por qué el ciclo exige un auditor que no sea el autor.

## Alternativas descartadas
- **Verificar la firma del JWT a mano (JWKS):** obliga a traer las claves y
  acertar con el algoritmo; más superficie de error para el mismo resultado.
- **Usar service_role para leer profiles:** funcionaría pero regala a cuatro
  bordes más el poder de saltarse la RLS. Innecesario.

## Consecuencias
- (+) El agujero se cierra en UN lugar reutilizado (causa raíz única).
- (+) `operario` y anónimos quedan fuera; el POS (cajero+) sigue funcionando.
- (−) Tres round-trips a Supabase por llamada (validar token + leer perfil +
  leer vínculo). Aceptable: estos bordes no son ruta caliente.
- (−) Requiere una variable nueva en Vercel: `SUPABASE_ANON_KEY` (no secreta).

## Validación
`tests/api/auth-membego.test.mjs`: 11 casos de unidad del guard (incluidos los
tres del candado de empresa del paso 4) + 4 source-checks (un borde por
endpoint) de que el guard va antes de tocar Membego. 15/15. Las 250
comprobaciones e2e siguen verdes.

---

## Anexo (auditoría de operación): el guard también tiene que saber decir POR QUÉ

Un guard bien hecho responde «no». Eso basta para la seguridad y no basta para
la operación: en producción, sus cinco motivos de rechazo —falta una variable,
dos proyectos de Supabase distintos, sesión vencida, rol sin permiso, vínculo
invisible por RLS— llegan al mostrador como el mismo aviso amarillo. La única
forma de distinguirlos era leer los logs de Vercel, que el dueño de un lavadero
no tiene.

`api/membego/diagnostico.ts` corre **los mismos pasos, uno a uno**, y nombra el
que falla. Tres decisiones que lo sostienen:

1. **Los pasos se extraen a funciones** (`pasoSesion`, `pasoPerfil`,
   `pasoVinculo`) y `exigirEmpleado` las compone. Reimplementar la comprobación
   en el diagnóstico habría creado una segunda copia de la regla; el día que
   alguien tocara una, el diagnóstico mentiría — peor que no tenerlo.

2. **Lo corre cualquier empleado autenticado, no solo el propietario.** Dos de
   las comprobaciones dependen de quién llama. Un diagnóstico que solo el dueño
   puede correr no ve el problema del cajero, que es el único que importa.

3. **Salir a Membego exige sesión; preguntar por un cliente exige el guard
   entero.** Es la parte que hay que vigilar: al no llamar a `exigirEmpleado` de
   una pieza, nada estructural impide que este borde se convierta en la puerta
   de atrás que el guard existe para cerrar. Lo impiden dos condiciones
   explícitas y las dos pruebas que las fijan.

Lo que devuelve es configuración del propio local —nombres de variables
presentes o ausentes, el host de la API, el id de empresa que el propietario
escribió a mano— y nunca un secreto; hay una prueba que lo comprueba carácter a
carácter.

**Validación:** `tests/api/diagnostico-membego.test.mjs`, 11 casos (8 de que el
informe acierta, 3 de que no es una puerta de atrás).
