# Ensayo de extremo a extremo — POS y Caja

Ejecuta las vistas migradas contra la pila real —navegador → `supabase-js` →
PostgREST → PostgreSQL con RLS— sin necesidad del proyecto alojado.

**28 comprobaciones.** Lo que verifica no es que el código compile, sino que el
dinero acabe donde debe:

| Bloque | Qué demuestra |
|---|---|
| Acceso | Sin sesión no se entra; una contraseña incorrecta no da acceso; la barra muestra la identidad real y no un selector de rol |
| Caja | El fondo se guarda en **centavos**; el esperado queda **oculto** durante el arqueo |
| POS | El catálogo viene de la base; el total previsualizado coincide con el del servidor; NCF correlativo; el cambio se calcula una sola vez; el inventario baja; la caja recibe el efectivo **neto** |
| Idempotencia | Dos clics seguidos en «Cobrar» emiten **una** factura |
| Autorización | Un cajero no puede anular **ni llamando al API directamente**, saltándose la interfaz |
| Cierre | El descuadre se calcula y guarda; el histórico conserva el turno |

Cada aserción se comprueba consultando PostgreSQL directamente, no leyendo la
pantalla: lo que importa es lo que quedó escrito.

## Requisitos

- PostgreSQL 15+ (`psql` en el PATH) escuchando en el puerto 5433
- [PostgREST](https://postgrest.org) ≥ 12 en `tests/e2e/`
- `npm i -D playwright` y un Chromium disponible

## Ejecutar

```bash
# 1. Base con migraciones y datos de ensayo
./tests/e2e/reset.sh

# 2. Emulador de la superficie HTTP de Supabase
node tests/e2e/supabase-proxy.mjs &

# 3. Aplicación apuntando al emulador
VITE_SUPABASE_URL=http://127.0.0.1:3002 \
VITE_SUPABASE_ANON_KEY=clave-anon-de-pruebas \
npm run build && npx vite preview --port 4174 &

# 4. Ensayo
node tests/e2e/pos-cash.e2e.mjs
```

## Sobre el emulador

`supabase-proxy.mjs` cubre solo lo que usa el código migrado: emisión de JWT
firmados en `/auth/v1/token` y reenvío de `/rest/v1/**` a PostgREST. No es un
sustituto de Supabase ni forma parte de la aplicación; existe para poder
verificar sin depender de la red.
