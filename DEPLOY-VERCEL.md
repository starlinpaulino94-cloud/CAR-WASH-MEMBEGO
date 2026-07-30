# Desplegar en Vercel

La aplicación es un SPA de Vite (solo estáticos): Vercel la compila y sirve el
contenido de `dist/`. No hay servidor propio. Toda la lógica de datos vive en
Supabase, protegida por RLS.

El repositorio ya trae **`vercel.json`** con todo resuelto: comando de compilación,
carpeta de salida, *fallback* de SPA, cabeceras de seguridad (CSP, HSTS, etc.) y
caché inmutable para los assets con hash. No hace falta configurar nada de eso a
mano.

---

## Antes de empezar

Debes tener ya aplicado en Supabase (lo hicimos en los pasos anteriores):

1. `supabase/membego_schema_completo.sql` — el esquema.
2. `supabase/bootstrap_empresa_usuario.sql` — tu empresa y tu usuario propietario.

Sin eso, la app despliega igual pero no podrás iniciar sesión contra datos reales.

---

## Paso 1 · Importar el proyecto

**Opción A — Panel de Vercel (recomendada)**

1. Entra a <https://vercel.com> → **Add New… → Project**.
2. Importa el repositorio de GitHub `starlinpaulino94-cloud/car-wash-membego`.
3. En **Framework Preset** verás **Vite** detectado solo. Déjalo así.
4. No toques *Build Command* ni *Output Directory*: los fija `vercel.json`.
5. Elige la rama a desplegar (`main`, o la rama de trabajo si aún no has
   fusionado).

**Opción B — CLI**

```bash
npm i -g vercel
vercel            # primer despliegue de vista previa
vercel --prod     # despliegue de producción
```

---

## Paso 2 · Variables de entorno (imprescindible)

En **Project → Settings → Environment Variables** añade estas dos, marcando los
tres entornos (Production, Preview, Development):

| Nombre | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://ewtuavdebwzrjojifqyr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | la *anon public* key (Supabase → Settings → API) |

- Estas variables se **incrustan en el bundle al compilar**: si las cambias,
  hay que **volver a desplegar** para que tomen efecto.
- La `anon key` es **pública por diseño**; lo que protege los datos es RLS.
- **Nunca** pongas aquí la `service_role`: se salta RLS por completo.

> Si olvidas estas variables, la app despliega igual pero arranca en **modo
> demostración** (datos solo en el navegador, con un aviso). No es un fallo:
> es el comportamiento a prueba de fallos. Añade las variables y vuelve a
> desplegar para conectarla a la base real.

---

## Paso 3 · Desplegar y entrar

1. Pulsa **Deploy**. La primera compilación tarda ~1–2 min.
2. Abre la URL que te da Vercel.
3. Inicia sesión con el correo y la contraseña de tu usuario propietario.
4. Si ves el banner "Modo demostración", revisa el Paso 2.

---

## Sobre Supabase y el dominio

`supabase-js` habla con Supabase usando la `anon key`; la API REST y Auth de
Supabase **aceptan peticiones desde cualquier origen**, así que **no hace falta
configurar CORS** para tu dominio de Vercel.

Lo único que conviene revisar, si más adelante activas correos de Supabase
(recuperación de contraseña, invitaciones): en **Supabase → Authentication →
URL Configuration**, pon tu dominio de Vercel como **Site URL**. Con el flujo
actual (usuarios creados desde el panel con *Auto Confirm*) no es necesario.

---

## Qué incluye `vercel.json`

- **Compilación**: `npm run build` → `dist/`, preset Vite.
- **Instalación**: salta la descarga de navegadores de Playwright
  (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), que solo hace falta para las pruebas
  locales y si no, alargaría la build.
- **Fallback de SPA**: cualquier ruta desconocida sirve `index.html` (Vercel
  atiende primero los archivos reales, así que los assets no se ven afectados).
- **Cabeceras de seguridad** en todas las respuestas:
  - `Content-Security-Policy` estricta: scripts solo del propio origen
    (`script-src 'self'`), conexiones solo a `*.supabase.co` (REST y Realtime).
    Verificada en navegador: la app carga sin ninguna violación de CSP.
  - `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
    `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
    `Cross-Origin-Opener-Policy`.
- **Caché**: los assets con hash (`/assets/*`) se marcan `immutable` un año; el
  navegador los reutiliza entre despliegues.

Si en el futuro conectas Supabase Realtime a otro dominio, o cargas imágenes
desde otro host, habrá que ampliar `connect-src` / `img-src` en la CSP.
