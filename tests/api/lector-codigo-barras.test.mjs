/**
 * Lector de código de barras · reconocimiento de ráfagas.
 * Ejecutar: node --import tsx --test tests/api/lector-codigo-barras.test.mjs
 *
 * Lo que se protege aquí son los dos errores que se pagan en el mostrador:
 *
 *   · tomar el tecleo del cajero por un escaneo → se cuela un producto en la
 *     venta que nadie pidió, o el Enter de un formulario se pierde;
 *   · no reconocer el lector → el cajero escanea y no pasa nada.
 *
 * Con relojes falsos se reproduce lo que en pantalla exigiría un lector físico:
 * la ráfaga a 10 ms, la persona a 200 ms, y las dos mezcladas.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { ESTADO_INICIAL, procesarTecla, codigoPorInactividad } =
  await import('../../src/lib/lectorCodigoBarras.ts')

/** Teclea una secuencia con un intervalo fijo y devuelve lo que salió. */
function teclear(texto, intervaloMs, { desde = 0, estado = ESTADO_INICIAL } = {}) {
  let t = desde
  let e = estado
  let codigo
  for (const ch of texto) {
    t += intervaloMs
    const r = procesarTecla(e, ch, t)
    e = r.estado
    if (r.codigo) codigo = r.codigo
  }
  return { estado: e, codigo, ahora: t }
}

test('una ráfaga de lector con Enter entrega el código', () => {
  const { estado, ahora } = teclear('2000000000012', 10)
  const r = procesarTecla(estado, 'Enter', ahora + 10)
  assert.equal(r.codigo, '2000000000012')
  assert.equal(r.consumir, true, 'el Enter del lector no debe llegar al formulario')
})

test('Tab también cierra la ráfaga (lectores con sufijo Tab)', () => {
  const { estado, ahora } = teclear('2000000000012', 10)
  assert.equal(procesarTecla(estado, 'Tab', ahora + 10).codigo, '2000000000012')
})

test('el tecleo humano NO se confunde con un escaneo', () => {
  // 200 ms por tecla: cada una rompe la ráfaga y solo queda la última.
  const { estado, ahora } = teclear('2000000000012', 200)
  assert.equal(estado.buffer, '2', 'cada tecla lenta reinicia el buffer')
  const r = procesarTecla(estado, 'Enter', ahora + 200)
  assert.equal(r.codigo, undefined)
  assert.equal(r.consumir, false, 'un Enter suelto debe seguir enviando el formulario')
})

test('un Enter suelto nunca se roba la pulsación', () => {
  const r = procesarTecla(ESTADO_INICIAL, 'Enter', 1000)
  assert.equal(r.codigo, undefined)
  assert.equal(r.consumir, false)
})

test('una ráfaga demasiado corta no dispara una venta', () => {
  const { estado, ahora } = teclear('12345', 10)
  assert.equal(procesarTecla(estado, 'Enter', ahora + 10).codigo, undefined)
})

test('una pausa a media ráfaga la parte: solo cuenta lo pegado', () => {
  const primero = teclear('2000', 10)
  // El cajero se distrae; lo que sigue empieza de cero.
  const segundo = teclear('000000012', 10, { desde: primero.ahora + 900, estado: primero.estado })
  assert.equal(segundo.estado.buffer, '000000012')
  assert.equal(procesarTecla(segundo.estado, 'Enter', segundo.ahora + 10).codigo, '000000012')
})

test('las teclas modificadoras no rompen la ráfaga ni suman', () => {
  let { estado, ahora } = teclear('20000', 10)
  const shift = procesarTecla(estado, 'Shift', ahora + 10)
  assert.equal(shift.estado.buffer, '20000', 'Shift no ensucia el código')
  const seguido = teclear('00000012', 10, { desde: ahora + 10, estado: shift.estado })
  assert.equal(procesarTecla(seguido.estado, 'Enter', seguido.ahora + 10).codigo, '2000000000012')
})

test('sin sufijo, el silencio cierra la ráfaga', () => {
  const { estado, ahora } = teclear('2000000000012', 10)
  assert.equal(codigoPorInactividad(estado, ahora + 10), null, 'aún puede llegar otra tecla')
  assert.equal(codigoPorInactividad(estado, ahora + 500), '2000000000012')
})

test('el silencio no inventa códigos a partir de ruido corto', () => {
  const { estado, ahora } = teclear('123', 10)
  assert.equal(codigoPorInactividad(estado, ahora + 500), null)
})
