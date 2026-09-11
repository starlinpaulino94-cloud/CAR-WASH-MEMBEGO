/**
 * Qué hace «Aplicar al lavado» y, sobre todo, qué dice cuando no puede.
 * Ejecutar: node --import tsx --test tests/api/decidir-membresia.test.mjs
 *
 * El aviso es lo único que el mostrador tiene para arreglar el problema. Antes
 * decía siempre «márcalo en el catálogo», también cuando ya estaba marcado.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { decidirAplicarMembresia } = await import('../../src/lib/coberturaMembego.ts')

const BASICO = { id: 's1', name: 'Cuidado Básico', price_cents: 80000 }
const PREMIUM = { id: 's2', name: 'Cuidado Premium', price_cents: 200000 }

const entrada = (o = {}) => ({
  incluiblesEnCategoria: [],
  incluiblesEnCatalogo: [],
  lineasServicio: [],
  categoriaLabel: 'Jeep',
  ...o
})

test('la venta ya trae un lavado incluible: no se toca nada', () => {
  const d = decidirAplicarMembresia(entrada({
    incluiblesEnCategoria: [BASICO],
    incluiblesEnCatalogo: [BASICO],
    lineasServicio: [{ serviceId: 's1', name: 'Cuidado Básico' }]
  }))
  assert.deepEqual(d, { accion: 'nada' })
})

test('venta sin servicios: agrega el incluible MÁS CARO, no el primero', () => {
  const d = decidirAplicarMembresia(entrada({
    incluiblesEnCategoria: [BASICO, PREMIUM],
    incluiblesEnCatalogo: [BASICO, PREMIUM]
  }))
  assert.deepEqual(d, { accion: 'agregar', servicioId: 's2' })
})

test('catálogo sin ningún servicio marcado: manda a marcarlo', () => {
  const d = decidirAplicarMembresia(entrada())
  assert.equal(d.accion, 'avisar')
  assert.match(d.texto, /Ningún servicio del catálogo/)
  assert.match(d.texto, /Configuración → Servicios/)
})

test('marcado pero sin precio en esta categoría: NO manda a marcarlo otra vez', () => {
  const d = decidirAplicarMembresia(entrada({
    incluiblesEnCatalogo: [{ name: 'Cuidado Básico' }]
  }))
  assert.equal(d.accion, 'avisar')
  assert.match(d.texto, /no tiene precio para Jeep/)
  assert.match(d.texto, /Póngale precio/)
  // La instrucción equivocada de antes.
  assert.ok(!/Ningún servicio del catálogo/.test(d.texto))
})

test('la venta trae un lavado que no es el incluible: no agrega un segundo', () => {
  // No agrega —serían dos lavados del mismo carro— y tampoco avisa: la línea
  // del total ya lo dice sola, en ámbar y sin pulsar nada. Dos avisos para un
  // solo problema no informan el doble; parecen un sistema roto.
  const d = decidirAplicarMembresia(entrada({
    incluiblesEnCategoria: [PREMIUM],
    incluiblesEnCatalogo: [PREMIUM],
    lineasServicio: [{ serviceId: 's9', name: 'Cuidado Básico' }]
  }))
  assert.deepEqual(d, { accion: 'nada' })
})

test('los productos de la venta no cuentan como lavado', () => {
  // Quien llama pasa solo las líneas de servicio; con la venta llena de
  // productos la decisión sigue siendo agregar el lavado cubierto.
  const d = decidirAplicarMembresia(entrada({
    incluiblesEnCategoria: [BASICO],
    incluiblesEnCatalogo: [BASICO],
    lineasServicio: []
  }))
  assert.deepEqual(d, { accion: 'agregar', servicioId: 's1' })
})

test('con muchos marcados el aviso no se vuelve una lista interminable', () => {
  const d = decidirAplicarMembresia(entrada({
    incluiblesEnCatalogo: [
      { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }
    ]
  }))
  assert.match(d.texto, /«A», «B», «C» y 2 más/)
})
