/**
 * La tasa de ITBIS que se imprime en un comprobante.
 * Ejecutar: node --import tsx --test tests/api/tasa-efectiva.test.mjs
 *
 * Desde que la tasa se puede editar, el porcentaje impreso ya no puede leerse
 * de la empresa: una factura de ayer tiene que seguir diciendo SU tasa aunque
 * hoy se cobre otra. Un comprobante que anuncia «16%» sobre un importe que fue
 * del 18% se contradice a sí mismo delante de un inspector.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { tasaEfectivaBps } = await import('../../src/lib/money.ts')

test('deduce el 18% de una factura con ITBIS sumado encima', () => {
  // Base 1.000,00 + 18% = 1.180,00
  assert.equal(tasaEfectivaBps(118000, 18000, 1600), 1800)
})

test('deduce la misma tasa con precios que YA incluyen el ITBIS', () => {
  // Total 1.000,00 con el 18% extraído de adentro: base 847,46 + 152,54.
  assert.equal(tasaEfectivaBps(100000, 15254, 1600), 1800)
})

test('una factura vieja NO adopta la tasa nueva de la empresa', () => {
  // La empresa ya cobra 16%, pero esta factura fue del 18% y así debe imprimirse.
  assert.equal(tasaEfectivaBps(118000, 18000, 1600), 1800)
})

test('sin base gravada se usa la tasa vigente, que es lo único cierto', () => {
  // Cortesía o lavado cubierto entero por la membresía: no hay división posible.
  assert.equal(tasaEfectivaBps(0, 0, 1800), 1800)
})

test('una factura exenta da 0%, no la tasa de la empresa', () => {
  assert.equal(tasaEfectivaBps(100000, 0, 1800), 0)
})

test('cifras incoherentes caen al respaldo en vez de inventar una tasa', () => {
  assert.equal(tasaEfectivaBps(1000, 5000, 1800), 1800, 'impuesto mayor que el total')
  assert.equal(tasaEfectivaBps(1000, -50, 1800), 1800, 'impuesto negativo')
})
