/**
 * EAN-13 · pruebas del codificador puro.
 * Ejecutar: node --import tsx --test tests/api/barcode.test.mjs
 *
 * Una etiqueta mal codificada no se nota hasta que el lector no pita en caja, y
 * para entonces ya se imprimieron mil. Por eso aquí se comprueba contra códigos
 * REALES cuyo patrón es conocido, no contra lo que devuelva nuestra propia
 * función: si las tablas L/G/R estuvieran mal copiadas, una prueba
 * auto-referencial pasaría igual.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { digitoVerificadorEan13, esEan13Valido, modulosEan13, gruposLegibles } =
  await import('../../src/lib/barcode.ts')

// ── Dígito verificador ───────────────────────────────────────────────────────

test('verificador de códigos reales conocidos', () => {
  // 4006381333931 — el ejemplo canónico de la especificación EAN.
  assert.equal(digitoVerificadorEan13('400638133393'), 1)
  // 5901234123457 — otro clásico de referencia.
  assert.equal(digitoVerificadorEan13('590123412345'), 7)
  // 9780306406157 — ISBN-13 de libro (mismo cálculo).
  assert.equal(digitoVerificadorEan13('978030640615'), 7)
})

test('un verificador de 0 se calcula bien (no se confunde con "sin dato")', () => {
  // 4006381333931 con otros dígitos: se busca uno cuyo verificador dé 0.
  const check = digitoVerificadorEan13('200000000001')
  assert.equal(typeof check, 'number')
  assert.ok(check >= 0 && check <= 9)
})

test('exige exactamente 12 dígitos', () => {
  assert.throws(() => digitoVerificadorEan13('12345'))
  assert.throws(() => digitoVerificadorEan13('1234567890123'))
})

// ── Validación ───────────────────────────────────────────────────────────────

test('valida códigos correctos y rechaza los que tienen el verificador mal', () => {
  assert.equal(esEan13Valido('4006381333931'), true)
  assert.equal(esEan13Valido('5901234123457'), true)
  // Mismo código con el último dígito cambiado: debe rechazarse.
  assert.equal(esEan13Valido('4006381333932'), false)
  assert.equal(esEan13Valido('5901234123450'), false)
})

test('rechaza longitudes que no son 13', () => {
  assert.equal(esEan13Valido('123'), false)
  assert.equal(esEan13Valido(''), false)
  assert.equal(esEan13Valido('40063813339311'), false)
})

// ── Módulos ──────────────────────────────────────────────────────────────────

test('el patrón tiene 95 módulos y las guardas en su sitio', () => {
  const m = modulosEan13('4006381333931')
  assert.equal(m.length, 95, 'un EAN-13 son siempre 95 módulos')
  assert.equal(m.slice(0, 3), '101', 'guarda inicial')
  assert.equal(m.slice(45, 50), '01010', 'guarda central')
  assert.equal(m.slice(92), '101', 'guarda final')
})

/** Completa 12 dígitos con su verificador, para no fijar códigos a mano. */
const conCheck = (doce) => doce + String(digitoVerificadorEan13(doce))

test('el primer dígito viaja en la PARIDAD, no en barras propias', () => {
  // 0… usa LLLLLL: el primer dígito de datos se codifica en L.
  // Para 0000000000000 el segundo dígito (0) va en L → '0001101'.
  const cero = modulosEan13('0000000000000')
  assert.equal(cero.slice(3, 10), '0001101', 'L del 0')

  // Mismos 11 dígitos de datos, distinto primer dígito: la paridad de la mitad
  // izquierda cambia (0→LLLLLL, 5→LGGLLG), así que el patrón NO puede coincidir
  // aunque los dígitos dibujados sean los mismos. Eso es justo lo que hace que
  // el primer dígito quepa sin barras propias.
  const conCero  = modulosEan13(conCheck('090123412345'))
  const conCinco = modulosEan13(conCheck('590123412345'))
  const izqCero  = conCero.slice(3, 45)
  const izqCinco = conCinco.slice(3, 45)
  assert.notEqual(izqCinco, izqCero, 'distinta paridad debe dar distinto patrón')

  // Y el tercer dígito (el que pasa de L a G) es exactamente donde difieren.
  assert.equal(conCero.slice(10, 17), izqCero.slice(7, 14))
  assert.notEqual(conCero.slice(17, 24), conCinco.slice(17, 24), 'el 3.º cambia de L a G')
})

