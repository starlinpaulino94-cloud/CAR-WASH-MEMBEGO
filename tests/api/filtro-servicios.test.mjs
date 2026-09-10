/**
 * El filtro de servicios por tipo de trabajo.
 * Ejecutar: node --import tsx --test tests/api/filtro-servicios.test.mjs
 *
 * Vive en un módulo porque se usa en seis pantallas y tiene que comportarse
 * igual en las seis. Estas pruebas son ese «igual».
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  filtrarServicios, categoriasConServicios, agruparPorCategoria, normalizar,
  TODAS, SIN_CATEGORIA
} = await import('../../src/lib/filtroServicios.ts')

const CATS = [
  { code: 'lavado', label: 'Lavados' },
  { code: 'brillado', label: 'Brillado y pulido' },
  { code: 'reparacion', label: 'Reparaciones' }
]

const SRV = [
  { category: 'lavado', name: 'Lavado por fuera', description: '' },
  { category: 'lavado', name: 'Lavado interior semi full', description: '' },
  { category: 'brillado', name: 'Brillado de faroles', description: '' },
  { category: 'brillado', name: 'Cera a máquina', description: 'brillo de salón' },
  { category: '', name: 'Servicio suelto', description: '' }
]

// ── filtrarServicios ────────────────────────────────────────────────────────

test('sin filtro salen todos', () => {
  assert.equal(filtrarServicios(SRV, {}).length, 5)
  assert.equal(filtrarServicios(SRV, { categoria: TODAS }).length, 5)
})

test('por categoría deja solo los de esa categoría', () => {
  const r = filtrarServicios(SRV, { categoria: 'lavado' })
  assert.deepEqual(r.map(s => s.name), ['Lavado por fuera', 'Lavado interior semi full'])
})

test('«Sin categoría» deja solo los que no tienen ninguna', () => {
  const r = filtrarServicios(SRV, { categoria: SIN_CATEGORIA })
  assert.deepEqual(r.map(s => s.name), ['Servicio suelto'])
})

test('el texto ignora acentos y mayúsculas', () => {
  assert.equal(filtrarServicios(SRV, { texto: 'maquina' }).length, 1)
  assert.equal(filtrarServicios(SRV, { texto: 'MÁQUINA' }).length, 1)
})

test('el texto también busca en la descripción', () => {
  const r = filtrarServicios(SRV, { texto: 'salon' })
  assert.deepEqual(r.map(s => s.name), ['Cera a máquina'])
})

test('categoría y texto se aplican a la vez, no uno u otro', () => {
  // «faro» existe en brillado; pidiendo lavados no debe salir.
  assert.equal(filtrarServicios(SRV, { categoria: 'lavado', texto: 'faro' }).length, 0)
  assert.equal(filtrarServicios(SRV, { categoria: 'brillado', texto: 'faro' }).length, 1)
})

test('los espacios sueltos no cuentan como búsqueda', () => {
  assert.equal(filtrarServicios(SRV, { texto: '   ' }).length, 5)
})

// ── categoriasConServicios ──────────────────────────────────────────────────

test('solo ofrece categorías que tienen algo dentro', () => {
  const r = categoriasConServicios(SRV, CATS)
  // «Reparaciones» no tiene ninguno: no se ofrece.
  assert.ok(!r.some(c => c.code === 'reparacion'))
  assert.deepEqual(r.slice(0, 2).map(c => c.code), ['lavado', 'brillado'])
})

test('añade «Sin categoría» solo si hay alguno suelto', () => {
  assert.ok(categoriasConServicios(SRV, CATS).some(c => c.code === SIN_CATEGORIA))
  const todosClasificados = SRV.filter(s => s.category)
  assert.ok(!categoriasConServicios(todosClasificados, CATS).some(c => c.code === SIN_CATEGORIA))
})

test('conserva el orden en que llegan las categorías', () => {
  const alReves = [...CATS].reverse()
  const r = categoriasConServicios(SRV, alReves)
  assert.deepEqual(r.slice(0, 2).map(c => c.code), ['brillado', 'lavado'])
})

// ── agruparPorCategoria ─────────────────────────────────────────────────────

test('agrupa para el desplegable y descarta los grupos vacíos', () => {
  const g = agruparPorCategoria(SRV, CATS)
  assert.deepEqual(g.map(x => x.label),
    ['Lavados', 'Brillado y pulido', 'Sin categoría'])
  assert.equal(g[0].servicios.length, 2)
})

test('un servicio con categoría desaparecida NO se pierde del desplegable', () => {
  // Le desactivaron la categoría: se sigue vendiendo, así que tiene que verse.
  const huerfano = [{ category: 'fantasma', name: 'Huérfano', description: '' }]
  const g = agruparPorCategoria(huerfano, CATS)
  assert.equal(g.length, 1)
  assert.equal(g[0].label, 'Sin categoría')
  assert.deepEqual(g[0].servicios.map(s => s.name), ['Huérfano'])
})

test('normalizar quita acentos', () => {
  assert.equal(normalizar('Reparación'), 'reparacion')
})
