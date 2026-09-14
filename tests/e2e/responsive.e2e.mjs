/**
 * Que la aplicación quepa en la pantalla de quien la abra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE COMPRUEBA, Y POR QUÉ ASÍ
 *
 * Dos cosas, medidas en el navegador y no opinadas:
 *
 *   1. Que nada quede FUERA DE ALCANCE. Un elemento que se sale por la derecha
 *      NO es un fallo si vive dentro de algo que se desplaza: una matriz de
 *      precios de once categorías se desliza, y está bien. El fallo es lo que
 *      queda fuera sin forma de llegar, que es lo que pasaba: la cáscara de la
 *      aplicación es `overflow-hidden` y `main` no llevaba `min-w-0`, así que
 *      crecía hasta el ancho de la tabla más larga —1.600 px— y en un teléfono
 *      media aplicación era inalcanzable.
 *
 *   2. Que nada quede RECORTADO sin poder desplazarse: más contenido del que
 *      se enseña, con `overflow: hidden` y sin `auto` ni `scroll`.
 *
 * Se excluyen `sr-only` y `truncate`: los dos recortan a propósito —uno es
 * texto para lectores de pantalla, el otro son puntos suspensivos— y marcarlos
 * llenaría el informe de ruido hasta que nadie lo leyera.
 *
 * Ejecutar: `node tests/e2e/responsive.e2e.mjs` con la pila e2e en pie.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL = 'http://127.0.0.1:4174/';
const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const PANTALLAS = [
  { nombre: 'móvil 360',   width: 360,  height: 740 },
  { nombre: 'móvil 390',   width: 390,  height: 844 },
  { nombre: 'tablet 768',  width: 768,  height: 1024 },
  { nombre: 'portátil 1280', width: 1280, height: 800 },
];

const RUTAS = [
  '/', '/operaciones', '/operaciones/cola', '/operaciones/bahias', '/operaciones/calidad',
  '/ventas', '/ventas/servicios', '/facturacion', '/caja', '/clientes',
  '/inventario', '/personal', '/reportes', '/configuracion',
];

const sonda = () => {
  const doc = document.documentElement;
  const salida = {
    desbordaX: doc.scrollWidth - doc.clientWidth,
    anchoVista: doc.clientWidth,
    culpables: [],
    recortados: [],
  };
  const vw = doc.clientWidth;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const est = getComputedStyle(el);
    if (est.display === 'none' || est.visibility === 'hidden') continue;
    // `sr-only` está recortado a propósito: es texto para lectores de pantalla.
    const clases = (el.className || '').toString();
    if (clases.includes('sr-only') || clases.includes('truncate')) continue;

    // 1. Se sale por la derecha del viewport Y NADIE puede desplazarse hasta
    //    ello. Un elemento fuera de pantalla dentro de un contenedor con
    //    `overflow-x: auto` no es un fallo: es una tabla que se desliza. Lo que
    //    hay que cazar es lo que queda fuera sin forma de llegar.
    let alcanzable = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ea = getComputedStyle(a);
      if (['auto', 'scroll'].includes(ea.overflowX) && a.scrollWidth > a.clientWidth + 2) {
        alcanzable = true; break;
      }
    }
    if (!alcanzable && r.right > vw + 1 && r.width > 40) {
      salida.culpables.push({
        et: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 70),
        ancho: Math.round(r.width), derecha: Math.round(r.right),
      });
    }
    // 2. Tiene más contenido del que enseña y NO deja desplazarse.
    const cortaY = el.scrollHeight > el.clientHeight + 2;
    const cortaX = el.scrollWidth > el.clientWidth + 2;
    const puedeY = ['auto', 'scroll'].includes(est.overflowY);
    const puedeX = ['auto', 'scroll'].includes(est.overflowX);
    if ((cortaY && est.overflowY === 'hidden' && !puedeY) ||
        (cortaX && est.overflowX === 'hidden' && !puedeX)) {
      salida.recortados.push({
        et: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 70),
        eje: cortaY && est.overflowY === 'hidden' ? 'vertical' : 'horizontal',
        visible: cortaY ? el.clientHeight : el.clientWidth,
        real: cortaY ? el.scrollHeight : el.scrollWidth,
      });
    }
  }
  salida.culpables = salida.culpables.slice(0, 6);
  salida.recortados = salida.recortados.slice(0, 6);
  return salida;
};

const fallos = [];
const browser = await chromium.launch(
  existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});

for (const p of PANTALLAS) {
  const ctx = await browser.newContext({ viewport: { width: p.width, height: p.height } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico').fill('dueno@example.com');
  await page.getByLabel('Contraseña').fill('clave-de-prueba');
  await page.getByRole('button', { name: /Entrar/ }).click();
  await page.waitForTimeout(3000);

  console.log(`\n══════ ${p.nombre} (${p.width}×${p.height})`);
  let limpia = true;
  for (const ruta of RUTAS) {
    await page.goto(URL.replace(/\/$/, '') + ruta, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(900);
    const r = await page.evaluate(sonda);
    const problemas = [];
    if (r.desbordaX > 1) problemas.push(`se sale ${r.desbordaX}px a lo ancho`);
    if (r.recortados.length) problemas.push(`${r.recortados.length} recortado(s) sin scroll`);
    if (!problemas.length) continue;
    limpia = false;
    fallos.push(`${p.nombre} · ${ruta}: ${problemas.join(' · ')}`);
    console.log(`  ${ruta}  →  ${problemas.join(' · ')}`);
    for (const c of r.culpables) console.log(`      ancho ${c.ancho}px, borde ${c.derecha} > ${r.anchoVista}  <${c.et} class="${c.cls}">`);
    for (const c of r.recortados) console.log(`      RECORTE ${c.eje}: enseña ${c.visible} de ${c.real}  <${c.et} class="${c.cls}">`);
  }
  if (limpia) console.log('  sin desbordes ni recortes inalcanzables');
  await ctx.close();
}
await browser.close();

if (fallos.length) {
  console.log(`\n${fallos.length} problema(s) de adaptación:`);
  for (const f of fallos) console.log(`  · ${f}`);
  process.exit(1);
}
console.log('\nLa aplicación cabe en las cuatro pantallas.');
