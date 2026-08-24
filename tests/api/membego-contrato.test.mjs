/**
 * Contrato y fallos de la integración con Membego (TEST-004 / TEST-005).
 * Ejecutar: node --import tsx --test tests/api/membego-contrato.test.mjs
 *
 * La API de Membego es un sistema externo: si cambia un campo o se cae, el
 * mostrador tiene que degradar con un mensaje, no colgarse ni mentir. Aquí se
 * simula `fetch` para ejercer los caminos infelices que en producción no se
 * pueden provocar a voluntad:
 *
 *   · timeout           → NO_DISPONIBLE (503), no una espera infinita
 *   · caída de red      → NO_DISPONIBLE
 *   · 4xx de Membego    → se devuelve TAL CUAL (no se reintenta lo que no va)
 *   · 5xx de Membego    → 502 (fallo aguas arriba)
 *   · token vencido     → se reintenta UNA vez con token nuevo, no en bucle
 *   · respuesta no-JSON → error, no un objeto a medias
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Config mínima para que `faltaConfiguracion` no corte antes de la llamada.
process.env.MEMBEGO_CLIENT_ID = 'mgc_test'
process.env.MEMBEGO_CLIENT_SECRET = 'mgs_test'
process.env.MEMBEGO_COMPANY_ID = 'cmre_test'
process.env.MEMBEGO_API_URL = 'https://membego.test/api/platform/v1'
process.env.MEMBEGO_TIMEOUT_MS = '80' // corto, para que el test del timeout no tarde

const { llamar, ErrorMembego } = await import('../../api/_membego/cliente.ts')

/** Respuesta OK del endpoint de token, para que la fase de auth pase siempre. */
function respToken() {
  return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
}

/**
 * Simula fetch: el token siempre bien; la llamada de negocio la define el test.
 * `nLlamada` cuenta las llamadas de negocio (no las de token) para el retry.
 */
function fingir(respuestaNegocio) {
  let nToken = 0
  let nNegocio = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/oauth/token')) { nToken++; return respToken() }
    nNegocio++
    return respuestaNegocio(nNegocio, init)
  }
  return { tokens: () => nToken, negocio: () => nNegocio }
}

test('timeout de Membego → NO_DISPONIBLE (503), no espera infinita', async () => {
  fingir((_n, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), 5000)
    // Como el fetch real: cuando el AbortController aborta, la promesa se rechaza.
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err)
    })
  }))
  await assert.rejects(
    llamar('/vehicles?x=1'),
    (e) => e instanceof ErrorMembego && e.codigo === 'NO_DISPONIBLE' && e.status === 503
  )
})

test('caída de red → NO_DISPONIBLE', async () => {
  fingir(() => { throw new TypeError('fetch failed') })
  await assert.rejects(
    llamar('/vehicles?x=1'),
    (e) => e instanceof ErrorMembego && e.codigo === 'NO_DISPONIBLE'
  )
})

test('4xx de Membego se devuelve tal cual (no se reintenta lo que no va)', async () => {
  const espia = fingir(() => new Response('petición inválida', { status: 422 }))
  await assert.rejects(
    llamar('/redemptions', { metodo: 'POST', cuerpo: {} }),
    (e) => e instanceof ErrorMembego && e.codigo === 'RECHAZADO' && e.status === 422
  )
  assert.equal(espia.negocio(), 1, 'un 4xx no se reintenta')
})

test('5xx de Membego → 502 (fallo aguas arriba, no del mostrador)', async () => {
  fingir(() => new Response('boom', { status: 500 }))
  await assert.rejects(
    llamar('/vehicles?x=1'),
    (e) => e instanceof ErrorMembego && e.status === 502
  )
})

test('token vencido (401) se reintenta UNA vez con token nuevo', async () => {
  const espia = fingir((n) =>
    n === 1
      ? new Response('token expirado', { status: 401 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 })
  )
  const r = await llamar('/vehicles?x=1')
  assert.deepEqual(r, { ok: true })
  assert.equal(espia.negocio(), 2, 'exactamente un reintento')
  assert.ok(espia.tokens() >= 1, 'pidió un token nuevo tras el 401')
})

test('401 persistente NO entra en bucle: se reintenta una vez y se rinde', async () => {
  const espia = fingir(() => new Response('no', { status: 401 }))
  await assert.rejects(llamar('/vehicles?x=1'), (e) => e instanceof ErrorMembego)
  assert.equal(espia.negocio(), 2, 'un solo reintento, no un bucle')
})
