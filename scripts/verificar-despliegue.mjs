/**
 * Genera una consulta SQL que dice QUÉ LE FALTA A LA BASE DE PRODUCCIÓN.
 *
 * Ejecutar:  node scripts/verificar-despliegue.mjs
 * Después:   pegar la salida en Supabase → SQL Editor y ejecutar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ
 *
 * El fallo más caro de este sistema no es un error de programación: es una
 * migración que nunca se aplicó. El código nuevo se despliega solo —Vercel lo
 * hace al empujar— pero la base NO. Entonces la pantalla llama a una función
 * que en esa base no existe y el usuario ve «no se pudo cargar», que es
 * exactamente lo mismo que se ve cuando hay un error de verdad. Ha pasado ya:
 * la política que deja al mostrador leer su vínculo con Membego viajaba en una
 * migración, y mientras no se aplicó, a los cajeros les fallaba jalar clientes
 * y a los dueños no.
 *
 * La lista no se escribe a mano: se saca de las migraciones cada vez que se
 * corre. Una lista escrita a mano envejece en la primera migración nueva y
 * entonces da el visto bueno a una base incompleta, que es la peor manera de
 * fallar.
 */

import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../supabase/migrations/', import.meta.url);

/**
 * Los comentarios se quitan ANTES de buscar nombres. Un comentario que explica
 * un `create table as` contiene literalmente esa frase, y sin esto el script
 * exigía a la base una tabla llamada «as». Una herramienta de diagnóstico que
 * inventa un fallo enseña a desconfiar de ella, y entonces deja de servir el
 * día que acierta.
 */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

const sql = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => sinComentarios(readFileSync(new URL(f, DIR), 'utf8')))
  .join('\n');

/** Nombres creados por las migraciones. `drop` se tiene en cuenta al final. */
const funciones = new Set();
for (const m of sql.matchAll(
  /create\s+(?:or\s+replace\s+)?function\s+(?:(?:public|app)\.)?"?([a-z0-9_]+)"?\s*\(/gi
)) {
  funciones.add(m[1].toLowerCase());
}

const tablas = new Set();
for (const m of sql.matchAll(
  /create\s+(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:(?:public|app)\.)?"?([a-z0-9_]+)"?/gi
)) {
  tablas.add(m[1].toLowerCase());
}
// Un `rename to` deja el nombre viejo sin existir: vale el nuevo.
for (const m of sql.matchAll(
  /alter\s+table\s+(?:if\s+exists\s+)?(?:(?:public|app)\.)?"?([a-z0-9_]+)"?\s+rename\s+to\s+"?([a-z0-9_]+)"?/gi
)) {
  tablas.delete(m[1].toLowerCase());
  tablas.add(m[2].toLowerCase());
}
// Lo que una migración posterior tira ya no debe exigirse.
for (const m of sql.matchAll(
  /drop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?(?:(?:public|app)\.)?"?([a-z0-9_]+)"?/gi
)) {
  tablas.delete(m[1].toLowerCase());
}
for (const m of sql.matchAll(
  /drop\s+function\s+(?:if\s+exists\s+)?(?:(?:public|app)\.)?"?([a-z0-9_]+)"?/gi
)) {
  // Solo si NINGUNA migración posterior la vuelve a crear; como se recorren en
  // orden y `create or replace` la repone, se comprueba por última aparición.
  const nombre = m[1].toLowerCase();
  const ultimoCreate = sql.toLowerCase().lastIndexOf(`function ${nombre}(`);
  const ultimoCreateEsp = sql.toLowerCase().lastIndexOf(`function ${nombre} (`);
  const ultimoDrop = sql.toLowerCase().lastIndexOf(`drop function if exists ${nombre}`);
  if (Math.max(ultimoCreate, ultimoCreateEsp) < ultimoDrop) funciones.delete(nombre);
}

const lista = (s) =>
  [...s]
    .sort()
    .map((n) => `    ('${n}')`)
    .join(',\n');

const migraciones = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

process.stdout.write(`-- ════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN DE DESPLIEGUE — generado por scripts/verificar-despliegue.mjs
-- ${migraciones.length} migraciones en el repositorio.
-- La última es ${migraciones[migraciones.length - 1]}
--
-- Pegue todo esto en Supabase → SQL Editor y ejecútelo. NO MODIFICA NADA:
-- solo lee el catálogo. Si devuelve cero filas, la base tiene todo lo que el
-- código espera. Cada fila que devuelva es algo que una pantalla va a pedir y
-- no va a encontrar: aplique las migraciones pendientes (\`supabase db push\`).
-- ════════════════════════════════════════════════════════════════════════

with esperadas(tipo, nombre) as (
  select 'función', nombre from (values
${lista(funciones)}
  ) as f(nombre)
  union all
  select 'tabla o vista', nombre from (values
${lista(tablas)}
  ) as t(nombre)
)
select
  e.tipo,
  e.nombre                                   as falta_en_la_base,
  'Aplique las migraciones pendientes'       as que_hacer
from esperadas e
where not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.proname = e.nombre
)
and not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app') and c.relname = e.nombre
    and c.relkind in ('r', 'v', 'm', 'p')
)
order by e.tipo, e.nombre;
`);
