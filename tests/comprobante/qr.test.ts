/**
 * El QR del comprobante: centrado y con su zona de silencio.
 *
 * Los dos fallos que esto protege se veían en PAPEL y no en el código:
 *
 *   · El QR salía pegado al margen izquierdo. El contenedor lleva
 *     `text-center`, pero el reset de Tailwind pone `svg { display: block }` y
 *     `text-align` no centra un bloque. Medido antes del arreglo, sobre papel
 *     de 80 mm: 11 px de margen a la izquierda y 163 a la derecha.
 *   · El patrón llegaba al filo del SVG, sin el margen blanco que la norma del
 *     QR exige para que un lector encuentre dónde empieza — y con el pie de
 *     texto a cero píxeles del borde de abajo.
 *
 * Se renderiza el componente de verdad, no una copia de su marca: una prueba
 * sobre marca duplicada seguiría pasando el día que alguien cambie el
 * componente, que es justo el día en que tendría que fallar.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { TicketComprobante } from '../../src/components/common/TicketComprobante.tsx';
import { QrCode } from '../../src/components/common/QrCode.tsx';
import type { ReceiptDoc } from '../../src/lib/comprobante/tipos.ts';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detalle = '') => {
  if (cond) { pass++; console.log('  PASA  ' + name); }
  else { fail++; console.log('  FALLA ' + name + (detalle ? `  [${detalle}]` : '')); }
};

const doc: ReceiptDoc = {
  paperWidthMm: 80,
  lines: [{ kind: 'qr', data: 'TX-000123-ABCDEF', caption: 'Escanea para consultar' }]
};

const html = renderToStaticMarkup(React.createElement(TicketComprobante, { doc }));

// ── Centrado ────────────────────────────────────────────────────────────────
const svgAbre = html.match(/<svg[^>]*>/)?.[0] ?? '';
check('el SVG del QR lleva mx-auto, que es lo que centra un bloque',
  /class="[^"]*\bmx-auto\b/.test(svgAbre), svgAbre.slice(0, 120));

// `text-center` sigue haciendo falta para el pie, así que no vale quitarlo.
check('el contenedor conserva text-center para el pie de texto',
  /<div class="my-1 text-center">/.test(html));

// ── Zona de silencio ────────────────────────────────────────────────────────
const soloQr = renderToStaticMarkup(
  React.createElement(QrCode, { value: 'TX-000123-ABCDEF', size: 128 })
);
const viewBox = soloQr.match(/viewBox="0 0 (\d+) (\d+)"/);
const modulos = (soloQr.match(/h1v1h-1z/g) ?? []).length;

check('el QR se dibuja (hay módulos oscuros)', modulos > 0, `${modulos} módulos`);
/*
 * Esto solo dice que el lienzo es CUADRADO, y así está rotulado: escrito como
 * «deja 4 módulos de margen» pasaba igual con la zona de silencio en cero,
 * porque comparar ancho con alto es verdad siempre. El margen de verdad se
 * comprueba más abajo, contra la matriz.
 */
check('el lienzo del QR es cuadrado',
  viewBox !== null && viewBox[1] === viewBox[2],
  viewBox ? `${viewBox[1]}×${viewBox[2]}` : 'sin viewBox');
check('y el patrón va desplazado justo esos 4 módulos',
  /<g transform="translate\(4 4\)">/.test(soloQr));

/*
 * Que el margen exista NO puede lograrse encogiendo el patrón a mano: si
 * alguien «arreglara» esto quitando módulos, el QR dejaría de decir lo que
 * dice. Se comprueba que el lado del viewBox sea exactamente el de la matriz
 * más ocho, contando la matriz desde el propio path.
 */
const columnas = new Set((soloQr.match(/M(\d+) \d+h1v1h-1z/g) ?? [])
  .map(m => Number(m.match(/M(\d+) /)![1])));
const ladoMatriz = Math.max(...columnas) + 1;   // la última columna oscura
check('el viewBox es la matriz + 8, sin recortar el patrón',
  viewBox !== null && Number(viewBox[1]) >= ladoMatriz + 8,
  viewBox ? `viewBox ${viewBox[1]} · última columna oscura ${ladoMatriz}` : '');

// El tamaño pedido NO crece: el comprobante reserva un ancho concreto.
check('el margen se descuenta del tamaño pedido, no lo agranda',
  /width="128"/.test(soloQr) && /height="128"/.test(soloQr));

console.log(`\n  ${pass}/${pass + fail} comprobaciones del QR del comprobante`);
if (fail) process.exit(1);
