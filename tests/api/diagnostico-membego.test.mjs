/**
 * El diagnóstico de Membego (`api/membego/diagnostico.ts`).
 * Ejecutar: node --import tsx --test tests/api/diagnostico-membego.test.mjs
 *
 * Lo que se protege aquí es de dos naturalezas y conviene no confundirlas:
 *
 *   1. Que DIGA LA VERDAD. Un diagnóstico que se equivoca es peor que no
 *      tenerlo: manda a arreglar lo que no está roto. Cada prueba rompe UNA
 *      cosa y exige que el informe señale esa y no otra.
 *
 *   2. Que NO SEA UNA PUERTA DE ATRÁS. Es la única función de `api/membego/`
 *      que no llama a `exigirEmpleado` de una pieza —necesita correr los pasos
 *      sueltos para poder decir cuál falla—, así que hay que comprobar a mano
 *      lo que el guard garantiza en las demás: sin sesión no se sale a Membego,
 *      y sin pasar el guard entero no se pregunta por ningún cliente.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

process.env.SUPABASE_URL = 'https://proyecto.supabase.co'
process.env.SUPABASE_ANON_KEY = 'anon-de-prueba'
process.env.MEMBEGO_COMPANY_ID = 'cmre-esta-empresa'
process.env.MEMBEGO_CLIENT_ID = 'mgc_prueba'
process.env.MEMBEGO_CLIENT_SECRET = 'mgs_prueba'
process.env.MEMBEGO_API_URL = 'https://membego.example/api/platform/v1'

const { POST } = await import('../../api/membego/diagnostico.ts')

const VINCULO_OK = { membego_company_id: 'cmre-esta-empresa', is_active: true }

/**
 * Simula Supabase y Membego. `membegoVehiculos = null` hace que `/vehicles`
 * conteste 404, que es el caso «ese cliente no es de esta empresa».
 */
function fingir({
  userOk = true,
  perfil = { role: 'cajero', is_active: true },
  vinculo = VINCULO_OK,
  tokenMembegoOk = true,
  membegoVehiculos = [],
  redirige = false,
} = {}) {
  const llamadas = []
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    llamadas.push(u)
    if (u.includes('/auth/v1/user')) {
      return userOk
        ? new Response(JSON.stringify({ id: 'u-1' }), { status: 200 })
        : new Response('no', { status: 401 })
    }
    if (u.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify(perfil ? [perfil] : []), { status: 200 })
    }
    if (u.includes('/rest/v1/membego_company_links')) {
      return new Response(JSON.stringify(vinculo ? [vinculo] : []), { status: 200 })
    }
    if (redirige) {
      return new Response(null, { status: 301, headers: { location: 'https://www.membego.example' + new URL(u).pathname } })
    }
    if (u.includes('/oauth/token')) {
      return tokenMembegoOk
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
        : new Response('credencial mala', { status: 401 })
    }
    if (u.includes('/vehicles')) {
      return membegoVehiculos === null
        ? new Response('no existe', { status: 404 })
        : new Response(JSON.stringify({ vehicles: membegoVehiculos }), { status: 200 })
    }
    throw new Error('URL inesperada en la prueba: ' + (init?.method ?? 'GET') + ' ' + u)
  }
  return llamadas
}

const pedir = (cuerpo = {}, headers = { Authorization: 'Bearer ok' }) =>
  new Request('https://x/api/membego/diagnostico', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  })

/** El informe, indexado por clave de paso. */
async function informe(request) {
  const res = await POST(request)
  const body = await res.json()
  const porClave = Object.fromEntries(body.pasos.map((p) => [p.clave, p]))
  return { body, porClave }
}

// ── Que diga la verdad ──────────────────────────────────────────────────────

test('todo bien: el informe sale en verde y sin fallos', async () => {
  fingir()
  const { body, porClave } = await informe(
    pedir({ supabaseUrl: 'https://proyecto.supabase.co', membegoCustomerId: 'c-1' })
  )
  assert.equal(body.ok, true, body.resumen)
  for (const clave of ['configuracion', 'mismo_proyecto', 'sesion', 'perfil', 'vinculo', 'credencial', 'ficha']) {
    assert.equal(porClave[clave].estado, 'ok', `${clave}: ${porClave[clave].detalle}`)
  }
})

