/**
 * Normalización de los errores de la base.
 * Ejecutar: node --import tsx --test tests/api/error-datos.test.mjs
 *
 * supabase-js no lanza un `Error`: lanza `{ message, code, details, hint }`.
 * Toda la aplicación decide qué enseñar con `err instanceof Error ? err.message
 * : '…genérico…'`, así que con un objeto plano el mensaje real se descartaba
 * SIEMPRE. Eso es lo que dejó Horarios diciendo «No se pudieron cargar los
 * turnos» mientras PostgREST explicaba con precisión qué relación no podía
 * resolver.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { fallaDatos, ErrorDatos } = await import('../../src/data/errorDatos.ts')

test('un error de PostgREST se convierte en Error de verdad', () => {
  const crudo = {
    message: "Could not embed because more than one relationship was found for 'work_shifts' and 'profiles'",
    code: 'PGRST201',
    details: null,
    hint: 'Try changing profiles to one of the following: ...',
  }
  const e = fallaDatos(crudo)

  // Lo que arregla los ~120 sitios que enseñan errores.
  assert.ok(e instanceof Error, 'debe pasar el instanceof que usa la interfaz')
  assert.equal(e.message, crudo.message, 'el mensaje real NO se pierde')
  assert.equal(e.codigo, 'PGRST201')
  assert.equal(e.pista, crudo.hint)
})

test('el código técnico no se mete en el mensaje', () => {
  // Quien está cobrando no necesita leer «PGRST201» para entender que falló.
  const e = fallaDatos({ message: 'permission denied for table work_shifts', code: '42501' })
  assert.equal(e.message, 'permission denied for table work_shifts')
  assert.ok(!e.message.includes('42501'))
})

test('un Error de verdad se deja intacto', () => {
  const original = new Error('No tiene permiso para modificar esta orden')
  assert.equal(fallaDatos(original), original, 'no se envuelve dos veces')
})

test('lo que no trae mensaje no se queda mudo', () => {
  for (const raro of [null, undefined, {}, 'texto suelto', 42]) {
    const e = fallaDatos(raro)
    assert.ok(e instanceof Error)
    assert.ok(e.message.length > 0, `sin mensaje para ${JSON.stringify(raro)}`)
  }
})

test('un mensaje vacío no cuenta como mensaje', () => {
  const e = fallaDatos({ message: '   ' })
  assert.ok(e.message.trim().length > 0)
})

test('ErrorDatos se puede reconocer por su nombre', () => {
  const e = fallaDatos({ message: 'x' })
  assert.ok(e instanceof ErrorDatos)
  assert.equal(e.name, 'ErrorDatos')
})
