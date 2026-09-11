/**
 * Rangos de fecha, con el reloj en la mano.
 * Ejecutar: node --import tsx --test tests/api/rangos-fecha.test.mjs
 *
 * La prueba que importa es la de las 21:30: la versión anterior serializaba
 * con toISOString() (UTC) y a esa hora, en República Dominicana, «Hoy» ya era
 * mañana. El dueño que miraba las ventas al cerrar veía cero.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { rangoDeFechas, describirRango, ymdLocal } = await import('../../src/lib/rangosFecha.ts')

// Las 21:30 del 11/09/2026 en el huso del proceso. La prueba corre con
// TZ=America/Santo_Domingo en CI y localmente da igual el huso: lo que se
// comprueba es que el resultado use los componentes LOCALES de esta fecha.
const NOCHE = new Date(2026, 8, 11, 21, 30, 0)

test('«Hoy» a las 21:30 sigue siendo hoy, no mañana', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'hoy' }, NOCHE),
    { desde: '2026-09-11', hasta: '2026-09-11' })
})

test('«Ayer» es el día anterior completo', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'ayer' }, NOCHE),
    { desde: '2026-09-10', hasta: '2026-09-10' })
})

test('«Últimos 7 días» incluye hoy y seis días atrás', () => {
  assert.deepEqual(rangoDeFechas({ preset: '7dias' }, NOCHE),
    { desde: '2026-09-05', hasta: '2026-09-11' })
})

test('«Este mes» va del 1 a hoy', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'este_mes' }, NOCHE),
    { desde: '2026-09-01', hasta: '2026-09-11' })
})

test('«Mes anterior» es agosto entero', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'mes_anterior' }, NOCHE),
    { desde: '2026-08-01', hasta: '2026-08-31' })
})

test('«Mes anterior» en enero cruza de año', () => {
  const enero = new Date(2027, 0, 5, 9, 0, 0)
  assert.deepEqual(rangoDeFechas({ preset: 'mes_anterior' }, enero),
    { desde: '2026-12-01', hasta: '2026-12-31' })
})

test('«Ayer» el 1 de marzo tras febrero bisiesto da 29/02', () => {
  const m1 = new Date(2028, 2, 1, 8, 0, 0)
  assert.deepEqual(rangoDeFechas({ preset: 'ayer' }, m1),
    { desde: '2028-02-29', hasta: '2028-02-29' })
})

test('fecha exacta: un solo día', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'fecha', desde: '2026-09-03' }, NOCHE),
    { desde: '2026-09-03', hasta: '2026-09-03' })
})

test('rango al revés se endereza en vez de quedar vacío', () => {
  assert.deepEqual(
    rangoDeFechas({ preset: 'rango', desde: '2026-09-10', hasta: '2026-09-01' }, NOCHE),
    { desde: '2026-09-01', hasta: '2026-09-10' })
})

test('rango sin fechas todavía: hoy, nunca un universo vacío', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'rango' }, NOCHE),
    { desde: '2026-09-11', hasta: '2026-09-11' })
})

test('mes concreto: entero, también febrero bisiesto', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'mes', mes: '2028-02' }, NOCHE),
    { desde: '2028-02-01', hasta: '2028-02-29' })
})

test('año concreto: del 1 de enero al 31 de diciembre', () => {
  assert.deepEqual(rangoDeFechas({ preset: 'anio', anio: 2025 }, NOCHE),
    { desde: '2025-01-01', hasta: '2025-12-31' })
})

test('ymdLocal nunca usa UTC', () => {
  assert.equal(ymdLocal(NOCHE), '2026-09-11')
})

test('describirRango: un día con nombre, un rango con dos fechas', () => {
  assert.equal(describirRango({ preset: 'hoy' }, NOCHE), 'Hoy, 11/09/2026')
  assert.equal(
    describirRango({ preset: 'rango', desde: '2026-09-01', hasta: '2026-09-10' }, NOCHE),
    '01/09/2026 – 10/09/2026')
  assert.equal(describirRango({ preset: 'fecha', desde: '2026-09-03' }, NOCHE), '03/09/2026')
})
