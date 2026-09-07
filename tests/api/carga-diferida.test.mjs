/**
 * Carga diferida · reconocer una vista que ya no está en el servidor.
 * Ejecutar: node --import tsx --test tests/api/carga-diferida.test.mjs
 *
 * De este reconocimiento dependen dos cosas opuestas y las dos se pagan caro:
 *
 *   · si NO reconoce un fallo de versión, el mostrador ve la pantalla roja en
 *     mitad de un turno cada vez que se despliega;
 *   · si reconoce de más, un error real de la aplicación acaba en una recarga
 *     que lo esconde y lo deja irreproducible.
 *
 * Los mensajes son literales de cada navegador: no los inventa la aplicación,
 * así que la única forma de acertar es contrastarlos tal cual salen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { esFalloDeVersion } = await import('../../src/lib/cargaDiferida.ts')

test('reconoce el mensaje de Chrome', () => {
  assert.equal(esFalloDeVersion(new TypeError(
    'Failed to fetch dynamically imported module: https://carwash.membego.com/assets/CustomersSupabaseView-u5ehYpKP.js'
  )), true)
})

test('reconoce el de Firefox', () => {
  assert.equal(esFalloDeVersion(new TypeError(
    'error loading dynamically imported module'
  )), true)
})

test('reconoce el de Safari', () => {
  assert.equal(esFalloDeVersion(new TypeError(
    'Importing a module script failed.'
  )), true)
})

test('reconoce el chunk servido como HTML (un 404 que devuelve el índice)', () => {
  assert.equal(esFalloDeVersion(new SyntaxError("Unexpected token '<'")), true)
})

test('NO confunde un error real de la aplicación con un despliegue', () => {
  // Si esto devolviera true, el error se taparía con una recarga y nadie
  // podría reproducirlo.
  assert.equal(esFalloDeVersion(new TypeError("Cannot read properties of undefined (reading 'id')")), false)
  assert.equal(esFalloDeVersion(new Error('No tiene permiso para modificar esta orden')), false)
  assert.equal(esFalloDeVersion(new Error('Failed to fetch')), false, 'una consulta caída no es una vista borrada')
})

test('aguanta lo que no es un Error sin romperse', () => {
  assert.equal(esFalloDeVersion(null), false)
  assert.equal(esFalloDeVersion(undefined), false)
  assert.equal(esFalloDeVersion('Failed to fetch dynamically imported module'), true)
})
