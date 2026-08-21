# ADR-003 — El dinero se representa en centavos enteros (bigint)

## Estado
Aceptada (verificada: 0 columnas de dinero en tipo flotante).

## Contexto
Cálculos financieros (facturas, ITBIS, comisiones, caja). Los flotantes pierden
precisión.

## Decisión
Todo importe es `bigint` de centavos en la base y number entero en el cliente.
El formateo a moneda es solo presentación.

## Consecuencias
- (+) Sin errores de redondeo en dinero.
- (−) Hay que formatear al mostrar (resuelto en `src/lib/money.ts`).