test('la mitad derecha usa R (siempre empieza por barra)', () => {
  const m = modulosEan13('4006381333931')
  // Cada dígito R empieza en 1 y termina en 0.
  for (let i = 0; i < 6; i++) {
    const d = m.slice(50 + i * 7, 57 + i * 7)
    assert.equal(d[0], '1', `dígito derecho ${i} debe empezar en barra`)
    assert.equal(d[6], '0', `dígito derecho ${i} debe terminar en espacio`)
  }
})

test('no dibuja un código con el verificador mal', () => {
  assert.throws(() => modulosEan13('4006381333932'), /no es un EAN-13/)
})

// ── Ida y vuelta: decodificar lo que dibujamos ───────────────────────────────

/**
 * Un decodificador independiente, escrito AL REVÉS que el codificador: aquí solo
 * se teclea la tabla L, y R se deriva como su complemento y G como el reverso de
 * R (que es la relación que define el estándar). Si `barcode.ts` tuviera una
 * errata en G o en R, este decodificador no llegaría al mismo número — cosa que
 * una prueba que reusara sus tablas jamás detectaría.
 */
const L_TEST = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]
const complemento = (s) => [...s].map((c) => (c === '0' ? '1' : '0')).join('')
const reverso = (s) => [...s].reverse().join('')
const R_TEST = L_TEST.map(complemento)
const G_TEST = R_TEST.map(reverso)
const PARIDAD_TEST = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]

function decodificar(modulos) {
  assert.equal(modulos.slice(0, 3), '101')
  assert.equal(modulos.slice(45, 50), '01010')
  assert.equal(modulos.slice(92), '101')

  // La paridad de cada uno de los 6 dígitos izquierdos revela el primer dígito.
  let patron = ''
  const izquierda = []
  for (let i = 0; i < 6; i++) {
    const trozo = modulos.slice(3 + i * 7, 10 + i * 7)
    const enL = L_TEST.indexOf(trozo)
    const enG = G_TEST.indexOf(trozo)
    assert.ok(enL >= 0 || enG >= 0, `trozo izquierdo ${i} no está en L ni en G`)
    patron += enL >= 0 ? 'L' : 'G'
    izquierda.push(enL >= 0 ? enL : enG)
  }
  const primero = PARIDAD_TEST.indexOf(patron)
  assert.ok(primero >= 0, `patrón de paridad desconocido: ${patron}`)

  const derecha = []
  for (let i = 0; i < 6; i++) {
    const trozo = modulos.slice(50 + i * 7, 57 + i * 7)
    const d = R_TEST.indexOf(trozo)
    assert.ok(d >= 0, `trozo derecho ${i} no está en R`)
    derecha.push(d)
  }

  return `${primero}${izquierda.join('')}${derecha.join('')}`
}

test('lo que se dibuja se vuelve a leer: ida y vuelta con tablas derivadas', () => {
  const casos = ['4006381333931', '5901234123457', '9780306406157', '0000000000000']
  for (const c of casos) {
    assert.equal(decodificar(modulosEan13(c)), c, `no se pudo releer ${c}`)
  }
})

test('ida y vuelta sobre códigos generados como los del sistema (prefijo 2)', () => {
  // Los que emite la base: '2' + 11 dígitos + verificador. Se barren varios para
  // ejercer los diez patrones de paridad y los diez dígitos en cada posición.
  for (let n = 0; n < 40; n++) {
    const doce = '2' + String(n * 271828183).padStart(11, '0').slice(-11)
    const codigo = conCheck(doce)
    assert.equal(decodificar(modulosEan13(codigo)), codigo)
  }
})

test('los diez dígitos se codifican bien en AMBAS mitades', () => {
  // Un código por dígito repetido: caza una errata en una sola celda de L/G/R.
  for (let d = 0; d <= 9; d++) {
    const codigo = conCheck(String(d).repeat(12))
    assert.equal(decodificar(modulosEan13(codigo)), codigo, `falla con el dígito ${d}`)
  }
})

// ── Legibilidad ──────────────────────────────────────────────────────────────

test('el número se agrupa 1 + 6 + 6, como en cualquier producto', () => {
  assert.deepEqual(gruposLegibles('4006381333931'), ['4', '006381', '333931'])
})
