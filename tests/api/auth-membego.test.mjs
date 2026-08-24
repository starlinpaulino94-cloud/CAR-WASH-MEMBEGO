/**
 * SEC-001 · pruebas del guard de los bordes de Membego.
 * Ejecutar: node --import tsx --test tests/api/auth-membego.test.mjs
 *
 * Dos cosas se protegen aquí:
 *   1. El guard `exigirEmpleado` rechaza a quien no es empleado (unidad, con
 *      `fetch` y el entorno simulados).
 *   2. Los cuatro bordes LLAMAN al guard antes de tocar Membego (código fuente,
 *      igual que los contract tests del propio Membego). Un borde que se
 *      olvidara del guard volvería a abrir el agujero.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// El módulo lee las variables al importarse, así que se ponen ANTES.
process.env.SUPABASE_URL = 'https://proyecto.supabase.co'
process.env.SUPABASE_ANON_KEY = 'anon-de-prueba'
process.env.MEMBEGO_COMPANY_ID = 'cmre-esta-empresa'

const { exigirEmpleado, ErrorAuth } = await import('../../api/_membego/auth.ts')

const VINCULO_OK = { membego_company_id: 'cmre-esta-empresa', is_active: true }

/** Simula las tres llamadas del guard: /auth/v1/user, /profiles y /membego_company_links. */
function fingirSupabase({
  userOk = true,
  userId = 'u-1',
  perfil = { role: 'cajero', is_active: true },
  vinculo = VINCULO_OK,
} = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/auth/v1/user')) {
      return userOk
        ? new Response(JSON.stringify({ id: userId }), { status: 200 })
        : new Response('no', { status: 401 })
    }
    if (u.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify(perfil ? [perfil] : []), { status: 200 })
    }
    if (u.includes('/rest/v1/membego_company_links')) {
      return new Response(JSON.stringify(vinculo ? [vinculo] : []), { status: 200 })
    }
    throw new Error('URL inesperada en la prueba: ' + u)
  }
}

const pet = (headers = {}) => new Request('https://x/api/membego/ficha', { method: 'POST', headers })

test('sin encabezado Authorization → 401', async () => {
  fingirSupabase()
  await assert.rejects(exigirEmpleado(pet()), (e) => e instanceof ErrorAuth && e.status === 401)
})

test('Authorization mal formado (no Bearer) → 401', async () => {
  fingirSupabase()
  await assert.rejects(
    exigirEmpleado(pet({ Authorization: 'Basic abc' })),
    (e) => e.status === 401
  )
})

test('token que Supabase rechaza → 401', async () => {
  fingirSupabase({ userOk: false })
  await assert.rejects(
    exigirEmpleado(pet({ Authorization: 'Bearer malo' })),
    (e) => e.status === 401 && e.codigo === 'NO_AUTENTICADO'
  )
})

test('usuario válido pero rol operario → 403 (operario no cobra)', async () => {
  fingirSupabase({ perfil: { role: 'operario', is_active: true } })
  await assert.rejects(
    exigirEmpleado(pet({ Authorization: 'Bearer ok' })),
    (e) => e.status === 403 && e.codigo === 'SIN_PERMISO'
  )
})

test('usuario válido pero desactivado → 403', async () => {
  fingirSupabase({ perfil: { role: 'cajero', is_active: false } })
  await assert.rejects(
    exigirEmpleado(pet({ Authorization: 'Bearer ok' })),
    (e) => e.status === 403
  )
})

test('usuario sin fila de perfil (no es de esta empresa) → 403', async () => {
  fingirSupabase({ perfil: null })
  await assert.rejects(
    exigirEmpleado(pet({ Authorization: 'Bearer ok' })),
    (e) => e.status === 403
  )
})

test('cajero activo Y de esta empresa → pasa y devuelve userId y rol', async () => {
  fingirSupabase({ userId: 'u-9', perfil: { role: 'cajero', is_active: true } })
  const r = await exigirEmpleado(pet({ Authorization: 'Bearer ok' }))
  assert.equal(r.userId, 'u-9')
  assert.equal(r.rol, 'cajero')
})

test('superadmin activo de esta empresa → pasa', async () => {
  fingirSupabase({ perfil: { role: 'superadmin', is_active: true } })
  const r = await exigirEmpleado(pet({ Authorization: 'Bearer ok' }))
  assert.equal(r.rol, 'superadmin')
})

// ── El candado de empresa (H1 de la revisión independiente) ──────────────────

test('cajero de OTRA empresa del mismo Supabase → 403 (su vínculo no coincide)', async () => {
  fingirSupabase({ vinculo: { membego_company_id: 'cmre-otra-empresa', is_active: true } })
  await assert.rejects(
    exigirEmpleado(pet({ Authorization: 'Bearer ok' })),
    (e) => e.status === 403 && e.codigo === 'SIN_PERMISO'
  )
})

test('empresa sin vínculo con Membego → 403', async () => {
  fingirSupabase({ vinculo: null })
  await assert.rejects(exigirEmpleado(pet({ Authorization: 'Bearer ok' })), (e) => e.status === 403)
})

test('vínculo a esta empresa pero DESACTIVADO → 403', async () => {
  fingirSupabase({ vinculo: { membego_company_id: 'cmre-esta-empresa', is_active: false } })
  await assert.rejects(exigirEmpleado(pet({ Authorization: 'Bearer ok' })), (e) => e.status === 403)
})

// ── Los cuatro bordes tienen que llamar al guard ANTES de tocar Membego ──────

const BORDES = ['ficha', 'canjear', 'revertir', 'tipos-vehiculo']

for (const nombre of BORDES) {
  test(`el borde ${nombre} llama a exigirEmpleado antes de llamar a Membego`, () => {
    const src = readFileSync(new URL(`../../api/membego/${nombre}.ts`, import.meta.url), 'utf8')
    assert.match(src, /exigirEmpleado\(request\)/, `${nombre} debe llamar exigirEmpleado(request)`)
    const posGuard = src.indexOf('exigirEmpleado(request)')
    const posLlamar = src.indexOf('llamar<')
    assert.ok(posGuard > 0, `${nombre}: falta el guard`)
    assert.ok(posLlamar > 0, `${nombre}: falta la llamada a Membego`)
    assert.ok(posGuard < posLlamar, `${nombre}: el guard va ANTES de tocar Membego`)
  })
}
