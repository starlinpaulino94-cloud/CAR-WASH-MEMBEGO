# Auditoría de Escalabilidad, Rendimiento y Preparación para Producción

**Sistema:** Membego Car Wash Operations
**Repositorio:** `starlinpaulino94-cloud/CAR-WASH-MEMBEGO` · commit `c307572`
**Fecha:** 29 de julio de 2026
**Alcance:** 100% del código fuente (34 archivos, 5.486 líneas), configuración de build, dependencias y artefacto de producción compilado.
**Método:** lectura completa del código, compilación real (`npm run build`), verificación de tipos (`tsc --noEmit`) y medición empírica de costos de serialización y capacidad de almacenamiento.

---

## Estado de correcciones (actualizado)

Este documento es la auditoría del commit `c307572`. Desde entonces se han aplicado tres
correcciones del bloque *Inmediato* (§20), verificadas en navegador con 31 comprobaciones
automatizadas. El resto del informe describe el estado auditado y **sigue vigente**.

| Hallazgo | Estado |
|---|---|
| **C8** — PII real en el bundle público | ✅ **Corregido.** Datos sintéticos (`example.com`, prefijo 555). Verificado ausente del artefacto servido |
| **C7** — `JSON.parse` sin protección + sin Error Boundary | ✅ **Corregido.** Hidratación tolerante a fallos con cuarentena de datos ilegibles, versionado de esquema y frontera de error con vía de recuperación |
| **C3** — Cuota agotada con pérdida silenciosa | ⚠️ **Mitigado, no resuelto.** El fallo ahora es visible (aviso crítico al operador + preaviso al 80%). **El techo de ~1.500 órdenes sigue existiendo**: solo desaparece con un backend |
| **C1** — Sin backend, datos no compartidos | ✅ **Resuelto.** Esquema PostgreSQL con las 16 vistas migradas y verificadas contra la pila real |
| **C2** — Sin autenticación | ✅ **Resuelto.** Sesión real con los 8 roles; el `<select>` de identidad ya no existe |
| **C4** — Estado que no se persistía | ✅ **Resuelto.** Todo vive en la base; `localStorage` queda solo para el modo demostración |
| **C6** — Numeración fiscal aleatoria | ✅ **Resuelto.** NCF correlativo de rangos autorizados y notas de crédito B04 |
| **C9** — Anulación que no revertía nada | ✅ **Resuelto.** `annul_invoice()` atómico con reversión de caja e inventario |
| **C10** — Sin aislamiento multi-tenant | ✅ **Resuelto.** RLS forzado en todas las tablas + claves foráneas compuestas |
| **C11** — Efecto de red en un updater de React | ✅ **Resuelto.** Las mutaciones van por RPC del servidor |
| **C12** — Cero pruebas sobre el dinero | ✅ **Resuelto.** 137 comprobaciones de esquema y 114 de extremo a extremo |
| **C3** — Cuota de `localStorage` | ✅ **Deja de aplicar** con la base conectada; sigue vigente en modo demostración |
| **C5** — Sin copias de seguridad | ❌ **Abierto.** Depende del despliegue, no del código: exige PITR y restauración probada |
| **C7, C8** | ✅ Resueltos previamente |

### Dos correcciones al propio informe

Al aplicar los arreglos aparecieron dos hechos que obligan a rectificar lo que este
documento afirmaba:

**1. §14.1 se quedó corto: `tsc --noEmit` no comprobaba nada de React.**
El informe decía que la verificación de tipos «pasa limpio, pero está comprobando muy poco».
La realidad es peor: **`@types/react` y `@types/react-dom` no estaban instalados** y React 19
no incluye tipos propios. Con `noImplicitAny` desactivado, TypeScript trataba `React` y todos
los hooks, componentes y props como `any` **en silencio, sin emitir un solo error**. El único
control de calidad del proyecto no estaba comprobando la capa React en absoluto. Al instalar
los tipos apareció **un error real preexistente**: la firma de `addWorkOrder` no excluía
`companyId`, `branchId` ni `membegoBenefitDiscount`, campos que su propia implementación
rellena. Ambas cosas quedan corregidas.

**2. §6.2-B subestimó la gravedad de la búsqueda de socios.**
El informe describía la coincidencia como «peligrosamente laxa» y señalaba el fallback
codificado. La verificación en navegador demostró un defecto mayor: la comparación por
teléfono hacía `phoneDigits.includes(queryDigits)` y, ante una consulta sin dígitos,
`queryDigits` era la cadena vacía. Como **`String.includes('')` es siempre `true`**,
**cualquier búsqueda sin números devolvía al primer socio del directorio con sus beneficios
del 100% de descuento** — no solo las cuatro palabras del fallback. Corregido con longitud
mínima de consulta, coincidencia exacta en identificadores y mínimo de 7 dígitos para el
teléfono.

---

## Advertencia previa: el hallazgo que reordena toda la auditoría

Antes de responder a las 17 secciones solicitadas hay que establecer un hecho que cambia el significado de todas las respuestas:

> **Esta aplicación no tiene backend. No tiene base de datos. No tiene autenticación. No tiene servidor de ningún tipo.**

Es una SPA de React que se ejecuta enteramente en el navegador y guarda **facturas, sesiones de caja, inventario y datos de clientes en `localStorage`**. `package.json` declara `express`, `dotenv`, `tsx` y `@types/express`, y el script `clean` borra un `server.js` — pero **ese archivo no existe** en el repositorio. Verificado:

```
$ find . -name "*.ts" -not -path "./node_modules/*" | grep -i server
(sin resultados)
```

La consecuencia operativa es inmediata y no admite matices: **cada navegador es una base de datos privada e independiente.** La tablet de recepción y la PC de caja del *mismo* car wash, en el *mismo* mostrador, tienen dos listas de órdenes distintas que nunca se sincronizan. No hay conflicto que resolver porque no hay nada que sincronizar.

Esto significa que la pregunta que se me pidió responder —*"¿soportará 1.000.000 de usuarios?"*— tiene una respuesta que no es un número de capacidad:

**El sistema falla funcionalmente en N = 2 dispositivos.** No en 10.000 usuarios concurrentes. En dos.

Todo lo que sigue debe leerse bajo esa luz. Cuando digo que un componente "fallará primero", no me refiero a que se degradará bajo carga: me refiero a que la premisa de producto —un SaaS multi-sucursal para operación de car wash— no está implementada. Lo que existe es un **prototipo de interfaz de alta fidelidad**, y como tal es un buen prototipo. Como sistema de producción, no lo es.

---

## Índice

