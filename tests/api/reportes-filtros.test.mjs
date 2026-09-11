/**
 * La limpieza de filtros antes de ir a la RPC de reportes.
 * Ejecutar: node --import tsx --test tests/api/reportes-filtros.test.mjs
 *
 * La RPC trata cada clave presente como un filtro. Mandar `washer_id: ''`
 * acotaría a un lavador sin id y devolvería cero. Una pantalla llena de filtros
 * opcionales debe mandar SOLO los que el usuario eligió.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { limpiarFiltros } = await import('../../src/lib/filtrosReporte.ts')

test('los filtros vacíos, undefined o ausentes no viajan', () => {
  assert.deepEqual(limpiarFiltros({
    branch_id: 'b1', cashier_id: '', washer_id: undefined, service_id: 's1',
    service_category: '', payment_method: 'efectivo'
  }), { branch_id: 'b1', service_id: 's1', payment_method: 'efectivo' })
})

test('sin nada elegido, objeto vacío', () => {
  assert.deepEqual(limpiarFiltros({}), {})
})

test('el estado sí viaja cuando se elige', () => {
  assert.deepEqual(limpiarFiltros({ status: 'anulada' }), { status: 'anulada' })
})

test('no inventa claves que no se pasaron', () => {
  const r = limpiarFiltros({ washer_id: 'w1' })
  assert.deepEqual(Object.keys(r), ['washer_id'])
})
