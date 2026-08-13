# Sus datos, listos para subir

Cuatro archivos, en este orden. Cada uno se sube desde su propio módulo con el
botón **Importar**, y cada uno le enseña una previsualización antes de guardar
nada: revísela y solo entonces pulse «Aplicar».

| Orden | Archivo | Dónde se sube | Filas |
|---|---|---|---|
| 1 | `1-clientes.csv` | Clientes › Clientes | 296 |
| 2 | `2-servicios.csv` | Ventas › Servicios | 18 |
| 3 | `3-productos.csv` | Inventario › Productos | 17 |
| 4 | `4-descuentos.csv` | Ventas › Descuentos | 1 |

El orden importa poco entre estos cuatro, pero si algún día sube vehículos,
hágalo **después** de los clientes: el vehículo se engancha a su dueño por el
teléfono, y para eso el dueño tiene que existir ya.

Los cuatro los probé importándolos de verdad contra una base con el esquema
completo: **0 errores**. Los clientes entraron 292 de 296 —los otros 4 son
repetidos que el sistema reconoció solos, ver abajo—.

---

## Qué le limpié a los clientes

- **Nombre y apellido juntos en uno.** El sistema guarda un solo campo `nombre`.
- **Teléfonos sin tocar.** Los dejé como venían porque el sistema los normaliza
  al entrar: `829-481-6319`, `8294816319` y `1-829-481-6319` acaban siendo el
  mismo número, y quedan escritos `829-481-6319`.
- **Correos en minúsculas.**
- **Documentos sin guiones**, en la columna `rnc`.
- **Apellidos de relleno fuera**: `--` y `N/A` no son apellidos.
- **`LUIS ANGEL \`PEREZ`** llevaba una comilla suelta pegada al apellido. Fuera.

## Clientes repetidos — `informe-clientes-repetidos.csv`

Cuatro teléfonos aparecen dos veces. **No tiene que hacer nada**: la importación
los reconoce y entra uno solo. Pero dos merecen que los mire, porque el mismo
número está a nombre de dos personas distintas:

| Teléfono | Aparece como | Qué pasa |
|---|---|---|
| 849-581-5585 | DANIEL CASTRO / DANIEL CASTRO | Es el mismo, escrito de dos formas. Entra uno. |
| 809-759-5288 | RAFAEL FERNANDEZ / Rafael Fernandez | Ídem. Entra uno. |
| 849-869-5965 | **Damian Rojas / DAMIAN ARIAS** | Mismo Damián, ¿dos apellidos? Entra «Damian Rojas» y el otro se marca «omitir». Si son dos personas, corríjale el teléfono a una. |
| 347-567-0114 | **INDRA VIOLETA SANTANA / Violet Santana-Burns** | Parece la misma señora con su nombre en inglés. Entra la primera. |

## Teléfonos que no sirven — `informe-telefonos-dudosos.csv`

Entran igual, pero no se le podrá avisar por WhatsApp a estos:

- **ABEL SEVERINO — `55555555`**: ocho dígitos, es relleno. Ojo: hay otro ABEL
  SEVERINO con `829-648-1165`, que sí es real. Como los teléfonos son distintos,
  **entrarán como dos clientes**. Si son la misma persona, bórrele uno después.
- **GREGORI GUERRERO — `823024195`**: nueve dígitos, le falta uno.
- **Rodrigo lopez, Luigi Lavador y Cliente Generico**: sin teléfono. Entran, y
  se reconocen por el nombre si vuelve a importarlos.

---

## Qué le reorganicé en el catálogo

Aquí hice el cambio de fondo, y quiero que lo entienda antes de subirlo.

### Los tres niveles ahora son UN servicio cada uno, con precio por tamaño

En su sistema anterior, «Cuidado Básico» eran **cuatro artículos distintos**:
uno para compactos, uno para SUV medianos, otro para grandes… Cada vez que
cambiara un precio tendría que tocar cuatro sitios, y el cajero tiene que
acordarse de cuál elegir.

Aquí no hace falta: un servicio tiene **una tarifa por categoría de vehículo**.
El cajero elige «Cuidado Básico», el sistema ya sabe que la orden es de una
camioneta y cobra los 800. Quedó así:

| Servicio | Sedán / compacto | SUV, jeep, van | Pickup, camión |
|---|---|---|---|
| Cuidado Básico | 600 | 800 | 900 |
| Cuidado Estándar | 900 | 1 300 | 1 500 |
| Cuidado Premium | 1 200 | 1 600 | 1 800 |

Las motos y los vehículos especiales heredan el precio de compacto. Si les cobra
distinto, cámbielo en Ventas › Servicios; es una casilla.

