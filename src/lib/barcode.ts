/**
 * EAN-13: del número a las barras.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EAN-13 Y NO OTRO
 *
 * Es el código que lee CUALQUIER lector de supermercado sin configurarlo, y el
 * que la gente reconoce como «un código de barras». Lleva dígito verificador,
 * así que un escaneo mal leído se detecta en vez de vender otro producto.
 *
 * Los códigos que genera este sistema empiezan por 2: el rango que GS1 reserva
 * para USO INTERNO de un comercio. Eso es deliberado y es lo correcto — un
 * EAN-13 inventado con otro prefijo podría chocar con el de un producto real de
 * otro fabricante, y entonces el lector diría que una fragancia es un yogur.
 * Con el 2 nadie más los emite, así que no colisionan con nada del mundo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE ESTE MÓDULO Y QUÉ NO
 *
 * Es PURO: número → patrón de barras. No dibuja, no consulta y no genera
 * códigos nuevos (eso lo hace la base de datos, que es la única que puede
 * garantizar que no se repitan). Aquí solo se traduce, para poder probarlo sin
 * navegador.
 */

/** Codificación de la mitad izquierda, paridad impar (L). */
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** Codificación de la mitad izquierda, paridad par (G). */
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/** Codificación de la mitad derecha (R): el complemento de L. */
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/**
 * El primer dígito no se dibuja: se CODIFICA en el patrón de paridades de los
 * seis siguientes. Por eso un EAN-13 cabe en el mismo ancho que un EAN-12.
 */
const PARIDAD = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

const soloDigitos = (s: string) => s.replace(/\D/g, '');

/**
 * Dígito verificador de un EAN-13, a partir de sus 12 primeros dígitos.
 *
 * Pesos alternos 1 y 3 de izquierda a derecha; el verificador es lo que falta
 * para llegar a la siguiente decena. Es el mismo cálculo que hace el lector: si
 * no cuadra, descarta la lectura en vez de devolver un número equivocado.
 */
export function digitoVerificadorEan13(doceDigitos: string): number {
  const d = soloDigitos(doceDigitos);
  if (d.length !== 12) throw new Error('Se necesitan 12 dígitos para calcular el verificador.');
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (suma % 10)) % 10;
}

/** ¿Es un EAN-13 bien formado y con el verificador correcto? */
export function esEan13Valido(codigo: string): boolean {
  const d = soloDigitos(codigo);
  if (d.length !== 13) return false;
  return digitoVerificadorEan13(d.slice(0, 12)) === Number(d[12]);
}

/**
 * Los 95 módulos (barra=1, espacio=0) de un EAN-13.
 *
 *   guarda(101) · 6 dígitos × 7 · central(01010) · 6 dígitos × 7 · guarda(101)
 *
 * Lanza si el código no es válido: dibujar barras a partir de un número con el
 * verificador mal es imprimir una etiqueta que ningún lector aceptará, y es
 * mejor enterarse aquí que en la góndola.
 */
export function modulosEan13(codigo: string): string {
  const d = soloDigitos(codigo);
  if (!esEan13Valido(d)) throw new Error(`«${codigo}» no es un EAN-13 válido.`);

  const paridad = PARIDAD[Number(d[0])];
  let out = '101';
  for (let i = 0; i < 6; i++) {
    const n = Number(d[1 + i]);
    out += paridad[i] === 'L' ? L[n] : G[n];
  }
  out += '01010';
  for (let i = 0; i < 6; i++) {
    out += R[Number(d[7 + i])];
  }
  return out + '101';
}

/**
 * Los tres grupos en que se imprime el número bajo las barras: el dígito
 * suelto a la izquierda, y los dos bloques de seis. Es como se lee un EAN-13 en
 * cualquier producto, y ponerlo de otra forma delata una etiqueta casera.
 */
export function gruposLegibles(codigo: string): [string, string, string] {
  const d = soloDigitos(codigo);
  return [d.slice(0, 1), d.slice(1, 7), d.slice(7, 13)];
}