test('dos proyectos de Supabase distintos: lo señala, y solo eso', async () => {
  fingir()
  const { porClave } = await informe(pedir({ supabaseUrl: 'https://OTRO.supabase.co' }))
  assert.equal(porClave.mismo_proyecto.estado, 'falla')
  assert.match(porClave.mismo_proyecto.detalle, /otro\.supabase\.co/i)
  // La sesión es válida: el fallo no puede contagiarse a los demás pasos.
  assert.equal(porClave.sesion.estado, 'ok')
})

test('rol sin permiso: culpa al rol, no a la vinculación', async () => {
  fingir({ perfil: { role: 'operario', is_active: true } })
  const { porClave } = await informe(pedir())
  assert.equal(porClave.perfil.estado, 'falla')
  assert.equal(porClave.vinculo.estado, 'omitido')
})

test('recepcionista: consulta sí, canje no, y no es un fallo', async () => {
  fingir({ perfil: { role: 'recepcionista', is_active: true } })
  const { porClave } = await informe(pedir())
  assert.equal(porClave.perfil.estado, 'ok')
  assert.match(porClave.perfil.detalle, /no canjear|no puede canjear/i)
})

test('sin vínculo visible: nombra la migración, que es la causa que nadie adivina', async () => {
  fingir({ vinculo: null })
  const { porClave } = await informe(pedir())
  assert.equal(porClave.vinculo.estado, 'falla')
  assert.match(porClave.vinculo.arreglo, /20260909130000/)
})

test('credencial rechazada por Membego: lo dice y no culpa a la sesión', async () => {
  fingir({ tokenMembegoOk: false })
  const { porClave } = await informe(pedir())
  assert.equal(porClave.sesion.estado, 'ok')
  assert.equal(porClave.credencial.estado, 'falla')
})

test('cliente de otra empresa (404): explica que el id es de otra empresa', async () => {
  fingir({ membegoVehiculos: null })
  const { porClave } = await informe(pedir({ membegoCustomerId: 'c-de-otro-lado' }))
  assert.equal(porClave.ficha.estado, 'falla')
  assert.match(porClave.ficha.arreglo, /no existe en la empresa/i)
})

test('una redirección se nombra en vez de romper el cobro en silencio', async () => {
  fingir({ redirige: true })
  const { porClave } = await informe(pedir())
  assert.equal(porClave.credencial.estado, 'falla')
  assert.match(porClave.credencial.detalle, /redirige|MEMBEGO_API_URL/)
})

// ── Que no sea una puerta de atrás ──────────────────────────────────────────

test('sin sesión: no se sale a Membego ni una sola vez', async () => {
  const llamadas = fingir()
  const { body, porClave } = await informe(pedir({ membegoCustomerId: 'c-1' }, {}))
  assert.equal(body.ok, false)
  assert.equal(porClave.sesion.estado, 'falla')
  assert.equal(porClave.credencial.estado, 'omitido')
  assert.equal(porClave.ficha.estado, 'omitido')
  assert.ok(
    llamadas.every((u) => !u.includes('membego.example')),
    'sin sesión no puede haber ninguna llamada a Membego: ' + llamadas.join(', ')
  )
})

test('sesión válida pero sin pasar el guard: no se pregunta por ningún cliente', async () => {
  const llamadas = fingir({ perfil: { role: 'operario', is_active: true } })
  const { porClave } = await informe(pedir({ membegoCustomerId: 'c-1' }))
  assert.equal(porClave.ficha.estado, 'omitido')
  assert.ok(
    llamadas.every((u) => !u.includes('/vehicles')),
    'preguntar por un cliente exige el guard entero, igual que en ficha.ts'
  )
})

