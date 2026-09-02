/**
 * Descuento de una promoción Membego en la venta.
 * Ejecutar: node --import tsx --test tests/api/cobertura-promo.test.mjs
 *
 * Lo que se protege aquí cuesta plata si sale mal: una promo que rebaja de más
 * regala servicio; una que rebaja de menos cobra al cliente lo que le tocaba
 * gratis. Y `NONE` NO debe tocar la factura nunca (un 2x1 mal calculado es peor
 * que no aplicarlo). UN canje = UN servicio, y nunca más que su precio.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { descuentoPromocion } = await import('../../src/lib/coberturaMembego.ts')

const lavado = (over = {}) => ({
  serviceId: 'srv',
  incluidoEnMembego: false,
  unitPriceCents: 80000,
  quantity: 1,
  ...over,
})
const producto = (over = {}) => ({ serviceId: null, incluidoEnMembego: false, unitPriceCents: 50000, quantity: 1, ...over })

test('PERCENT rebaja el porcentaje del servicio más caro', () => {
  const r = descuentoPromocion({
    effect: { kind: 'PERCENT', value: 20, label: '-20%' },
    nombre: 'Descuento',
    lineas: [lavado({ unitPriceCents: 50000 }), lavado({ serviceId: 'srv2', unitPriceCents: 100000 })],
  })
  assert.equal(r.lineaIndex, 1, 'el más caro')
  assert.equal(r.discountCents, 20000, '20% de 100000')
})

test('AMOUNT rebaja el monto fijo, capado al precio del servicio', () => {
  const barato = descuentoPromocion({
    effect: { kind: 'AMOUNT', amountCents: 50000, label: 'RD$500' },
    nombre: 'Cupón', lineas: [lavado({ unitPriceCents: 30000 })],
  })
  assert.equal(barato.discountCents, 30000, 'un cupón de 500 sobre 300 rebaja 300, no regala dinero')

  const holgado = descuentoPromocion({
    effect: { kind: 'AMOUNT', amountCents: 10000, label: 'RD$100' },
    nombre: 'Cupón', lineas: [lavado({ unitPriceCents: 80000 })],
  })
  assert.equal(holgado.discountCents, 10000)
})

test('FREE deja el servicio en cero', () => {
  const r = descuentoPromocion({
    effect: { kind: 'FREE', label: 'Servicio gratis' },
    nombre: 'Lavado gratis', lineas: [lavado({ unitPriceCents: 80000 })],
  })
  assert.equal(r.discountCents, 80000)
  assert.match(r.explicacion, /gratis/i)
})

test('NONE no toca la factura', () => {
  const r = descuentoPromocion({
    effect: { kind: 'NONE', label: '2x1' },
    nombre: '2x1', lineas: [lavado()],
  })
  assert.equal(r.lineaIndex, null)
  assert.equal(r.discountCents, 0)
})

test('effect null tampoco rebaja nada', () => {
  const r = descuentoPromocion({ effect: null, nombre: 'X', lineas: [lavado()] })
  assert.equal(r.discountCents, 0)
})

test('nunca rebaja un producto: sin servicio, no hay descuento', () => {
  const r = descuentoPromocion({
    effect: { kind: 'FREE', label: 'Servicio gratis' },
    nombre: 'Lavado gratis', lineas: [producto()],
  })
  assert.equal(r.lineaIndex, null)
  assert.equal(r.discountCents, 0)
  assert.match(r.explicacion, /servicio/i)
})

test('una línea de servicio oculta (membresía) se salta: la promo no se apila', () => {
  // La caja pasa serviceId=null para las líneas que ya cubre la membresía.
  const r = descuentoPromocion({
    effect: { kind: 'PERCENT', value: 50, label: '-50%' },
    nombre: 'Descuento',
    lineas: [lavado({ serviceId: null, unitPriceCents: 100000 }), lavado({ serviceId: 'srv2', unitPriceCents: 40000 })],
  })
  assert.equal(r.lineaIndex, 1, 'ignora la cubierta aunque sea más cara')
  assert.equal(r.discountCents, 20000)
})
