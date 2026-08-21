# CURRENT_ARCHITECTURE

> Verificado por inspección de código y esquema. No es lo que "debería ser":
> es lo que hay.

## Stack real

| Capa | Tecnología | Evidencia |
|---|---|---|
| Frontend | React 19 + Vite 6 + TypeScript 5.8 + Tailwind 4 (SPA) | `package.json`, `vite.config.ts` |
| Ruteo | Router propio liviano (`NavigationContext`), no react-router | `src/lib/navigation.ts` |
| UI kit | shadcn/ui preset b0 (base-nova, Base UI) | `components.json`, `src/components/ui` |
| Backend de datos | Supabase: PostgreSQL 16 + PostgREST + GoTrue | `src/lib/supabase.ts` |
| Lógica de negocio crítica | **En la base**, como funciones PL/pgSQL (59 RPC llamados desde el cliente) | migraciones, `src/data/*Repository.ts` |
| Backend serverless | 8 funciones Vercel (`api/`), solo para la integración MembeGo | `api/` |
| Auth | Supabase Auth (GoTrue), JWT | `src/lib/supabase.ts` |
| Authz | **RLS en la base** (124 políticas, ENABLE+FORCE en las 56 tablas) + gates de UI espejo | esquema vivo |
| Despliegue | Vercel (build Vite + funciones) | `vercel.json` |
| Cache/Queue/Workers | **Ninguno** | — |
| Observabilidad | **Ninguna** (sin Sentry/logging estructurado/tracing) | grep vacío |

## Diagrama conceptual (real)

```
Usuario (personal del car wash)
   ↓  navegador
SPA React (Vite)  ──────────────┐
   ↓ supabase-js (JWT del usuario)   │ fetch a /api/membego/* (SIN auth de usuario — SEC-001)
PostgREST  ───────────────────────  Funciones Vercel (api/)
   ↓ RLS + RPC (SECURITY DEFINER)      ↓ OAuth client-credentials
PostgreSQL 16 (lógica + datos)      Plataforma MembeGo
   ↑ webhook firmado HMAC ────────────┘
```

## Dónde vive la lógica

**Decisión arquitectónica central: la lógica de negocio y la autorización viven
en la base de datos, no en el frontend ni en un backend de aplicación.** El
frontend llama RPCs (`create_invoice`, `annul_invoice`, `cancel_work_order`,
`advance_work_order`, …) que encapsulan la regla y la transacción. La RLS es la
frontera de seguridad real; los gates de `src/lib/auth.ts` son solo UX.

Esto es **coherente y defendible** para un SaaS sobre Supabase: es la forma
correcta de usar esa plataforma. No es "arquitectura accidental".

## Separación de capas

| Frontera | ¿Existe? | Nota |
|---|---|---|
| UI ↔ acceso a datos | Sí | `src/data/*Repository.ts` aísla las llamadas Supabase de las vistas |
| Lógica de negocio ↔ datos | Sí | vive en RPC/PLpgSQL en la base |
| Infra ↔ app | Parcial | la SPA conoce la URL de Supabase por env; MembeGo va por funciones |

**Deuda arquitectónica identificada:** la lógica de negocio de la cobertura de
membresía existe en DOS lugares — `src/lib/coberturaMembego.ts` (cálculo en
cliente para previsualizar) y la plataforma MembeGo (autoridad real). Es
deliberado (preview vs. verdad) pero debe documentarse como duplicación
controlada, no accidental.

## Lo que NO es deuda (para no sobre-arquitectar)

- No hay microservicios, ni Kafka, ni Redis, ni CQRS. **Correcto**: un car wash
  SaaS no los necesita. La arquitectura es un **monolito modular** (SPA + base
  con lógica) y es la más simple que soporta el producto.
- No introducir ninguna de esas piezas sin una razón demostrable (ver ADRs).