test('el informe nunca lleva el secreto de Membego', async () => {
  fingir()
  const res = await POST(pedir({ supabaseUrl: 'https://proyecto.supabase.co', membegoCustomerId: 'c-1' }))
  const texto = await res.text()
  assert.ok(!texto.includes('mgs_prueba'), 'el client_secret no puede salir del servidor')
  assert.ok(!texto.includes('anon-de-prueba'), 'las claves no se devuelven, ni la anon')
})

// ── Que no invente causas ───────────────────────────────────────────────────
//
// Estas dos corren en un PROCESO APARTE, y no es ceremonia: `auth.ts` lee las
// variables de entorno al cargarse, así que borrarlas desde dentro de la prueba
// no cambia nada — el módulo ya las capturó. Un despliegue mal configurado solo
// se reproduce arrancando con esa configuración.

/** Corre el diagnóstico en un proceso con el entorno dado y devuelve el informe. */
function informeConEntorno(entorno, cabeceras = { Authorization: 'Bearer ok' }) {
  const guion = `
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u-1' }), { status: 200 })
      if (u.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ role: 'cajero', is_active: true }]), { status: 200 })
      if (u.includes('/rest/v1/membego_company_links')) return new Response(JSON.stringify([{ membego_company_id: 'cmre-esta-empresa', is_active: true }]), { status: 200 })
      if (u.includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      return new Response(JSON.stringify({ vehicles: [] }), { status: 200 })
    }
    const { POST } = await import('./api/membego/diagnostico.ts')
    const res = await POST(new Request('https://x/api/membego/diagnostico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...${JSON.stringify(cabeceras)} },
      body: '{}',
    }))
    process.stdout.write(await res.text())
  `
  const salida = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', guion],
    { env: { ...process.env, ...entorno }, encoding: 'utf8' }
  )
  const body = JSON.parse(salida)
  return { body, porClave: Object.fromEntries(body.pasos.map((p) => [p.clave, p])) }
}

const SIN_SUPABASE = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', MEMBEGO_COMPANY_ID: '' }

test('sin variables del servidor NO se acusa a la sesión del usuario', () => {
  // Llega un token perfectamente válido. Lo que falta es con qué comprobarlo.
  // Decir «La petición llegó sin sesión» y mandar a «cerrar sesión y volver a
  // entrar» manda a arreglar lo que no está roto, y hace que el siguiente
  // informe —el correcto— tampoco se crea.
  const { porClave } = informeConEntorno(SIN_SUPABASE)
  assert.notEqual(porClave.sesion.estado, 'falla', 'con sesión presente, el fallo no es suyo')
  assert.match(porClave.sesion.detalle, /no tiene contra qué validarla|faltan SUPABASE/i)
  assert.equal(porClave.configuracion.estado, 'falla', 'el fallo de verdad sí se señala')
})

test('sí se acusa a la sesión cuando de verdad no llegó ninguna', async () => {
  fingir()
  const { porClave } = await informe(pedir({}, {}))
  assert.equal(porClave.sesion.estado, 'falla')
  assert.match(porClave.sesion.detalle, /sin sesión/i)
})

// En Vercel una variable marcada solo para Production NO existe en la vista
// previa de una rama. Sin decir DÓNDE corre, el informe y el panel de Vercel se
// contradicen y nadie puede saber que están mirando despliegues distintos.
test('el informe dice en qué despliegue corre, y avisa si es una vista previa', () => {
  const { body, porClave } = informeConEntorno({ ...SIN_SUPABASE, VERCEL_ENV: 'preview' })
  assert.equal(body.entorno, 'preview')
  assert.match(porClave.configuracion.detalle, /preview/)
  assert.match(porClave.configuracion.arreglo, /VISTA PREVIA|Preview/)
})

test('en producción el consejo NO habla de vistas previas', () => {
  const { porClave } = informeConEntorno({ ...SIN_SUPABASE, VERCEL_ENV: 'production' })
  assert.match(porClave.configuracion.detalle, /production/)
  assert.ok(!/VISTA PREVIA/.test(porClave.configuracion.arreglo))
})
