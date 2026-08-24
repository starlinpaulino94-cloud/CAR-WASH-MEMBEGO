# DEPENDENCY_AUDIT

> Fase 11, 37. Supply chain y mapa de dependencias externas.

## package.json

| | Cantidad |
|---|---|
| Dependencias de producción | 18 |
| Dependencias de desarrollo | 11 |
| Lockfile versionado | Sí (`package-lock.json`) — builds reproducibles |

Superficie pequeña y sana. Stack conocido y mantenido: React 19, Vite 6, Tailwind
4, supabase-js, shadcn/Base UI, lucide.

## DEP-001 — nanoid < 3.3.18 (high) transitiva · P3

`npm audit`: 1 high. Cadena: `autoprefixer > postcss > nanoid`. **Dev-only**
(PostCSS en build); no llega al bundle de producción. `npm audit fix` lo resuelve.

## DEP-002 — Sin escaneo de dependencias en CI · P2

No hay Dependabot ni `npm audit` en CI (no hay CI). La Fase 11 lo pide. Una
vulnerabilidad nueva en una dep de producción pasaría inadvertida.

## Mapa de dependencias externas (Fase 37)

| Servicio | Propósito | Criticidad | Datos | Fallback | Lock-in | Migración |
|---|---|---|---|---|---|---|
| **Supabase** (Postgres+PostgREST+GoTrue) | Toda la persistencia, auth, authz | **P0 crítico** | Todo | Ninguno | Alto (RLS+RPC son de Postgres, portables; PostgREST/GoTrue no) | Media: la base es Postgres estándar; auth habría que reimplementar |
| **Vercel** | Hosting SPA + funciones serverless | P0 | — | Ninguno | Medio | Baja: SPA estática + funciones portables a otro host |
| **MembeGo** (plataforma) | Membresías, canje | P1 | Clientes/membresías | Degradación: el POS funciona sin MembeGo (la ficha simplemente no carga) | Alto (es el socio de negocio) | N/A — es el producto |

**Vendor lock-in — respuesta a "¿y si desaparece el proveedor mañana?":**
- Supabase: la base es PostgreSQL estándar con lógica en SQL portable. Auth y la
  capa REST habría que reemplazar, pero **no se pierde el modelo ni los datos**.
- Vercel: migración trivial (build estático + funciones).
- MembeGo: no es reemplazable — es el socio. Pero su caída **degrada, no tumba**:
  el car wash sigue cobrando sin membresías (verificado: los endpoints devuelven
  error controlado y la UI lo maneja).

Riesgo de lock-in **conocido y aceptable**. El más pegado es Supabase, mitigado
por usar SQL estándar.
