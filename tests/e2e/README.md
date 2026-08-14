# Ensayos de extremo a extremo — las 16 vistas

Ejecuta las vistas migradas contra la pila real —navegador → `supabase-js` →
PostgREST → PostgreSQL con RLS— sin necesidad del proyecto alojado.

**199 comprobaciones** en cinco ensayos (`pos-cash`, `invoices`,
`orders-kanban`, `admin-views` y `flujo-completo`).
Lo que verifican no es que el código compile, sino que el dinero acabe donde
debe:

| Bloque | Qué demuestra |
|---|---|
| Acceso | Sin sesión no se entra; una contraseña incorrecta no da acceso; la barra muestra la identidad real y no un selector de rol |
| Caja | El fondo se guarda en **centavos**; el esperado queda **oculto** durante el arqueo |
| POS | El catálogo viene de la base; el total previsualizado coincide con el del servidor; NCF correlativo; el cambio se calcula una sola vez; el inventario baja; la caja recibe el efectivo **neto** |
| Idempotencia | Dos clics seguidos en «Cobrar» emiten **una** factura |
| Autorización | Un cajero no puede anular **ni llamando al API directamente**, saltándose la interfaz |
| Cierre | El descuadre se calcula y guarda; el histórico conserva el turno |
| Facturas | Paginado y búsqueda **en el servidor**: 30 comprobantes, 25 por página |
| Anulación | Exige motivo y confirmación; emite nota de crédito **B04**, devuelve inventario y registra la devolución en caja |
| Impresión | En medio `print`, el ticket es lo único visible, anclado a la esquina y sobre fondo blanco |
| Diálogos | `role="dialog"`, cierre con Escape y foco atrapado |
| Órdenes | Registro de llegada con placa normalizada por el servidor; filtros y búsqueda en la base |
| Bahías | Iniciar lavado exige elegir bahía; la ocupada desaparece de las opciones y se libera al salir |
| Estados | Solo se ofrecen transiciones válidas, y la base rechaza un salto inválido aunque se llame al API |
| Comisiones | Se generan al entregar, con la tasa del operario asignado |
| Badge de cola | Sale de una consulta de solo-conteo y baja al entregar un vehículo, sin recargar |
| Panel | Los indicadores llevan rango de fechas real; el de "hoy" refleja solo lo de hoy |
| Gastos | Un gasto en efectivo descuenta la gaveta en la misma operación |
| Roles | El cajero ve catálogo, ajustes y comisiones en solo lectura, y la bitácora le está vedada |
| Notas de crédito | Se acredita 1 de 3 unidades: la factura sigue viva, la línea recuerda lo acreditado y el inventario vuelve solo por esa unidad |
| Fiscal | El rango NCF se carga con su correlativo en el inicio |
| Usuarios | El cambio de rol se guarda, pero nadie se asciende a sí mismo ni llamando al API |
| Avisos | El aviso al cliente se encola solo al quedar listo el vehículo; el barrido no duplica lo ya avisado y marcar sella la hora |
| Descuentos | El importe de la promoción lo calcula el servidor, no la pantalla; con techo puesto, un cajero no puede rebajar la factura a voluntad |
| Sucursales | El alcance solo se cambia por su RPC; quien queda limitado a una sucursal deja de ver las órdenes de la otra |
| Nómina | El sueldo solo se fija por su RPC —un UPDATE directo lo rechaza la base—; el adelanto sale de la gaveta y la nómina lo descuenta |
| Flotillas | La tarifa pactada gana al catálogo sin descuentos a mano; el vehículo entra a la flotilla y la orden queda sellada con ella |
| Crédito | El cupo solo se autoriza por su RPC; lo fiado abre cuenta por cobrar y **no entra a la caja**; el abono se guarda en centavos con su forma de pago |
| Importación | La previsualización no escribe ni una fila y aun así clasifica cada una; al aplicar, el mismo teléfono escrito de dos formas no duplica al cliente, y el cajero no importa ni llamando al API |
| Procedencia | La base sella de dónde vino cada cliente; el filtro pregunta al servidor; y vincular a Membego un cliente propio no lo cambia de canal, ni llamando al API |
| Tema | El modo día aclara el lienzo de verdad y el de noche lo oscurece —se mide la luminancia, no que «cambie»—; la elección sobrevive a recargar y «como el sistema» devuelve la decisión al sistema operativo |

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
node tests/e2e/invoices.e2e.mjs      # requiere reset.sh previo: siembra sus datos
node tests/e2e/orders-kanban.e2e.mjs # ídem
node tests/e2e/admin-views.e2e.mjs   # ídem
```

## Sobre el emulador

`supabase-proxy.mjs` cubre solo lo que usa el código migrado: emisión de JWT
firmados en `/auth/v1/token` y reenvío de `/rest/v1/**` a PostgREST. No es un
sustituto de Supabase ni forma parte de la aplicación; existe para poder
verificar sin depender de la red.

## El recorrido completo — `flujo-completo.e2e.mjs`

Los otros cuatro ensayos prueban módulos. Este prueba el **negocio**: hace el
viaje entero por la interfaz real, en orden —llega el cliente, se registra la
placa, se asigna bahía y operario, se lava, control de calidad, aviso al
cliente, cobro, entrega, reimpresión— y después de cada paso pregunta a
PostgreSQL qué quedó escrito.

Existe porque un sistema puede tener todas sus piezas funcionando y aun así no
servir: basta con que dos de ellas no se hablen.

**30 de 30 pasan.** Cuando se escribió, cinco fallaban, y todas por lo mismo:
el punto de venta no sabía nada de las órdenes de trabajo. `create_invoice`
aceptaba `p_work_order_id` desde la 0008 y desde la 0028 lo usaba para decidir
si la orden quedaba pagada, pendiente o parcial — pero la aplicación nunca se lo
pasaba. Ahora Ventas › Punto de venta trae la orden al cobro, y con ella el
comprobante queda atado al lavado y a la ficha del cliente.
