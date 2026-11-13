/**
 * Reglas del formulario de llegada.
 * Ejecutar: node --import tsx --test tests/api/llegada.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  conservarSeleccion, duenoPropuesto, accionDeTecla,
  duenoTrasCambioDePlaca, vehiculosDelCliente
} = await import('../../src/lib/llegada.ts')

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

// ── duenoTrasCambioDePlaca ──────────────────────────────────────────────────
//
// La regla que decide si el cliente en pantalla sobrevive a un cambio de placa.
// El caso que la motivó: un cliente con dos carros viene hoy con el segundo.

const porPlaca = { ...limpio, duenoPorPlaca: true, placaDeSuLista: false }

test('el carro de otro suelta al cliente que puso la placa anterior', () => {
  // Placa nueva sin dueño registrado: ese cliente era del carro anterior y
  // dejarlo colgaría la orden de quien no es.
  assert.deepEqual(duenoTrasCambioDePlaca(null, porPlaca), { accion: 'soltar' })
})

test('SU segundo carro NO lo suelta, aunque no esté registrado', () => {
  // Es el caso del dueño: tocar el segundo vehículo de la lista del cliente
  // vaciaba el nombre y el teléfono, y en el mostrador eso se lee como que
  // «solo deja el principal».
  assert.deepEqual(
    duenoTrasCambioDePlaca(null, { ...porPlaca, placaDeSuLista: true }),
    { accion: 'dejar' }
  )
})

test('y tampoco cuando SU segundo carro figura a nombre de otro', () => {
  // Un carro que quedó a nombre de un familiar: el mostrador lo eligió de la
  // lista de ESTE cliente, así que manda lo que eligió, no el registro. El
  // aviso de «figura a nombre de» sigue saliendo aparte.
  const deOtro = { plate: 'B222222', customer: { id: 'c2', name: 'Ana' } }
  assert.deepEqual(
    duenoTrasCambioDePlaca(deOtro, { ...porPlaca, placaDeSuLista: true }),
    { accion: 'dejar' }
  )
})

test('tecleando la placa a mano vuelve a mandar el registro', () => {
  // `placaDeSuLista` se apaga al teclear: ahí sí se propone el dueño real.
  assert.deepEqual(
    duenoTrasCambioDePlaca(carro, porPlaca),
    { accion: 'proponer', cliente: juan }
  )
})

test('al cliente elegido a mano no se le toca nunca', () => {
  assert.deepEqual(
    duenoTrasCambioDePlaca(null, { ...porPlaca, elegidoAMano: true }),
    { accion: 'dejar' }
  )
  assert.deepEqual(
    duenoTrasCambioDePlaca(carro, { ...limpio, duenoPorPlaca: false, placaDeSuLista: false, elegidoAMano: true }),
    { accion: 'dejar' }
  )
})

test('sin cliente en pantalla no hay nada que soltar', () => {
  assert.deepEqual(
    duenoTrasCambioDePlaca(null, { ...limpio, duenoPorPlaca: false, placaDeSuLista: false }),
    { accion: 'dejar' }
  )
})

// ── vehiculosDelCliente ─────────────────────────────────────────────────────

test('junta los carros del car wash con los de la membresía, sin repetir', () => {
  const r = vehiculosDelCliente(
    [{ id: 'v1', plate: 'A123456', make: 'Toyota', model: 'Corolla' }],
    [{ id: 'm1', placa: 'A-123 456', marca: 'Toyota', modelo: 'Corolla' },
     { id: 'm2', placa: 'B222222', marca: 'Honda', modelo: 'CR-V' }]
  )
  // La misma placa escrita de dos formas es UN carro, y gana el del car wash.
  assert.deepEqual(r.map(v => v.id), ['v1', 'm2'])
  assert.equal(r[0].registrado, true)
  assert.equal(r[1].registrado, false)
})

test('el orden que llega se respeta: el que más vino va primero', () => {
  const r = vehiculosDelCliente(
    [{ id: 'v1', plate: 'A111111' }, { id: 'v2', plate: 'B222222' }], []
  )
  assert.deepEqual(r.map(v => v.placa), ['A111111', 'B222222'])
})

test('un vehículo de Membego sin placa no se enseña', () => {
  // Un botón que rellena la placa con nada no sirve para nada.
  const r = vehiculosDelCliente([], [{ id: 'm1', placa: null }, { id: 'm2', placa: '  ' }])
  assert.deepEqual(r, [])
})

test('la descripción junta marca y modelo, y aguanta que falten', () => {
  const r = vehiculosDelCliente(
    [{ id: 'v1', plate: 'A111111', make: 'Toyota', model: null },
     { id: 'v2', plate: 'B222222', make: '', model: '' }], []
  )
  assert.equal(r[0].descripcion, 'Toyota')
  assert.equal(r[1].descripcion, '')
})
