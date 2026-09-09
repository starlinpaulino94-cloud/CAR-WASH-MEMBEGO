/**
 * Reglas del formulario de llegada.
 * Ejecutar: node --import tsx --test tests/api/llegada.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { conservarSeleccion, duenoPropuesto, accionDeTecla } = await import('../../src/lib/llegada.ts')

// ── conservarSeleccion ──────────────────────────────────────────────────────

test('cambiar de categoría conserva los servicios que siguen en la lista', () => {
  const nueva = [{ id: 'lavado' }, { id: 'encerado' }]
  assert.deepEqual([...conservarSeleccion(['lavado'], nueva)], ['lavado'])
})

test('suelta los servicios que no tienen precio en la categoría nueva', () => {
  const nueva = [{ id: 'lavado' }]
  assert.deepEqual([...conservarSeleccion(['lavado', 'motor'], nueva)], ['lavado'])
})

test('con la lista vacía no queda nada marcado', () => {
  assert.equal(conservarSeleccion(['lavado'], []).size, 0)
})

test('no depende del orden ni repite ids', () => {
  const nueva = [{ id: 'b' }, { id: 'a' }]
  const r = conservarSeleccion(new Set(['a', 'b']), nueva)
  assert.equal(r.size, 2)
  assert.ok(r.has('a') && r.has('b'))
})

// ── duenoPropuesto ──────────────────────────────────────────────────────────

const limpio = { elegidoAMano: false, nombreEscrito: '', telefonoEscrito: '', placaRechazada: null }
const juan = { id: 'c1', name: 'Juan' }
const carro = { plate: 'A123456', customer: juan }

test('placa conocida con dueño: se propone el dueño', () => {
  assert.equal(duenoPropuesto(carro, limpio), juan)
})

test('placa desconocida o sin dueño: nadie', () => {
  assert.equal(duenoPropuesto(null, limpio), null)
  assert.equal(duenoPropuesto({ plate: 'A123456', customer: null }, limpio), null)
})

test('si la recepción ya eligió un cliente a mano no se le pisa', () => {
  assert.equal(duenoPropuesto(carro, { ...limpio, elegidoAMano: true }), null)
})

test('si ya empezó a escribir un cliente nuevo no se le pisa', () => {
  assert.equal(duenoPropuesto(carro, { ...limpio, nombreEscrito: 'Pedro' }), null)
  assert.equal(duenoPropuesto(carro, { ...limpio, telefonoEscrito: '809' }), null)
  // Solo espacios no cuenta como escribir.
  assert.equal(duenoPropuesto(carro, { ...limpio, nombreEscrito: '   ' }), juan)
})

test('un dueño rechazado para ESA placa no vuelve a proponerse', () => {
  assert.equal(duenoPropuesto(carro, { ...limpio, placaRechazada: 'A123456' }), null)
  // Pero sí para otra placa: el rechazo no es para siempre.
  assert.equal(duenoPropuesto(carro, { ...limpio, placaRechazada: 'B999999' }), juan)
})

// ── accionDeTecla ───────────────────────────────────────────────────────────

test('Enter en la placa salta a los servicios', () => {
  assert.equal(accionDeTecla({ key: 'Enter', ctrlKey: false, metaKey: false }, true), 'irAServicios')
})

test('Enter en otro campo no hace nada: no registra a medias', () => {
  assert.equal(accionDeTecla({ key: 'Enter', ctrlKey: false, metaKey: false }, false), null)
})

test('Ctrl+Enter o ⌘+Enter registran desde cualquier campo', () => {
  assert.equal(accionDeTecla({ key: 'Enter', ctrlKey: true, metaKey: false }, false), 'registrar')
  assert.equal(accionDeTecla({ key: 'Enter', ctrlKey: false, metaKey: true }, true), 'registrar')
})

test('otras teclas no son atajos', () => {
  assert.equal(accionDeTecla({ key: 'a', ctrlKey: true, metaKey: false }, true), null)
})