### Los «descuentos» de su sistema anterior NO eran descuentos

Esto es lo más importante de todo el traspaso. En su lista de descuentos había
nueve «planes» —Plan Silver, Plan gold, Plan Premium— cargados como **monto
fijo** de 600, 900, 1 300, 1 800…

Esos números no son descuentos: **son el precio del lavado**. Un descuento de
monto fijo de 1 800 le RESTA 1 800 a la factura. Si los subo tal cual, el primer
lavado premium que cobre saldría en cero, o en negativo.

Mírelos al lado de sus servicios y se ve solo:

| «Descuento» del sistema viejo | Es en realidad |
|---|---|
| Plan Silver SEDAN Y HATCH BACK — 600 | Cuidado Básico, sedán |
| Plan Silver SUV PEQ Y MD — 800 | Cuidado Básico, SUV |
| Plan Silver SUV GRAN — 900 | Cuidado Básico, pickup |
| plan gold - Carros Compactos — 900 | Cuidado Estándar, sedán |
| Plan gold - SUV/Pickups Medianos — 1 300 | Cuidado Estándar, SUV |
| Plan gold - SUV/Pickups Grandes — 1 500 | Cuidado Estándar, pickup |
| Plan Premium - Carros/SUV Compactos — 1 200 | Cuidado Premium, sedán |
| Plan Premium - SUV/Pickups Medianos — 1 600 | Cuidado Premium, SUV |
| Plan Premium - SUV/Pickups Grandes — 1 800 | Cuidado Premium, pickup |

Es la misma tabla de precios, escrita dos veces con nombres de mercadeo. Ya está
completa en `2-servicios.csv`, así que **no la subí como descuentos**. Silver =
Básico, Gold = Estándar, Premium = Premium.

Si lo que quiere es vender esos planes como **membresía mensual** —el cliente
paga una cuota y lava cuantas veces quiera—, eso no es un descuento tampoco: es
Membego, y hay que montarlo aparte. Dígame y lo vemos.

El único descuento de verdad de su lista era **«Primer lavado GRATIS», 100 %**, y
ese sí está en `4-descuentos.csv`.

### Artículos repetidos que le dejé como estaban

No los borré porque la decisión es suya, pero revíselos:

- **«Brillado de faroles» (1 271,11) y «Brillado de headlights» (508,47)**:
  faroles y headlights son lo mismo, con precios que se llevan 760 pesos.
  Decida cuál vale y borre el otro.
- **«Aplicación de cera»** estaba dos veces, a 423,72 y a 508,47. Dejé
  **423,72**, que es el más reciente (28/07).
- **«Lavado por fuera»** estaba dos veces, a 400,00 y a 338,98. Dejé
  **400,00**, el más reciente (02/08). El 338,98 era el mismo precio sin ITBIS.
- **«Lavado Interior - Full» está en 0,00.** Lo subí en cero tal como estaba,
  para que no se le olvide: póngale precio antes de venderlo.

### El costo de los servicios no viaja

Su sistema traía «costo base» en dos servicios. Aquí el costo de un servicio no
se teclea: sale de los insumos que consume, en Ventas › Servicios › Receta. Eso
es lo que hace que el reporte de rentabilidad sea real y no un número escrito a
mano. Cuando quiera, montamos las recetas.

---

## Los productos entran con existencia CERO

A propósito. Los 17 productos entran con su precio y **0 unidades**, porque su
sistema anterior no me dio existencias y adivinarlas sería peor que dejarlas en
cero.

Haga el conteo físico y cárguelo desde **Inventario › Productos › Ajustar**, con
su motivo. Así cada unidad que entra queda en el kardex con fecha y responsable,
que es exactamente lo que le permite después cuadrar el inventario. Si las
metiera por importación no quedaría ese rastro.

Nota: si vuelve a importar este archivo más adelante para corregir precios, la
existencia **no se toca**. Está protegido: el inventario solo se mueve por
compras, ventas y ajustes.

---

## Cómo se sube, paso a paso

1. Entre como propietario o administrador (nadie más puede importar).
2. Vaya al módulo que toca y pulse **Importar**.
3. Elija el archivo. Le dirá cuántas filas leyó.
4. Pulse **Previsualizar**. Sale una tabla fila por fila: qué se crea, qué se
   actualiza, qué se queda igual y qué falló, con el motivo. **Todavía no se ha
   guardado nada**, aunque diga que sí lo haría.
5. Si le cuadra, pulse **Aplicar esta importación**.

Si algo sale mal a mitad de camino, vuelva a subir el mismo archivo: no duplica.
Reconoce a cada quien por su teléfono, su placa o su código, y lo que ya está lo
deja en paz.