1. [Simulación de crecimiento](#1-simulación-de-crecimiento)
2. [Arquitectura general](#2-arquitectura-general)
3. [Frontend](#3-frontend)
4. [Backend](#4-backend)
5. [Base de datos](#5-base-de-datos)
6. [API](#6-api)
7. [Seguridad (OWASP)](#7-seguridad-owasp)
8. [Escalabilidad](#8-escalabilidad)
9. [Rendimiento](#9-rendimiento)
10. [Caché](#10-caché)
11. [Infraestructura](#11-infraestructura)
12. [Observabilidad](#12-observabilidad)
13. [DevOps](#13-devops)
14. [Calidad del código](#14-calidad-del-código)
15. [Testing](#15-testing)
16. [Costos](#16-costos)
17. [Experiencia de usuario](#17-experiencia-de-usuario)
18. [Preparación para producción](#18-preparación-para-producción)
19. [Riesgos priorizados](#19-riesgos-priorizados)
20. [Roadmap técnico](#20-roadmap-técnico)
21. [Puntuaciones](#21-puntuaciones)
22. [Conclusión e informe ejecutivo](#22-conclusión-e-informe-ejecutivo)

---

## 1. Simulación de crecimiento

### 1.1 Usuarios registrados

| Escenario | Comportamiento real |
|---|---|
| 1.000 usuarios | **No es alcanzable.** No existe registro de usuarios. `initialUsers` es un array codificado de 6 personas (`initialData.ts:54`). No hay pantalla de alta, no hay endpoint, no hay tabla. |
| 10.000 / 100.000 / 500.000 / 1.000.000 | Misma respuesta. El sistema no puede registrar un séptimo usuario. |

Esto no es una limitación de escala; es la ausencia de la funcionalidad. El selector de usuario del `Navbar` (`Navbar.tsx:99-112`) recorre ese array fijo.

### 1.2 Usuarios concurrentes

Aquí hay que separar dos capas que se suelen confundir:

**Capa de entrega de assets (el archivo JS).** Es un bundle estático de 356,82 kB (95,97 kB gzip). Servido desde un CDN, 50.000 usuarios concurrentes son ~4,8 GB de egress si nada estuviera cacheado — trivial para cualquier CDN. **Esta capa nunca será el cuello de botella, ni a 1M de usuarios.**

**Capa de aplicación (el producto).** No existe. No hay servidor que reciba concurrencia.

| Concurrencia | Descarga del bundle | Estado funcional del producto |
|---|---|---|
| 100 | OK | 100 bases de datos mutuamente incoherentes |
| 500 | OK | 500 bases de datos mutuamente incoherentes |
| 1.000 | OK | ídem |
| 5.000 | OK | ídem |
| 10.000 | OK | ídem |
| 50.000 | OK | ídem |

La conclusión honesta: **el número de usuarios concurrentes que el sistema soporta correctamente es 1 por negocio**, y ese único usuario sufre pérdida de datos y degradación en cuestión de semanas (§1.3).

### 1.3 Qué falla primero — línea de tiempo real de un car wash de 6 bahías

Asumiendo operación normal (~80 vehículos/día, medido contra `initialBranches[0].baysCount = 6`):

| # | Falla | Cuándo ocurre |
|---|---|---|
| 1 | **Incoherencia entre dispositivos** — recepción y caja divergen | Minuto 0, al encender el segundo equipo |
| 2 | **Compromiso total de seguridad** — cualquiera se convierte en propietario | Minuto 0 |
| 3 | **Pérdida de datos al refrescar** — stock, gastos, bitácora y bahías se descartan | Primer F5 (día 1) |
| 4 | **Fiscalidad inválida** — comprobantes sin NCF, numeración aleatoria | Primera factura real |
| 5 | **Colisión de números de orden** (50% de probabilidad) | ~112 órdenes ≈ **día 2** |
| 6 | **Jank perceptible en la UI** (>50 ms por interacción) | ~1.000 órdenes ≈ **semana 2** |
| 7 | **Colisión de números de factura** (50%) | ~1.117 facturas ≈ **semana 3** |
| 8 | **Cuota de `localStorage` agotada → destrucción de datos** | ~1.500 órdenes ≈ **semanas 3-6** |

Los puntos 5, 7 y 8 están calculados, no estimados. Ver §5.2 y §9.2.

---

## 2. Arquitectura general

### 2.1 Lo que está bien hecho

Quiero ser justo antes de ser duro, porque hay trabajo real y competente aquí:

- **La estructura de carpetas es correcta y legible**: `types/`, `data/`, `context/`, `services/`, `components/{layout,views,modals}`. Un ingeniero nuevo entiende dónde está cada cosa en cinco minutos.
- **El modelo de dominio (`src/types/index.ts`, 424 líneas) es el mejor activo del repositorio.** Está pensado con conocimiento real del negocio: `ServicePriceByVehicle` con matriz de precios por categoría, `CashSession` con arqueo y diferencia, `NCF` fiscal, `CommissionEntry`, `VehicleInspection` con nivel de combustible y objetos de valor, `QualityCheck` con checklist. Esto no lo escribe alguien que no conoce la operación de un car wash. **Es la base sobre la que se debe construir el backend real** — no hay que tirarlo.
- La separación entre el servicio de integración (`membegoApi.ts`) y el estado de la aplicación es la decisión correcta, aunque hoy sea un mock.
- La consistencia visual es alta y disciplinada (Tailwind, escala de espaciado y color coherente en 18 vistas).

### 2.2 Los problemas arquitectónicos

**A. God Context.** `AppContext.tsx` (637 líneas) contiene el 100% del estado y de la lógica de negocio de la aplicación: clientes, vehículos, servicios, productos, órdenes, bahías, caja, facturas, gastos, comisiones, auditoría, integración Membego y estado de UI (`activeTab`, tres booleanos de modales). Un único proveedor con 40 valores en su interfaz.

*Por qué ocurre:* es el patrón por defecto cuando se prototipa rápido sin capa de datos.
*Impacto:* cualquier cambio de estado —abrir un modal— re-renderiza toda la aplicación (§3.2). Es imposible testear una regla de negocio de forma aislada. Es imposible reutilizar la lógica de facturación fuera de React.
*Solución:* extraer la lógica de dominio a módulos puros (`domain/billing.ts`, `domain/cash.ts`) sin dependencia de React, y dividir el contexto por bounded context. En Stripe o Shopify esta lógica viviría en el servidor y el cliente solo consumiría un API tipado.

**B. La lógica de negocio vive en la capa de presentación.** El cálculo de impuestos aparece duplicado en tres lugares con **tres fórmulas distintas**:

| Ubicación | Fórmula |
|---|---|
| `AppContext.tsx:304-306` (orden) | `taxable = subtotal − descuento − beneficioMembego` |
| `AppContext.tsx:452-453` (factura) | `taxable = subtotal − descuento` (**ignora el beneficio Membego**) |
| `PosView.tsx:105-106` (POS) | `taxable = subtotal − descuento` |

Una orden con beneficio Membego calcula un ITBIS distinto al de su propia factura. Esto es una divergencia contable, no una imperfección estética.

**C. No hay capa de servicios ni de repositorio.** Los componentes escriben directamente en el estado global. `NuevaLlegadaModal` orquesta transacciones de negocio (crear cliente + crear vehículo + reservar beneficio + crear orden, `NuevaLlegadaModal.tsx:121-219`) desde un manejador de click, sin atomicidad: si `reserveBenefit` falla, el cliente y el vehículo ya quedaron creados.

**D. Multi-tenancy decorativa.** `companyId` y `branchId` existen en todos los tipos y se estampan en cada registro, pero **ninguna consulta, filtro o vista los usa jamás.** `setCurrentBranch` (`Navbar.tsx:44-57`) cambia una etiqueta y nada más. El cajero de Santiago ve las órdenes, facturas, caja y clientes de Piantini. Además hay valores hardcodeados en al menos cinco sitios (`NuevaLlegadaModal.tsx:138-139,156,187`; `CustomersView.tsx:19-20`; `ExpensesView.tsx:585-586`).

Para un producto vendido como SaaS, **esta es la invariante más importante que falta**, y es la que se convierte en una brecha de datos entre clientes el día que se incorpore la segunda empresa.

**E. Escalabilidad horizontal: no aplica.** No hay proceso que escalar. Escalabilidad vertical: irrelevante por el mismo motivo. El límite es la RAM y la cuota de disco del navegador del cajero.

### 2.3 ¿Permitirá crecer durante los próximos años?

**No en su forma actual, pero el modelo de datos sí.** La arquitectura de ejecución (estado en cliente) debe reemplazarse por completo; el modelo de dominio de `types/index.ts` se traduce casi 1:1 a un esquema PostgreSQL y debería conservarse. Estimo que **entre el 15% y el 20% del código actual sobrevive** a la construcción del sistema real: los tipos, buena parte del diseño visual y los flujos de UX.

---

## 3. Frontend

### 3.1 Carga inicial y bundle

Compilación real verificada:

```
dist/assets/index-CZVWA764.css   46.92 kB │ gzip:  7.96 kB
dist/assets/index-CZVWA764.js   356.82 kB │ gzip: 95.97 kB
✓ built in 3.03s   (1697 módulos)
```

**Un solo chunk. Cero code splitting.** `App.tsx:5-22` importa estáticamente las 16 vistas y los 2 modales, y las renderiza con `&&` (`App.tsx:35-50`). No hay un solo `React.lazy` ni `Suspense` en el repositorio (verificado: 0 coincidencias).

Se descarga siempre, use o no el operador esas pantallas:
- `PhaseArchitectureReportModal.tsx` — 291 líneas de **prosa estática** (un documento de arquitectura en JSX).
- `initialData.ts` — **20.387 bytes** de datos semilla de demostración.
- Las 16 vistas completas.

En las tablets Android de gama media que viven en un mostrador de car wash, con 4G irregular, 96 kB gzip + parseo + hidratación se traducen en **3-6 s hasta la primera interacción**. Un POS debe estar operativo en menos de 1,5 s.

*Solución:* `React.lazy` por vista, mover el documento de arquitectura a Markdown estático fuera del bundle, cargar los datos semilla solo en modo demo. Reducción esperada del bundle inicial: **~60%**.

### 3.2 Re-renderizados: el problema de rendimiento dominante

El objeto `value` del provider se construye como literal nuevo en cada render (`AppContext.tsx:576-624`), **sin `useMemo`**. Y en todo el repositorio hay **cero** `useMemo`, `useCallback` y `React.memo` (verificado: 0 coincidencias).

Consecuencia medible: **cada pulsación de tecla en cualquier campo de búsqueda re-renderiza la aplicación completa.** Escribir "A982134" en el buscador de órdenes (`OrdersView.tsx:489`) dispara 7 ciclos completos, y en cada uno:

- `Sidebar.tsx:26` recorre todas las órdenes para el badge de la cola.
- `KanbanView.tsx:40` ejecuta **seis** `workOrders.filter` completos (uno por columna).
- `DashboardView.tsx:30-36` ejecuta cuatro `filter` y un `reduce` sobre todas las facturas.

Y un cambio de estado de una orden encadena, de forma **síncrona y bloqueante**: `map` sobre todo el array → re-render global → `JSON.stringify` → `localStorage.setItem` (escritura a disco síncrona).

### 3.3 Listas: sin paginación ni virtualización

Ninguna lista está paginada ni virtualizada. Renderizan **todas** las filas: órdenes (`OrdersView.tsx:523`), facturas (`InvoicesView.tsx:184`), clientes (`CustomersView.tsx:59`), vehículos, productos, gastos, bitácora de auditoría (`ReportsView.tsx:263`) y las seis columnas del Kanban.

Con 5.000 facturas eso son ~35.000 nodos DOM en una sola tabla: varios cientos de MB de memoria y *layout* de segundos.

*Solución:* `@tanstack/react-virtual` o `react-window` + paginación en servidor. Es lo que hace cualquier tabla de Shopify Admin o del dashboard de Stripe.

### 3.4 SSR / SSG / ISR / hidratación

No aplican: es CSR puro sobre Vite, sin framework de servidor. Para una herramienta interna tras login, CSR es una decisión defendible — pero entonces el *shell* debe cargar rápido y hoy no lo hace (§3.1). No hay `index.html` con contenido significativo (13 líneas, un `<div id="root">`).

### 3.5 Imágenes, fuentes, tree shaking

- **Imágenes:** no hay ninguna. `Company.logoUrl` (`types:52`) está definido y nunca se usa. No hay `<img>` en todo el proyecto, ni `loading="lazy"`, ni formatos modernos. Cuando se añadan logos y las fotos de inspección de vehículos (`VehicleInspection.exteriorPhotosUrl`, `types:198`) hará falta un pipeline completo que hoy no existe.
- **Fuentes:** se usa `font-sans` (stack del sistema). Es la decisión correcta: cero latencia, cero CLS.
- **Tree shaking:** funciona. `lucide-react` se importa con nombres. Pero hay ~30 iconos importados y nunca usados (`Search`, `Filter`, `QrCode`, `ChevronRight`, `Sparkles`, `Download`…), invisibles porque `noUnusedLocals` está desactivado.

### 3.6 Componentes gigantes

| Archivo | Líneas | Problema |
|---|---|---|
| `AppContext.tsx` | 637 | 20 funciones de negocio + 15 estados |
| `data/initialData.ts` | 801 | datos de demo en el bundle |
| `NuevaLlegadaModal.tsx` | 572 | wizard de 3 pasos, 12 `useState`, orquestación transaccional |
| `PosView.tsx` | 376 | catálogo + carrito + pagos + checkout |
| `PhaseArchitectureReportModal.tsx` | 291 | documentación como JSX |

`NuevaLlegadaModal` mantiene 12 piezas de estado independientes que deberían ser un `useReducer` o una máquina de estados (XState). El paso `'confirm'` está declarado en el tipo (`:24`) y **nunca se renderiza** — código muerto en el camino crítico de creación de órdenes.

### 3.7 Accesibilidad

Esta es una herramienta que un operario usa 8 horas seguidas. Los fallos aquí son fallos de producto, no de cumplimiento.

- **Tarjetas seleccionables como `<div onClick>`** (`NuevaLlegadaModal.tsx:512-514`, `PosView.tsx:462-465`, `:477-480`): no reciben foco, no responden a teclado, no anuncian estado. **El POS no se puede operar con teclado** — y en un mostrador con guantes mojados, el teclado y el escáner son más rápidos que el táctil.
- **Ningún modal es accesible**: sin `role="dialog"`, sin `aria-modal`, sin trampa de foco, sin cierre con `Escape`, sin restauración de foco al cerrar, sin bloqueo del scroll de fondo (`NuevaLlegadaModal.tsx:222`, `TicketPreviewModal.tsx:22`, `PhaseArchitectureReportModal.tsx:15`).
- **Validación con `window.alert()`** en 5 sitios (`NuevaLlegadaModal.tsx:123,128,479`; `PosView.tsx:111,116`): bloquea el hilo, no se asocia al campo, no hay `aria-live`.
- **Botones solo-icono sin `aria-label`**: reimprimir, anular, +/− de cantidad, cerrar modal.
- **Contraste insuficiente**: `text-slate-500` sobre `bg-slate-950` (`Sidebar.tsx:92`, `PosView.tsx:279`) queda claramente por debajo del 4,5:1 de WCAG AA.
- **`<html lang="en">`** (`index.html:2`) en una interfaz íntegramente en español: los lectores de pantalla usan fonética inglesa.

### 3.8 Responsive

- **La barra lateral es `w-64` fija, sin colapso ni hamburguesa ni drawer** (`Sidebar.tsx:88`). En un teléfono de 375 px ocupa permanentemente el **68% del viewport**.
- **Cinco tablas sin contenedor de scroll horizontal** (`CustomersView.tsx:48`, `InvoicesView.tsx:172`, `ProductsView.tsx:19`, `VehiclesView.tsx:19`, `ExpensesView.tsx:609`): desbordan el `body` y rompen el layout. Solo `OrdersView` y `ServicesView` lo tienen.
- **El Kanban no hace scroll horizontal como se pretende**: es un `grid` con `overflow-x-auto` e hijos `min-w-[240px]` (`KanbanView.tsx:38`); los items de grid no producen ese comportamiento — las columnas se comprimen.

### 3.9 UX bajo carga

No hay skeletons en ninguna vista. No hay estado de carga en el checkout ni en la creación de órdenes (ambos con `await`). No hay indicador de progreso. Bajo latencia, el operador no sabe si su acción se registró — y pulsa otra vez (§4.4).

---

## 4. Backend

**No existe.** Esta sección documenta lo que la ausencia implica, porque el enunciado pide analizar organización, servicios, controladores, capas, transacciones, concurrencia, colas e idempotencia — y cada uno de esos puntos tiene una consecuencia concreta aquí.

### 4.1 Transacciones y atomicidad

`createInvoice` (`AppContext.tsx:435-538`) ejecuta cuatro mutaciones que **deben ser atómicas** y no lo son:

1. Insertar la factura (`:483`)
2. Actualizar los totales de la sesión de caja (`:499-506`)
3. Marcar la orden como pagada (`:511-520`)
4. Descontar stock, ítem por ítem (`:524-533`)

Un error, un cierre de pestaña o una excepción entre los pasos 2 y 4 deja el sistema en estado inconsistente **sin ninguna posibilidad de rollback**. En un sistema real esto es una transacción `SERIALIZABLE` o, como mínimo, un patrón outbox.

### 4.2 Efecto secundario dentro de un actualizador de estado

```tsx
// AppContext.tsx:343-364
setWorkOrders(prev => prev.map(order => {
  if (order.id === orderId) {
    ...
    if (newStatus === 'entregado' && order.membegoRedemptionId) {
      membegoApiService.confirmRedemption(...);   // ← llamada de red DENTRO del updater
    }
```

Las funciones actualizadoras de React **deben ser puras**. React las invoca más de una vez de forma deliberada (`StrictMode`, activo en `main.tsx:7`) y puede reejecutarlas bajo renderizado concurrente.

*Impacto:* **la confirmación de consumo del beneficio se dispara dos veces por cada entrega** en desarrollo, y de forma no determinista en producción. Contra una API Membego real, eso consume el beneficio del cliente dos veces.

*Solución:* mover el efecto fuera del updater, a un `useEffect` que observe la transición, o a una cola de comandos.

### 4.3 Idempotencia: implementada al revés

```tsx
// NuevaLlegadaModal.tsx:183
idempotencyKey: `idemp-reserve-${Date.now()}-${plate}`
```

El propósito de una clave de idempotencia es que **un reintento lleve la misma clave**. Aquí cada intento genera una clave nueva, con lo que el `Set` de claves procesadas (`membegoApi.ts:212`) nunca puede coincidir. **La protección está escrita pero es inoperante por construcción.**

Si `reserveBenefit` sufre un timeout y la recepcionista vuelve a pulsar, se crean dos reservas y se consumen dos beneficios.

La clave de confirmación (`idemp-confirm-${order.id}`, `AppContext.tsx:358`) **sí** es estable y correcta — pero `confirmRedemption` (`membegoApi.ts:243-265`) **nunca consulta el `Set`**, así que tampoco es idempotente.

### 4.4 Sin protección contra doble envío

`handleCheckout` (`PosView.tsx:109`) no se deshabilita mientras procesa ni tiene guarda de operación en curso. **Doble clic = dos facturas, doble descuento de stock, doble ingreso en caja.** Lo mismo en `handleCreateOrder` (`NuevaLlegadaModal.tsx:121`), que además espera una llamada de red sin ningún indicador.

### 4.5 Colas, tareas asíncronas, bloqueos, race conditions

- **Colas:** no hay. La "resiliencia offline" que promete la UI (`Navbar.tsx:85`, `membegoApi.ts:137`) no tiene cola de reintento: cuando la API está marcada como caída, `reserveBenefit` devuelve un mensaje diciendo que "se sincronizará al reconectar" (`membegoApi.ts:206-210`) y **no se guarda nada en ninguna parte**. La promesa es falsa.
- **Bloqueos / race conditions:** dentro de una sola pestaña no hay concurrencia real. Pero **dos pestañas del mismo navegador sí compiten por `localStorage`** y se pisan mutuamente sin detección: la última escritura gana y la otra pestaña ni se entera (no hay listener de `storage`).
- **Control de concurrencia optimista:** no existe ningún campo `version`, `updatedAt` o ETag en ningún tipo.

---

## 5. Base de datos

**No existe una base de datos.** El almacén persistente es `localStorage`: un key-value síncrono, sin transacciones, sin restricciones, sin índices, sin tipos, sin migraciones y sin copias de seguridad, con una cuota dura de ~5 MB por origen.

### 5.1 Pérdida de datos garantizada: estado leído pero nunca escrito

Este es un defecto confirmado, no una hipótesis. Diez porciones de estado se **hidratan** desde `localStorage`, pero solo cinco se **persisten**:

| Clave | Se lee | Se escribe | Consecuencia al refrescar |
|---|---|---|---|
| `membego_cw_workorders` | :149 | :184 ✅ | — |
| `membego_cw_customers` | :129 | :188 ✅ | — |
| `membego_cw_vehicles` | :134 | :192 ✅ | — |
| `membego_cw_invoices` | :164 | :196 ✅ | — |
| `membego_cw_cashsession` | :159 | :200 ✅ | — |
| `membego_cw_company` | :118 | ❌ **nunca** | configuración revertida |
| `membego_cw_services` | :139 | ❌ **nunca** | servicios creados desaparecen |
| `membego_cw_products` | :144 | ❌ **nunca** | **todo descuento de stock se pierde** |
| `membego_cw_bays` | :154 | ❌ **nunca** | estado de bahías revertido |
| `membego_cw_expenses` | :169 | ❌ **nunca** | **gastos desaparecen; la caja deja de cuadrar** |
| `commissions` | — | ❌ ni se intenta (:173) | comisiones perdidas |
| `auditLogs` | — | ❌ ni se intenta (:174) | **bitácora perdida** |

Traducido a la operación:

- **Todo descuento de inventario hecho en el POS** (`createInvoice`, `:524-533`) **se descarta al refrescar la página.** El stock vuelve a los valores de demostración.
- **Todo gasto registrado** (`addExpense`, `:555`) desaparece — y con él la salida de efectivo correspondiente, con lo que el arqueo deja de cuadrar sin explicación posible.
- La bitácora de auditoría se pierde entera, mientras la pantalla se titula **"Reportes & Audit Trail Inalterable"** (`ReportsView.tsx:239`). Es la afirmación más grave del sistema y es exactamente lo contrario de lo que ocurre.

### 5.2 La cuota de `localStorage` es un acantilado de destrucción de datos

Medición real (script ejecutado sobre un `WorkOrder` representativo con 2 ítems):

```
bytes/orden (UTF-8):                    1.442
unidades UTF-16/orden:                  1.437
órdenes hasta agotar 5 MB (solo esta clave): 3.648
```

Compartiendo el origen con facturas, clientes y vehículos, el techo práctico es de **~1.200-1.800 órdenes**.

Un car wash de 6 bahías procesa 60-120 vehículos/día. **El sistema destruye sus propios datos en 3 a 6 semanas de uso real.**

Y cuando se alcanza la cuota, `setItem` lanza `QuotaExceededError` **dentro de un `useEffect`** (`:184`) sin `try/catch`: la escritura falla en silencio o el efecto revienta. En ambos casos las últimas transacciones se pierden y **el operador no recibe ningún aviso**. Sigue cobrando creyendo que se está guardando.

### 5.3 Sin protección ante corrupción, sin versionado de esquema

Cada inicializador hace `JSON.parse(saved)` sin `try/catch` (`:119,130,135,140,145,150,155,160,165,170`).

Un solo valor corrupto —cuota agotada a mitad de escritura, cierre abrupto del navegador, edición manual, o **un cambio de tipo en una versión nueva**— lanza una excepción durante el primer render. React no monta. **Pantalla en blanco permanente, irrecuperable por el usuario.** Y no hay ningún Error Boundary en el árbol (verificado: 0 coincidencias).

No hay clave de versión de esquema. **Publicar cualquier cambio de tipos deja inservible toda instalación existente**, sin ruta de migración.

### 5.4 Colisiones de identificadores (matemática del cumpleaños)

**Números de orden** — `AppContext.tsx:289`:
```js
`CW-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
```
9.000 valores posibles. Probabilidad del 50% de colisión en n ≈ 1,1774·√9000 ≈ **112 órdenes**. Es decir: **un día y medio de operación.**

**Números de factura** — `:458`: 900.000 valores → 50% en ≈ **1.117 facturas** (~2-3 semanas).

**Todos los IDs de entidad** usan `Date.now()`: `order-`, `cust-`, `veh-`, `audit-`, `exp-`, `inv-`, `cses-`, `serv-`, `prod-`. Colisionan siempre que dos entidades se crean en el mismo milisegundo — que es **exactamente lo que ocurre en cada "Nueva Llegada"**: `addCustomer` + `addVehicle` + `addWorkOrder` + tres `addAuditLog` se ejecutan en el mismo tick (`NuevaLlegadaModal.tsx:137-216`). Las tres entradas de auditoría reciben **el mismo `id`** (`audit-${Date.now()}`, `:213`) y se renderizan con `key={log.id}` (`ReportsView.tsx:263`) → claves duplicadas y corrupción de reconciliación en React.

*Solución:* UUIDv7 o ULID para IDs internos (ordenables por tiempo, sin colisión); secuencias del lado del servidor para todo número visible al cliente o al fisco.

### 5.5 Dinero en punto flotante

Todos los importes son `number` de JavaScript (IEEE-754 binario). El impuesto se calcula con `Math.round(taxable * rate/100)` (`:305`, `:452`), **redondeando a pesos enteros en silencio**, y los subtotales se acumulan con `+=` sobre flotantes (`:296-302`).

Sobre miles de transacciones esto produce una deriva que **jamás podrá reconciliarse contra el conteo físico de efectivo**. Todas las empresas de pagos (Stripe, Adyen, Square) almacenan dinero como enteros en la unidad menor. Aquí no.

### 5.6 Normalización, índices, particionado, sharding, integridad

- **Normalización:** el modelo de tipos está razonablemente normalizado (referencias por `customerId`, `vehicleId`, `bayId`), pero hay desnormalización deliberada y sin sincronización: `customerName`, `vehicleMakeModel`, `assignedEmployeeNames`, `bayName` se copian dentro de `WorkOrder`. Al renombrar un cliente, las órdenes históricas conservan el nombre viejo — aceptable como *snapshot* documental, pero no está declarado como tal en ningún sitio.
- **Índices:** el concepto no existe. Toda búsqueda es `Array.filter` con `String.includes` → O(n) por pulsación de tecla.
- **Claves foráneas / integridad referencial:** cero. Nada impide una orden con `customerId` inexistente.
- **Particionado / sharding / réplicas:** no aplica.
- **Migraciones:** no existen (§5.3).
- **N+1:** no aplica sin base de datos, pero el patrón equivalente sí está presente: `createInvoice` ejecuta un `setProducts` con `map` completo **por cada ítem del carrito** (`:524-533`) — O(items × productos) y N re-renders en lugar de una sola actualización.

### 5.7 ¿Soportará millones de registros?

**No soporta dos mil.** El límite duro medido es de ~1.500 órdenes por dispositivo.

---

## 6. API

### 6.1 API propia

No existe. No hay REST, ni GraphQL, ni tRPC, ni endpoints. Por tanto: sin versionado, sin paginación, sin filtros de servidor, sin ordenamiento, sin compresión negociada, sin rate limiting, sin caché HTTP, sin contratos.

### 6.2 API Membego (simulada)

`membegoApi.ts` (295 líneas) es un mock en memoria. Su **diseño de contratos es correcto y merece reconocerse**: separa `reserve` / `confirm` / `cancel` (patrón de reserva en dos fases, que es exactamente lo que se necesita para no consumir un beneficio si el lavado se cancela), contempla claves de idempotencia y registra una bitácora de sincronización. Quien diseñó esto entendía el problema.

Los defectos de la implementación:

**A. Delay fijo, sin timeout, sin reintentos, sin circuit breaker.** `await new Promise(r => setTimeout(r, 300))` (`:142`). Contra una API real: sin `AbortController`, sin backoff exponencial, sin jitter, sin límite de reintentos. Una API Membego lenta congela la recepción indefinidamente.

**B. Búsqueda de cliente peligrosamente laxa** (`:147-161`):
```js
c.phone.replace(/[^0-9]/g,'').includes(cleanQuery.replace(/[^0-9]/g,'')) ||
c.email.toLowerCase().includes(cleanQuery) ||
c.name.toLowerCase().includes(cleanQuery)
```
Una consulta de dos caracteres coincide con el socio equivocado. Peor: hay un *fallback* hardcodeado que devuelve al cliente VIP si la consulta contiene `"starlin"`, `"9001"`, `"prado"` o `"a982134"` (`:159-161`). En producción esto **regala servicios gratis a quien escriba "prado"**.

**C. Reglas de negocio del beneficio no validadas.** `allowedPlates`, `expiresAt` y `usesRemaining` se **muestran** en la interfaz (`NuevaLlegadaModal.tsx:368`) pero **nunca se comprueban** antes de aplicar el beneficio (`:108-119`). Un beneficio caducado, agotado o de otra placa se honra igual.

**D. `discountPercentage` se ignora por completo.** El beneficio de encerado cerámico es del **50%** (`membegoApi.ts:64`), pero al aplicarlo el código pone `discount: unitPrice, total: 0` (`NuevaLlegadaModal.tsx:173-174`) → **se regala al 100%**. Pérdida directa de ingresos en cada uso.

**E. Coincidencia de servicios por texto difuso.** `s.name.toLowerCase().includes(benefit.serviceName.toLowerCase())` (`:111`) y `appliedBenefit.serviceName.includes(service.name)` (`:96`). Renombrar un servicio en el catálogo hace que un beneficio del 100% se aplique al servicio equivocado.

**F. Store mutable externo leído durante el render.** `MembegoHubView.tsx:336` llama a `membegoApiService.getSyncLogs()` en el cuerpo del componente. El servicio es un singleton mutado fuera de React (`membegoApi.ts:287-292`). Bajo renderizado concurrente esto produce *tearing*; hoy simplemente muestra logs obsoletos. La primitiva correcta es `useSyncExternalStore`.

---

## 7. Seguridad (OWASP)

### 7.1 A01 — Broken Access Control · **CRÍTICO**

**No hay autenticación de ningún tipo.** No hay pantalla de login, no hay contraseña, no hay sesión, no hay token.

El cambio de identidad es un `<select>` en la barra superior (`Navbar.tsx:99-112`):

```tsx
<select value={currentUser.id} onChange={e => setCurrentUser(users.find(...))}>
  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
</select>
```

**Cualquier persona con acceso físico al dispositivo se convierte en propietario en dos clics** y puede anular facturas, cerrar caja y ver todos los reportes financieros.

`User.pinCode` está definido en el tipo (`types:82`) y sembrado con `'1234'` (`initialData.ts:83`) — pero **no se verifica en ningún punto del código** (verificado: solo 2 coincidencias, ambas declarativas).

Y no hay **ni una sola comprobación de rol en toda la aplicación**. El tipo `UserRole` define ocho roles; ninguna vista, botón u operación consulta `currentUser.role` para autorizar. Anular una factura (`InvoicesView.tsx:203`) está disponible para todos, sin confirmación y con motivo hardcodeado.

### 7.2 A02 — Fallos criptográficos · **ALTO**

Datos financieros y PII (nombres, teléfonos, correos, RNC/cédula, placas) almacenados **en texto plano en `localStorage`**, accesible por cualquier script del origen y por cualquiera con acceso al perfil del navegador. Sin cifrado en reposo. Sin política de retención. Sin borrado.

### 7.3 A03 — Inyección · **BAJO** (el único apartado en buen estado)

- **SQL / NoSQL injection:** no aplica (no hay base de datos ni servidor).
- **XSS:** **no encontré ningún vector.** No hay `dangerouslySetInnerHTML`, ni `innerHTML`, ni `eval`, ni `new Function` en todo el repositorio (verificado). El escapado por defecto de React se respeta en todas partes. Es un punto genuinamente correcto.

Advertencia: el día que se muestren notas o nombres provenientes de la API Membego con cualquier renderizador de HTML, este riesgo aparece de golpe. Hoy no existe.

### 7.4 A05 — Configuración de seguridad incorrecta · **ALTO**

- Sin **Content-Security-Policy**, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` ni `Permissions-Policy`. No hay `_headers`, `netlify.toml`, `vercel.json`, ni servidor que los emita.
- **Clickjacking:** sin `X-Frame-Options: DENY` ni `frame-ancestors`, la aplicación puede embeberse en un iframe. Combinado con la ausencia total de autenticación (§7.1), un iframe malicioso puede operar la caja.
- **CORS/CSRF:** no aplican hoy (no hay servidor). En el momento en que exista backend, ambos pasan a ser críticos.
- **SSRF:** no aplica.

### 7.5 A07 — Fallos de identificación y autenticación · **CRÍTICO**

Cubierto en §7.1. No hay sesiones, ni expiración, ni bloqueo por intentos, ni MFA, ni rotación. Para un sistema de caja donde la trazabilidad "quién cobró qué" es el control antifraude primario, **la ausencia de identidad verificable invalida todos los demás controles.**

Agravante: incluso la trazabilidad que *parece* existir es falsa. `NuevaLlegadaModal.tsx:214-215` estampa `createdBy: 'usr-3', createdByName: 'Ana Beltrán'` **hardcodeado**, sea quien sea el usuario activo; `ExpensesView.tsx:592` hace lo mismo con `'usr-2'`. La bitácora atribuye acciones a la persona equivocada.

### 7.6 A09 — Fallos de registro y monitorización · **CRÍTICO**

La bitácora de auditoría existe en memoria y **nunca se persiste** (§5.1). Se pierde en cada refresco. La pantalla que la muestra se titula "Audit Trail **Inalterable**". No hay firma, ni hash encadenado, ni almacenamiento append-only, ni envío a ningún sistema externo. `AuditLog.ipAddress` (`types:423`) nunca se rellena.

### 7.7 Fuga de información · **ALTO**

**PII real de una persona identificable está compilada dentro del bundle público de JavaScript.** `membegoApi.ts:27-102` codifica una "Membego Cloud Database" con nombre, teléfono `809-771-4400` y correo `starlin.eltanquemotors@gmail.com`.

Verificado en el artefacto compilado:
```
$ grep -c "starlin.eltanquemotors@gmail.com\|809-771-4400" dist/assets/index-CZVWA764.js
2
```

Cualquiera que cargue el sitio puede leerlo con Ctrl+U. Es divulgación de datos personales, con independencia de que se considere "solo demo".

### 7.8 Secretos, subida de archivos, validación de entrada

- **Secretos:** `.gitignore` cubre `.env*` correctamente y no encontré secretos comprometidos. Pero `.env.example` exige `GEMINI_API_KEY` y `metadata.json` declara `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` **para una funcionalidad que no existe en el código** — configuración muerta que confundirá a quien despliegue.
- **Subida de archivos:** no implementada (aunque el modelo la contempla en `VehicleInspection.exteriorPhotosUrl`). Cuando se implemente, hará falta validación de tipo, límite de tamaño, escaneo y URLs firmadas.
- **Validación de entrada:** prácticamente inexistente. Las placas no se validan (formato, longitud, duplicados). Los teléfonos y correos no se validan. `initialAmountInput` y `cashTendered` aceptan negativos (`type="number"` sin `min`). No hay ninguna librería de esquemas (Zod/Valibot). Cero validación en el límite de confianza — que hoy es el `onChange` de un input.

---

## 8. Escalabilidad

| Eje de crecimiento | Límite actual | Qué ocurre al superarlo |
|---|---|---|
| **Usuarios** | 6 fijos, sin registro | No se puede crear el séptimo |
| **Empresas (tenants)** | 1 | La segunda empresa **ve los datos de la primera** (§2.2-D) |
| **Sucursales** | 2 decorativas | Ambas comparten un único conjunto de datos |
| **Dispositivos por negocio** | **1** | El segundo dispositivo ve datos distintos; sin sincronización |
| **Órdenes** | ~1.500-3.600 | Cuota agotada → pérdida silenciosa (§5.2) |
| **Facturas** | ~1.100 antes de colisión de numeración | Duplicados fiscales |
| **Tráfico** | Ilimitado (CDN) | Único eje que sí escala |
| **Archivos** | 0 | No implementado |
| **Transacciones/s** | ~1 por dispositivo, humana | No aplica |

**Límite aproximado antes de requerir cambios mayores: cero.** Los cambios mayores hacen falta antes del primer usuario de pago, no después de cierto volumen.

---

## 9. Rendimiento

### 9.1 Cuellos de botella, en orden de impacto

1. **Serialización síncrona en cada mutación** (`AppContext.tsx:183-201`): cinco `useEffect` que hacen `JSON.stringify` del array completo y `localStorage.setItem` (escritura a disco síncrona, bloquea el hilo principal).
2. **Re-render global en cada cambio de estado** (§3.2): `value` del contexto sin memoizar, cero `React.memo`.
3. **Recorridos O(n) repetidos por render**: 6 `filter` en Kanban, 4 `filter` + 1 `reduce` en Dashboard, 1 `filter` en Sidebar, búsquedas con `includes` sin debounce.
4. **Listas sin virtualizar** (§3.3).
5. **Bundle monolítico** (§3.1).

### 9.2 Medición empírica

Benchmark ejecutado en Node (máquina rápida, **sin** incluir la escritura a disco de `localStorage`):

| Órdenes | Tamaño | `JSON.stringify` | `JSON.parse` (arranque) | `map` completo |
|---|---|---|---|---|
| 500 | 0,51 MB | 1,9 ms | 2,0 ms | 0,03 ms |
| 2.000 | 2,06 MB | 7,4 ms | 8,3 ms | 0,04 ms |
| 5.000 | 5,15 MB | 14,0 ms | 21,8 ms | 0,12 ms |
| 20.000 | 20,63 MB | 83,1 ms | 150,1 ms | 0,68 ms |

Estas cifras son el **piso optimista**. En una tablet Android de gama media, con el `setItem` síncrono incluido, hay que multiplicar por 3-10×.

Traducción operativa: **jank perceptible (>50 ms por interacción) alrededor de las 1.000 órdenes — unas dos semanas de operación**, bastante antes de llegar al acantilado de cuota. Y el `JSON.parse` del arranque se suma al *time-to-interactive* en cada carga.

### 9.3 Memoria

Cada mutación de orden crea un array nuevo completo más objetos nuevos. Sin virtualización, 5.000 facturas ≈ 35.000 nodos DOM. En un dispositivo de mostrador que no se reinicia en semanas, esto termina en un tab crash sin diagnóstico posible (no hay telemetría, §12).

### 9.4 Operaciones bloqueantes

- `localStorage.setItem` — síncrono, disco.
- `window.alert()` — 5 sitios, bloquea el hilo.
- `window.print()` — bloquea (y además no funciona, §17.2).
- `JSON.parse` de arranque — bloquea el primer render.

---

## 10. Caché

**No hay estrategia de caché de ningún tipo.** Ni Redis, ni CDN configurado, ni caché HTTP, ni caché de consultas, ni de sesiones, ni service worker.

Nota importante sobre el modo offline: la aplicación **parece** funcionar sin internet porque los datos están en `localStorage`, pero **no hay service worker ni manifest**, así que una carga en frío sin red no muestra nada. La promesa de "Modo Contingencia Local" (`Navbar.tsx:85`) solo cubre una caída *de Membego*, no una caída de internet — que es el escenario real de un car wash dominicano.

**Recomendaciones, por orden de valor:**

| Capa | Herramienta | Dónde | Por qué |
|---|---|---|---|
| Assets estáticos | CDN (Cloudflare/CloudFront) con `immutable` | bundle hasheado | Coste marginal cero, gran ganancia de TTFB |
| Shell de aplicación | Service Worker (Workbox) + manifest | `index.html` + assets | Habilita el offline real que el producto promete |
| Datos del cliente | TanStack Query | reemplazo del contexto | Caché, deduplicación, reintentos, revalidación |
| Datos calientes de servidor | Redis | catálogo de servicios/productos, sesión, rate limit | Catálogos cambian poco y se leen en cada pantalla |
| Base de datos | Réplicas de lectura | reportes y dashboards | Aísla la analítica del camino transaccional |
| Cola offline | IndexedDB + Background Sync | operaciones pendientes | `localStorage` es síncrono y con cuota; IndexedDB no |

---

## 11. Infraestructura

Estado actual: **no hay infraestructura definida.** Sin `Dockerfile`, sin `docker-compose`, sin manifiestos de Kubernetes, sin IaC (Terraform/Pulumi), sin configuración de despliegue de ningún proveedor.

| Elemento | Estado | Nota |
|---|---|---|
| Docker | ❌ | — |
| Kubernetes | ❌ | Innecesario a esta escala; empezar con un PaaS |
| Balanceador | ❌ | No hay nada que balancear |
| CDN | ❌ | Debería ser lo primero: es gratis y da la mayor ganancia |
| Almacenamiento | ❌ | Sin object storage para fotos de inspección |
| **Backups** | ❌ | **No existe copia de seguridad de ningún dato.** Formatear el equipo del cajero destruye el histórico completo de facturación |
| Replicación / HA / failover | ❌ | No aplica |
| Autoescalado | ❌ | No aplica |

**El punto de los backups merece énfasis:** un negocio que factura tiene obligación legal de conservar sus comprobantes. Hoy el único ejemplar vive en el perfil de Chrome de una tablet. Un robo, una caída del equipo o un "limpiar datos de navegación" borra la contabilidad completa sin recuperación posible.

**Arquitectura objetivo recomendada** (dimensionada al problema real, no sobre-diseñada):

```
Cloudflare CDN  →  App estática (Vercel/Cloudflare Pages)
                     │
                     ▼
              API (Node/Fastify o Go)  ──►  Redis (sesiones, catálogo, rate limit)
              contenedor en Fly.io / Cloud Run
                     │
                     ▼
              PostgreSQL gestionado (Neon/RDS)
              PITR + réplica de lectura
                     │
                     ▼
              S3/R2 (fotos de inspección, firmas)
```

Esto atiende cómodamente **10.000+ negocios** con costes de tres cifras mensuales. No hace falta Kubernetes hasta mucho después.

---

## 12. Observabilidad

**Cero. Nada. En ninguna de las siete dimensiones solicitadas.**

| Dimensión | Estado |
|---|---|
| Logs | ❌ Dos `console.error` (`NuevaLlegadaModal.tsx:78`, `MembegoHubView.tsx:346`) que nadie leerá jamás |
| Métricas | ❌ |
| Tracing | ❌ |
| Monitoreo / uptime | ❌ |
| Alertas | ❌ |
| Dashboards | ❌ |
| Auditoría | ❌ Existe en memoria, se pierde al refrescar (§5.1) |
| Seguimiento de errores | ❌ Sin Sentry ni equivalente, y sin Error Boundary que capture nada |

La implicación práctica: cuando un cajero diga *"ayer la caja no cuadró"*, **no existe ni un solo dato con el que investigar.** No hay logs, no hay traza, y la bitácora que debía servir para eso no se guardó. Es imposible distinguir un error de software de un fraude.

**Recomendación mínima para el día 1 de producción:**

| Necesidad | Herramienta | Coste |
|---|---|---|
| Errores de cliente + sesiones | Sentry | Gratis hasta 5k eventos/mes |
| Logs y métricas de backend | Axiom o Better Stack | ~$25/mes |
| Uptime + alertas | Better Stack / Checkly | ~$10/mes |
| RUM (Core Web Vitals) | Cloudflare Web Analytics | Gratis |
| Tracing distribuido | OpenTelemetry → Grafana Tempo | Cuando haya >2 servicios |
| Auditoría inmutable | Tabla append-only en Postgres + hash encadenado | — |

---

## 13. DevOps

| Elemento | Estado | Detalle |
|---|---|---|
| CI/CD | ❌ | No existe `.github/` |
| Pipelines | ❌ | — |
| Despliegue | ❌ | Sin configuración de ningún proveedor |
| Rollback | ❌ | — |
| Entornos (dev/stage/prod) | ❌ | Solo `npm run dev` |
| Gestión de secretos | ⚠️ | `.gitignore` correcto; el resto es config muerta (§7.8) |
| Pruebas automáticas | ❌ | Ninguna (§15) |
| Calidad de código | ⚠️ | Solo `tsc --noEmit`, y sin `strict` (§14.1) |
| **Lockfile** | ❌ | **No hay `package-lock.json`** |

**El lockfile ausente es más grave de lo que parece.** Con 10 dependencias directas en rango `^` (incluidos React y Vite), dos compilaciones del mismo commit pueden producir artefactos distintos. `npm ci` es imposible. Una versión transitiva rota o comprometida entra directamente a producción sin que nadie lo note. Es un riesgo de cadena de suministro elemental y de solución trivial: `npm install && git add package-lock.json`.

**Dependencias muertas** que se instalan y nunca se importan: `@google/genai`, `motion` (framer-motion), `express`, `dotenv`, `@types/express`, `tsx`. Y `vite` aparece **duplicado** en `dependencies` y en `devDependencies`.

**Pipeline mínimo recomendado** (GitHub Actions):
```
push → npm ci → tsc --noEmit → eslint → vitest run → build → preview deploy
main → + playwright e2e → deploy prod → smoke test → rollback automático si falla
```

---

## 14. Calidad del código

Esta es, junto al modelo de dominio, **el área más fuerte del proyecto**. La nomenclatura es consistente, la organización de archivos es predecible, los componentes son legibles y el estilo es uniforme en 5.486 líneas. No es código descuidado.

Dicho eso:

### 14.1 `tsconfig.json` sin `strict`

No están activados `strict`, `strictNullChecks`, `noImplicitAny`, `noUnusedLocals` ni `noUncheckedIndexedAccess`. `tsc --noEmit` pasa limpio, pero **está comprobando muy poco**.

Ejemplo latente ya presente: `cashSession?.expectedCash.toLocaleString()` (`DashboardView.tsx:235`) — el encadenamiento opcional se detiene en `cashSession`, así que `expectedCash` se asume presente; y la etiqueta dice "Caja Abierta" esté abierta o no. Además `MembegoSyncLog.requestPayload` y `responsePayload` son `any` (`types:405-406`).

Sobrantes en la configuración: `experimentalDecorators`, `useDefineForClassFields: false` y `allowJs` en un proyecto sin clases con campos, sin decoradores y sin JavaScript.

### 14.2 DRY

- Cálculo de impuestos duplicado **tres veces con tres fórmulas distintas** (§2.2-B). Este es el peor caso de duplicación del repositorio porque las copias **divergen**.
- El patrón de badge de estado de orden está copiado en `DashboardView`, `OrdersView` y `KanbanView` con clases ligeramente distintas.
- Los estilos de tabla se repiten literalmente en siete vistas.
- `toLocaleString()` se invoca en ~40 sitios sin locale, sin un formateador de moneda centralizado.

### 14.3 SOLID

- **SRP:** violado en `AppContext` (20 responsabilidades) y en `NuevaLlegadaModal` (UI + orquestación transaccional + llamadas de red).
- **OCP:** añadir una vista exige tocar `App.tsx`, `Sidebar.tsx` y el contexto.
- **DIP:** los componentes dependen del singleton concreto `membegoApiService`, no de una abstracción → imposible sustituirlo en pruebas.

### 14.4 Complejidad y deuda técnica

- `createInvoice` (`AppContext.tsx:435-538`): 103 líneas, 4 mutaciones de estado, 2 bucles anidados.
- `handleCreateOrder` (`NuevaLlegadaModal.tsx:121-219`): 98 líneas orquestando 5 operaciones.
- **Código muerto:** el paso `'confirm'` del wizard (`:24`) nunca se renderiza; `setCommissions` se declara y nunca se llama (`:173`); `CashMovement` (`types:358`) nunca se instancia; `totalInflows` nunca se incrementa; `updateBayStatus` nunca se invoca desde el flujo de órdenes; `Company.logoUrl`, `Company.timezone`, `AuditLog.ipAddress`, `User.pinCode`, `ServicePackage`, `VehicleInspection` y `QualityCheck` están definidos y no se usan.
- **Valores de demo en flujos de producción:** el POS arranca con cliente "Cliente General POS", placa "A712994" y efectivo recibido 1000 (`PosView.tsx:36-42`); el arqueo arranca con 3000/7300 (`CashView.tsx:9-10`); la llegada arranca con Toyota/Corolla/Blanco (`NuevaLlegadaModal.tsx:37-39`). Los operadores publicarán estos valores en registros reales.
- **Historial de Git:** 2 commits, todo el código en un único *squash*. Sin README, sin LICENSE, sin ADRs, sin convención de commits.

---

## 15. Testing

```
$ find . -name "*.test.*" -o -name "*.spec.*"
(sin resultados)
```

| Tipo | Cobertura |
|---|---|
| Unitarias | **0%** |
| Integración | **0%** |
| E2E | **0%** |
| Carga | **0%** |
| Estrés | **0%** |
| Resiliencia / caos | **0%** |
| Recuperación | **0%** |

No hay runner de tests, ni archivo de test, ni configuración de cobertura, ni linter más allá de `tsc --noEmit`.

**Porcentaje del sistema realmente protegido por pruebas: 0%.**

Para una aplicación cuyo propósito íntegro es **manejar efectivo y emitir comprobantes fiscales**, este es el hallazgo que escalaría con más fuerza después de la ausencia de backend y de autenticación. Nada impide que un refactor rompa el cálculo del ITBIS o la cuadratura de caja sin que nadie se entere hasta el arqueo.

**Suite mínima antes de cualquier lanzamiento** (mi recomendación de prioridad estricta):

1. **Unitarias del dominio monetario** — cálculo de impuestos, descuentos, beneficios Membego, cambio, cuadratura de caja. Property-based testing con `fast-check` para las invariantes: *el total nunca es negativo*, *esperado = inicial + entradas − salidas*, *ninguna suma pierde centavos*.
2. **Integración de la transacción de facturación** — factura + caja + stock + orden se aplican todas o ninguna.
3. **E2E (Playwright)** de los tres caminos críticos: llegada → lavado → entrega; POS → cobro → ticket; apertura → ventas → arqueo → cierre.
4. **Idempotencia**: doble clic en cobrar debe producir **una** factura.
5. **Recuperación**: `localStorage` corrupto no debe dejar pantalla en blanco.

Objetivo razonable: **>90% de cobertura en la lógica monetaria**, >60% global. En un sistema de pagos, la lógica de dinero se prueba al 100%.

---

## 16. Costos

Respuesta honesta sobre el estado actual: **la infraestructura cuesta prácticamente $0 a cualquier volumen**, porque no hay cómputo ni base de datos. Un bundle estático en Cloudflare Pages atiende 1.000.000 de usuarios dentro del plan gratuito o cerca de él.

Pero eso no es una virtud: es el síntoma de que el sistema no hace nada del lado del servidor. El coste real aparece cuando se construye el producto que se está prometiendo. Proyección del sistema objetivo (§11), asumiendo negocios de car wash con ~5 usuarios cada uno:

| Escala | CDN/Hosting | Cómputo API | PostgreSQL | Redis | Object storage | Observabilidad | **Total/mes** |
|---|---|---|---|---|---|---|---|
| 10.000 usuarios | $0-20 | $25-50 | $25-70 | $10 | $5 | $30 | **~$95-185** |
| 100.000 usuarios | $20-50 | $150-300 | $200-400 | $50 | $40 | $150 | **~$610-990** |
| 500.000 usuarios | $100-200 | $600-1.200 | $800-1.500 | $200 | $200 | $500 | **~$2.400-3.800** |
| 1.000.000 usuarios | $200-400 | $1.200-2.500 | $1.800-3.500 | $400 | $500 | $1.000 | **~$5.100-8.300** |

**Qué dominará el coste, en orden:**

1. **PostgreSQL** — el histórico de órdenes y facturas crece de forma monótona y nunca se borra por obligación fiscal.
2. **Cómputo de la API** — proporcional a las transacciones, no a los usuarios registrados.
3. **Object storage** — las fotos de inspección de vehículos son el eje de crecimiento silencioso: 6 fotos × 500 kB × 100 vehículos/día × 365 días × miles de negocios llega a petabytes muy rápido.
4. **Observabilidad** — el coste que siempre se subestima; los logs sin muestreo se disparan.

**Optimizaciones con mejor retorno:**

- **Particionado temporal de órdenes/facturas** (`PARTITION BY RANGE` mensual) + archivado a almacenamiento frío pasados 12-24 meses. Es la palanca de mayor impacto sobre el coste de base de datos.
- **Comprimir y redimensionar las fotos en el cliente** antes de subirlas (WebP/AVIF, máx. 1600 px). Reduce el object storage 10-20×.
- **Réplica de lectura para reportes**, para no dimensionar el primario por la analítica.
- **Muestreo de logs** al 1-5% en rutas de éxito, 100% en errores.
- **Vistas materializadas** para los KPIs del dashboard, refrescadas cada N minutos, en vez de recalcular sobre la tabla transaccional.

---

## 17. Experiencia de usuario

### 17.1 Lo que está bien

El diseño visual es sobresaliente para un producto interno: paleta oscura coherente, jerarquía tipográfica clara, badges de estado legibles a distancia (importante en un mostrador), espaciado disciplinado. El flujo de "Nueva Llegada" en 3 pasos está bien pensado desde el punto de vista de negocio. Los estados vacíos existen y están redactados ("El carrito está vacío", "Sin vehículos", "No hay logs de sincronización aún"). El Kanban refleja fielmente el flujo físico de un car wash. **Alguien entiende esta operación.**

### 17.2 El ticket no se imprime

`TicketPreviewModal.tsx:17-19` llama a `window.print()`. **No hay ni una sola regla `@media print` en el proyecto** — `src/index.css` es literalmente una línea:

```css
@import "tailwindcss";
```

Resultado: se imprime el dashboard completo, con fondo oscuro, recortado, sobre papel térmico de 80 mm. **El entregable central de un POS —el comprobante del cliente— no funciona.**

*Solución:* hoja de estilos de impresión que oculte todo salvo el contenedor del ticket (`printRef` ya existe en `:13`, no se usa), con `@page { size: 80mm auto; margin: 0 }`. A medio plazo, integración con ESC/POS vía WebUSB o agente local.

### 17.3 Velocidad percibida y feedback

- **Sin skeletons** en ninguna vista.
- **Sin estado de carga** en checkout ni en creación de orden — ambos con `await`. El operador no sabe si su acción se registró y **vuelve a pulsar** (§4.4).
- **Errores mediante `alert()`** (5 sitios): bloqueantes, sin contexto, sin asociación al campo.
- **Sin confirmación destructiva**: anular una factura ocurre al primer clic, con motivo hardcodeado (`InvoicesView.tsx:203`).
- **Sin deshacer** en ninguna operación.

### 17.4 Recuperación de errores

Sin Error Boundary: **cualquier excepción no capturada desmonta la aplicación entera y deja la pantalla en blanco** en mitad de un cobro. Sin reintentos. Sin estado offline visible más allá del toggle manual de Membego.

### 17.5 Conexiones lentas y móvil

Sin service worker (§10): una carga en frío sin red no muestra nada. La `<title>` es **"My Google AI Studio App"** (`index.html:3`), sin favicon, sin `theme-color`, sin manifest, sin `apple-mobile-web-app-capable`. Añadido a inicio en un iPhone, aparece como una captura genérica con nombre equivocado. Móvil: ver §3.8.

### 17.6 Un problema de diseño de control que quiero destacar

El "**Arqueo Ciego**" está anunciado dos veces en la interfaz (`CashView.tsx:22`, `:101`). Un arqueo ciego existe para que el cajero cuente el efectivo **sin conocer el importe esperado** — es el control antifraude primario de cualquier negocio de caja.

En esta implementación:
- El efectivo esperado se muestra en pantalla, en grande, justo al lado (`CashView.tsx:93`).
- El campo de conteo viene **pre-rellenado con 7300** (`CashView.tsx:10`).
- La diferencia se calcula y muestra en vivo mientras se escribe (`:118-123`).

Un arqueo ciego que te enseña la respuesta y además te la escribe no es un control debilitado: **es la eliminación del control, presentada como si existiera.** Este es el tipo de hallazgo que un auditor financiero marcaría antes que cualquier problema técnico de esta lista.

---

## 18. Preparación para producción

| Escenario | ¿Listo? | Justificación |
|---|---|---|
| **Producción** | ❌ **No** | Sin backend, sin autenticación, sin base de datos, sin backups, sin pruebas, con pérdida de datos garantizada y numeración fiscal inválida |
| **Lanzamiento global** | ❌ **No** | Sin i18n, sin multi-moneda funcional, sin multi-región, sin GDPR/LGPD, sin marco fiscal por país |
| **Lanzamiento regional** | ❌ **No** | La numeración NCF no cumple la normativa DGII (§18.1) |
| **Beta pública** | ❌ **No** | Cualquier usuario se autopromociona a propietario; se expone PII real en el bundle |
| **Beta cerrada** | ❌ **No** | Una beta cerrada implica datos reales de negocios reales. Este sistema los perderá |
| **Demo comercial / prototipo de validación** | ✅ **Sí** | **Para esto es excelente.** Es un prototipo de alta fidelidad, visualmente convincente y con flujos de negocio bien pensados. Sirve para validar el producto con clientes potenciales — con un aviso explícito de que no persiste datos |

### 18.1 Nota sobre cumplimiento fiscal (República Dominicana)

Esto no es un defecto de software; es exposición legal, y por eso lo separo.

- `invoiceNumber` = `FAC-${Math.floor(100000 + Math.random()*900000)}` (`AppContext.tsx:458`): **aleatorio**, no secuencial, no continuo, con colisiones a las ~1.100 facturas.
- `ncfFiscalNumber` es un parámetro opcional que **el POS nunca proporciona** (`PosView.tsx:120-133` pasa 6 argumentos, sin NCF). Toda factura emitida imprime "Consumidor Final" (`InvoicesView.tsx:189`).
- No existe asignación de secuencia NCF, ni control de rangos autorizados, ni tipificación B01/B02/B04.
- La anulación (`annulInvoice`, `:540`) invierte un booleano: **no emite nota de crédito (B04), no restaura el stock y no revierte los totales de la sesión de caja.** La caja y el inventario quedan permanentemente en desacuerdo con el libro de ventas.

Bajo la Norma 06-2018 de la DGII, un NCF debe provenir de una secuencia autorizada, controlada y correlativa. **Emitir estos tickets como comprobantes fiscales es un riesgo legal para el operador del car wash, no solo un bug.**

---

## 19. Riesgos priorizados

### 🔴 Riesgos críticos — caída, pérdida de datos, seguridad o corrupción

| # | Riesgo | Evidencia | Impacto |
|---|---|---|---|
| **C1** | **Sin backend: los datos no se comparten entre dispositivos** | Todo el estado en `localStorage` (`AppContext.tsx:117-171`) | El producto no funciona con 2 equipos. Recepción y caja divergen desde el minuto 0 |
| **C2** | **Sin autenticación: cualquiera es propietario** | `Navbar.tsx:99-112`, `pinCode` nunca verificado | Compromiso total. Anulación de facturas y cierre de caja sin control |
| **C3** | **Cuota de `localStorage` destruye datos en 3-6 semanas** | Medido: 1.437 unidades/orden, techo ~1.500-3.600 | Pérdida silenciosa del histórico de facturación, sin aviso |
| **C4** | **Stock, gastos, bitácora y bahías no se persisten** | 5 claves leídas y nunca escritas (§5.1) | Inventario y arqueo divergen de la realidad en cada refresco |
| **C5** | **Sin backups de ningún tipo** | No hay infraestructura (§11) | Un equipo perdido o formateado borra la contabilidad completa |
| **C6** | **Numeración fiscal aleatoria y sin NCF** | `:458`, `PosView.tsx:120-133` | Comprobantes inválidos ante la DGII. Exposición legal |
| **C7** | **`JSON.parse` sin `try/catch` + sin Error Boundary** | `:119-170`, 0 boundaries | Un dato corrupto = pantalla en blanco permanente e irrecuperable |
| **C8** | **PII real en el bundle público** | Verificado en `dist/assets/*.js` | Divulgación de datos personales identificables |
| **C9** | **Anulación no revierte caja ni stock** | `annulInvoice:540` | Corrupción contable permanente e irreconciliable |
| **C10** | **Aislamiento multi-tenant inexistente** | `companyId`/`branchId` nunca filtran | Brecha entre clientes al incorporar la segunda empresa |
| **C11** | **Efecto de red dentro de un updater de React** | `AppContext.tsx:358` | Doble consumo del beneficio del cliente |
| **C12** | **Sin pruebas en la lógica de dinero** | 0 archivos de test | Cualquier cambio puede romper el ITBIS o la caja en silencio |

### 🟠 Riesgos importantes — degradación de rendimiento y corrección

| # | Riesgo | Evidencia |
|---|---|---|
| **I1** | Colisión de números de orden al ~día 2 (50% a las 112 órdenes) | `:289` |
| **I2** | Colisión de IDs por `Date.now()` en el mismo tick | `:213`, `:239`, `:258`, `:310` |
| **I3** | Re-render global en cada pulsación de tecla | contexto sin memo, 0 `React.memo` |
| **I4** | Serialización síncrona bloqueante en cada mutación | `:183-201`; 7,4 ms a 2.000 órdenes |
| **I5** | Sin virtualización ni paginación | todas las listas |
| **I6** | Bundle monolítico de 357 kB, sin code splitting | build verificado |
| **I7** | Idempotencia inoperante por construcción | `NuevaLlegadaModal.tsx:183` |
| **I8** | Doble clic = doble factura y doble descuento de stock | `PosView.tsx:109` |
| **I9** | **El ticket térmico no se imprime** (sin CSS de impresión) | `TicketPreviewModal.tsx:17` |
| **I10** | Beneficios: no se validan placa, caducidad ni usos | `NuevaLlegadaModal.tsx:108-119` |
| **I11** | `discountPercentage` ignorado: el 50% se aplica como 100% | `:173-174` |
| **I12** | Fórmula de impuestos divergente entre orden y factura | `:304` vs `:452` |
| **I13** | Historial de sesiones de caja destruido al abrir la siguiente | `:395` |
| **I14** | Dinero en punto flotante | todo el modelo |
| **I15** | Sin observabilidad: imposible investigar un descuadre | — |
| **I16** | Sin lockfile: builds no reproducibles | — |
| **I17** | Inoperable con teclado; modales sin accesibilidad | §3.7 |
| **I18** | Inutilizable en móvil (sidebar fija, tablas desbordadas) | §3.8 |

### 🟡 Riesgos menores — a corregir antes de seguir creciendo

| # | Riesgo |
|---|---|
| **M1** | `tsconfig` sin `strict` |
| **M2** | Valores de demo pre-rellenados en flujos reales |
| **M3** | `createdBy` hardcodeado: la auditoría atribuye acciones a la persona equivocada |
| **M4** | 6 dependencias muertas; `vite` duplicado |
| **M5** | `<title>` "My Google AI Studio App"; `lang="en"` en UI española |
| **M6** | Sin service worker: no hay offline real |
| **M7** | Sin cabeceras de seguridad (CSP, X-Frame-Options) |
| **M8** | Impuesto redondeado a pesos enteros, no a centavos |
| **M9** | `toLocaleString()` sin locale en ~40 sitios |
| **M10** | Código muerto: paso `'confirm'`, `CashMovement`, `totalInflows`, `setCommissions` |
| **M11** | KPIs "de hoy" suman todo el histórico sin filtro de fecha |
| **M12** | Sin README, LICENSE ni ADRs; 2 commits |

---

## 20. Roadmap técnico

### 🚨 Inmediato — antes de exponer esto a cualquier usuario real

**Objetivo: dejar de mentirle al usuario y detener la pérdida de datos.** 1-2 semanas.

1. **Etiquetar el sistema como DEMO en la propia interfaz.** Banner persistente: "Prototipo — los datos se almacenan solo en este navegador y pueden perderse".
2. **Eliminar la PII real del código** (`membegoApi.ts:27-102`) y sustituirla por datos sintéticos. Es un cambio de 10 minutos con impacto legal.
3. **Persistir las 5 claves que se leen y no se escriben** — o dejar de leerlas. El estado actual es el peor de los dos mundos.
4. **`try/catch` en toda hidratación + Error Boundary raíz + clave de versión de esquema.** Elimina la pantalla en blanco permanente.
5. **Manejar `QuotaExceededError`** con aviso explícito y bloqueo de nuevas operaciones antes de perder datos en silencio.
6. **Reemplazar `Date.now()`/`Math.random()` por `crypto.randomUUID()`** en todos los IDs internos.
7. **Deshabilitar botones durante el envío** en checkout y creación de orden.
8. **Retirar el rótulo "Audit Trail Inalterable"** y el de "Arqueo Ciego" mientras no lo sean.
9. **Corregir el arqueo ciego**: ocultar el esperado y no pre-rellenar el conteo.
10. **Unificar la fórmula de impuestos** en un único módulo de dominio.
11. **Generar `package-lock.json`** y purgar las dependencias muertas.
12. **Añadir CSS de impresión** para que el ticket funcione.
13. **Activar `strict` en TypeScript** y corregir lo que aparezca.

### 📅 Corto plazo (1-3 meses) — construir el sistema real (decenas de miles de usuarios)

**Esta fase no es una mejora: es la construcción del producto.**

1. **Backend.** Node/Fastify o Go. PostgreSQL. El esquema se deriva casi directamente de `src/types/index.ts` — **ese trabajo ya está hecho y es bueno**.
2. **Autenticación y autorización reales.** Sesiones con cookies `httpOnly`+`SameSite`, o JWT de vida corta con refresh rotativo. PIN para operaciones de caja. RBAC efectivo sobre los 8 roles ya definidos.
3. **Aislamiento multi-tenant desde el primer día.** Row-Level Security de PostgreSQL sobre `company_id`. No es opcional ni posponible: reajustarlo después es una migración de riesgo.
4. **Dinero como enteros en centavos** en todo el sistema, con redondeo explícito y documentado.
5. **Secuencias fiscales del lado del servidor.** Números de factura correlativos y NCF asignados desde rangos autorizados DGII, con bloqueo transaccional. Notas de crédito (B04) para anulaciones, con reversión de caja y stock.
6. **Transacciones atómicas** para factura+caja+stock+orden.
7. **Idempotencia real:** clave generada por el cliente **una vez por operación** (no por intento), tabla de idempotencia en servidor con TTL.
8. **Suite de pruebas**: >90% en lógica monetaria, E2E de los tres caminos críticos.
9. **CI/CD** con typecheck, lint, tests, build y despliegue de preview.
10. **Sentry + logs + uptime** desde el primer despliegue.
11. **Backups con PITR** y restauración probada. Un backup no probado no es un backup.
12. **Migración de datos** desde `localStorage` para las instalaciones piloto existentes.

### 📈 Mediano plazo (3-9 meses) — cientos de miles de usuarios

1. **Rendimiento del frontend:** code splitting por ruta, `React.memo`/`useMemo` en el árbol caliente, virtualización de listas, TanStack Query en lugar del god-context.
2. **Tiempo real** vía WebSocket/SSE para el Kanban — es un tablero operativo compartido; hoy no lo es.
3. **Offline-first de verdad:** service worker + IndexedDB + cola de sincronización con resolución de conflictos. Este es el diferenciador real del producto en República Dominicana, donde la conectividad es irregular; hoy se promete y no existe.
4. **Redis** para sesiones, catálogo y rate limiting.
5. **Réplicas de lectura** y vistas materializadas para reportes.
6. **Particionado temporal** de órdenes y facturas.
7. **Object storage + pipeline de imágenes** para inspecciones de vehículos.
8. **Accesibilidad hasta WCAG 2.1 AA** y rediseño móvil completo.
9. **Impresión ESC/POS** nativa (WebUSB o agente local).
10. **Auditoría inmutable** append-only con hash encadenado.

### 🌍 Largo plazo (9-24 meses) — millones de usuarios

1. **Extraer servicios** solo donde los límites lo justifiquen: facturación, integración Membego, reportes. No microservicios por moda.
2. **Event sourcing en el libro financiero.** Para un sistema de caja, el log de eventos inmutable es la fuente de verdad correcta y resuelve auditoría, reconstrucción y conciliación de una vez.
3. **Multi-región** con residencia de datos por país, cuando la expansión lo exija.
4. **Sharding por tenant** — el eje natural es `company_id`, y por eso §20-corto-plazo-3 es innegociable.
5. **CQRS** separando el camino transaccional del analítico; data warehouse para BI.
6. **Motor fiscal por país** (DGII, SAT, DIAN, AFIP) como plugins.
7. **Feature flags y despliegues canary.**
8. **Presupuestos de rendimiento** en CI, con bloqueo automático de regresiones.

---

## 21. Puntuaciones

| Área | Nota | Justificación |
|---|---:|---|
| **Arquitectura** | **3,0** | Estructura de carpetas limpia y modelo de dominio excelente; pero god-context, lógica de negocio en la UI, tres fórmulas de impuestos divergentes y multi-tenancy decorativa |
| **Escalabilidad** | **1,0** | Nada escala horizontalmente; techo duro de ~1.500 órdenes por dispositivo; falla en N=2 dispositivos |
| **Seguridad** | **1,0** | Sin autenticación ni autorización; PII en el bundle. El punto que evita el 0: no existe ningún vector XSS y el escapado de React se respeta en todo el código |
| **Base de datos** | **0,0** | No existe. `localStorage` con datos financieros, sin transacciones, sin restricciones, sin backups, sin migraciones |
| **Frontend** | **4,0** | Trabajo visual competente y consistente en 18 vistas; penalizado por bundle monolítico, cero memoización, cero virtualización y fallos serios de accesibilidad y responsive |
| **Backend** | **0,0** | No existe |
| **Rendimiento** | **3,0** | Aceptable a escala de demo; degradación medida y jank a las ~1.000 órdenes |
| **DevOps** | **1,0** | `npm run build` funciona. Sin lockfile, sin CI, sin entornos, sin rollback, sin despliegue |
| **Calidad del código** | **5,0** | El área más fuerte: nomenclatura consistente, organización predecible, tipos sólidos, legible. Limitado por ausencia de `strict`, duplicación divergente, código muerto e identidades hardcodeadas |
| **Observabilidad** | **0,0** | Nada, en las siete dimensiones |
| **Experiencia de usuario** | **4,0** | Diseño visual sobresaliente y flujos bien pensados; anulado en parte porque el ticket no imprime, no hay feedback de carga, y el móvil no es usable |
| **Preparación para producción** | **0,0** | Ver §18 |

### Promedio general: **1,83 / 10**

```
Arquitectura         ███░░░░░░░  3,0
Escalabilidad        █░░░░░░░░░  1,0
Seguridad            █░░░░░░░░░  1,0
Base de datos        ░░░░░░░░░░  0,0
Frontend             ████░░░░░░  4,0
Backend              ░░░░░░░░░░  0,0
Rendimiento          ███░░░░░░░  3,0
DevOps               █░░░░░░░░░  1,0
Calidad del código   █████░░░░░  5,0
Observabilidad       ░░░░░░░░░░  0,0
Experiencia usuario  ████░░░░░░  4,0
Prep. producción     ░░░░░░░░░░  0,0
─────────────────────────────────────
PROMEDIO             ██░░░░░░░░  1,83
```

---

## 22. Conclusión e informe ejecutivo

## ❌ No la publicaría bajo ninguna circunstancia hasta resolver los problemas críticos.

---

## Informe ejecutivo — dirigido al CTO

**De:** Auditoría de Ingeniería
**Asunto:** Membego Car Wash Operations — evaluación de madurez técnica y capacidad real
**Fecha:** 29 de julio de 2026

---

### Resumen en un párrafo

Se auditó el 100% del código (5.486 líneas, 34 archivos), se compiló el artefacto de producción y se midieron empíricamente los límites de almacenamiento y rendimiento. **Lo que existe es un prototipo de interfaz de alta fidelidad, no un sistema.** No hay backend, no hay base de datos y no hay autenticación: los datos financieros —facturas, sesiones de caja, inventario— se guardan en el `localStorage` del navegador de cada dispositivo. La consecuencia no es que el sistema escale mal; es que **el producto no funciona con dos dispositivos**, que es la configuración mínima de cualquier car wash real (recepción + caja). Recomiendo detener cualquier plan de lanzamiento, incluida una beta cerrada, y reencuadrar este trabajo como lo que es: una validación de producto exitosa que ahora necesita que se construya el sistema.

### Los cinco hallazgos que determinan la decisión

**1. No existe backend.** Todo el estado vive en el navegador. Recepción y caja del mismo mostrador tienen dos listas de órdenes distintas que no se sincronizan nunca. No es un problema de escala: **es un fallo funcional en N=2 dispositivos, desde el minuto cero.**

**2. No existe autenticación.** El cambio de identidad es un desplegable en la barra superior. Cualquiera con acceso al dispositivo se convierte en propietario en dos clics y puede anular facturas y cerrar caja. El campo `pinCode` está definido en el modelo y **nunca se verifica en ninguna línea del código**. En un sistema de manejo de efectivo, la ausencia de identidad verificable invalida todos los demás controles — incluidos los antifraude.

**3. El sistema destruye sus propios datos entre la tercera y la sexta semana.** Medición directa: 1.437 unidades de almacenamiento por orden; la cuota de 5 MB del navegador se agota en torno a las 1.500 órdenes compartiendo espacio con facturas y clientes. Un car wash de 6 bahías las alcanza en 3-6 semanas. Cuando ocurre, la escritura falla **en silencio**: el cajero sigue cobrando creyendo que se guarda. Antes de eso, hay una pérdida diaria: cinco porciones del estado —**inventario, gastos, bitácora de auditoría, bahías y configuración**— se leen del almacenamiento pero **nunca se escriben**, así que cada descuento de stock y cada gasto registrado desaparecen al refrescar la página. Y no hay backups de ninguna clase: formatear la tablet del cajero borra la contabilidad completa.

**4. La facturación no es fiscalmente válida y la anulación corrompe la contabilidad.** Los números de factura se generan con `Math.random()` sobre 900.000 valores — hay 50% de probabilidad de duplicado a las ~1.100 facturas. El NCF fiscal **nunca se asigna**: el punto de venta no lo envía, y toda factura imprime "Consumidor Final". Anular una factura invierte un booleano: no emite nota de crédito, no restaura el inventario y no revierte la caja, dejando los tres registros permanentemente en desacuerdo. Bajo la Norma 06-2018 de la DGII esto **traslada una exposición legal al car wash que use el sistema**.

**5. Cero pruebas sobre la lógica del dinero.** No hay un solo archivo de test en el repositorio. Para una aplicación cuyo propósito íntegro es manejar efectivo y emitir comprobantes, la cobertura del 0% significa que nadie puede afirmar que el ITBIS se calcula bien — y de hecho **no se calcula igual en los tres sitios donde está implementado**: una orden con beneficio Membego produce un impuesto distinto al de su propia factura.

### Capacidad real: cuántos usuarios concurrentes soporta hoy

Hay que separar dos cosas que el enunciado agrupa:

- **Descarga del archivo:** el bundle estático servido desde un CDN atiende **50.000+ usuarios concurrentes sin despeinarse**. Esta capa nunca será el límite.
- **El producto:** **1 usuario concurrente por negocio**, y con degradación desde la segunda semana.

**La respuesta operativa: la capacidad real es de 1 dispositivo por car wash, durante 3 a 6 semanas, tras las cuales pierde datos.** No hay un número de usuarios concurrentes que reportar porque no hay un servidor que los reciba.

### Lo que sí vale la pena conservar

Quiero ser explícito en esto porque el resto del informe es duro y sería injusto no decirlo:

- **El modelo de dominio (`src/types/index.ts`) es excelente** y es un activo real. Matriz de precios por categoría de vehículo, sesiones de caja con arqueo y diferencia, NCF fiscal, comisiones por lavador, inspección con nivel de combustible y objetos de valor, checklist de calidad. Eso no lo escribe alguien que no conoce la operación de un car wash. **Se traduce casi 1:1 a un esquema PostgreSQL y debe conservarse íntegro.**
- **El diseño de contratos de la integración Membego es correcto**: la separación reserve/confirm/cancel es exactamente el patrón que hace falta para no consumir un beneficio si el lavado se cancela. La implementación tiene defectos; el diseño no.
- **El trabajo visual y de flujos de UX es de buena calidad** y ya cumplió su función: demuestra el producto.

Estimo que **entre el 15% y el 20% del código actual sobrevive** a la construcción del sistema real, y que la parte que sobrevive es la más difícil de acertar: entender el negocio.

### Nivel de madurez técnica

**Prototipo validado / Prueba de concepto — nivel 1 de 5.**

Puntuación global: **1,83 / 10**. La aplicación compila limpiamente, la verificación de tipos pasa y la interfaz es convincente. No tiene ninguno de los atributos que definen un sistema de producción: persistencia fiable, identidad, aislamiento entre clientes, transaccionalidad, observabilidad, copias de seguridad o pruebas.

### Recomendación

1. **Detener cualquier plan de lanzamiento**, incluida beta cerrada. Una beta cerrada implica datos reales de negocios reales, y este sistema los perderá.
2. **Ejecutar esta semana el bloque Inmediato** (§20): retirar la PII real del bundle público, marcar la aplicación como demo en la propia interfaz, y retirar los rótulos "Audit Trail Inalterable" y "Arqueo Ciego" mientras no lo sean. Ninguno de estos cambios cuesta más de un día y los tres cierran exposiciones activas.
3. **Reencuadrar el proyecto correctamente ante la dirección.** Esto no es "una aplicación al 90% que necesita ajustes de escalabilidad". Es **una especificación de producto excelente con una implementación de demostración**. La distinción importa para planificar: el trabajo pendiente es una construcción, no un endurecimiento.
4. **Dimensionar la fase de construcción en 3-4 meses** con 2-3 ingenieros para llegar a un producto desplegable en beta cerrada, aprovechando el modelo de dominio existente.
5. **Innegociable desde la primera línea del backend:** aislamiento multi-tenant con Row-Level Security sobre `company_id`, dinero como enteros en centavos, y secuencias fiscales del lado del servidor. Reajustar cualquiera de las tres después de tener clientes es una migración de altísimo riesgo.

### El diagnóstico en una frase

**El equipo entendió el problema de negocio mejor de lo que la mayoría de los equipos lo entiende, y construyó una demostración convincente de la solución; ahora hace falta construir la solución.**

---

*Auditoría realizada mediante lectura completa del código fuente, compilación del artefacto de producción, verificación de tipos y medición empírica de capacidad de almacenamiento y costes de serialización. Cada hallazgo está referenciado a `archivo:línea`. No se extrapoló ningún comportamiento que no pudiera verificarse en el código.*
