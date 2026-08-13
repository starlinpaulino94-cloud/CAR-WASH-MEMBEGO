/**
 * CSV: leerlo y escribirlo bien.
 *
 * Un archivo de datos reales no es una lista de valores separados por comas. Es
 * un campo con una coma dentro, un nombre con comillas, un salto de línea en la
 * dirección, y un archivo que Excel guardó con punto y coma porque la
 * configuración regional era española. Todo eso llega, y si se parte por
 * `split(',')` los datos entran corridos una columna.
 *
 * Aquí se implementa RFC 4180 de verdad, con dos concesiones al mundo real:
 * se detecta el separador en vez de asumirlo, y se escribe con BOM para que
 * Excel abra los acentos sin destrozarlos.
 */

/** Marca de orden de bytes. Sin esto Excel lee «Martínez» como «MartÃ­nez». */
const BOM = '﻿';

export interface CsvColumn<T> {
  /** Encabezado tal como se ve en el archivo. */
  header: string;
  /** Valor de la celda. Devuelve '' para vacío, nunca null ni undefined. */
  value: (row: T) => string;
}

/**
 * Escribe un CSV. Se entrecomilla solo lo que lo necesita —separador, comillas
 * o salto de línea dentro del valor—, y las comillas internas se duplican, que
 * es como manda el estándar y como lo espera Excel.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[], separator = ','): string {
  const cell = (raw: string): string => {
    const v = raw ?? '';
    return /["\n\r]|,|;|\t/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [columns.map(c => cell(c.header)).join(separator)];
  for (const row of rows) {
    lines.push(columns.map(c => cell(c.value(row) ?? '')).join(separator));
  }
  // CRLF: es lo que pide el RFC y lo único que Excel para Windows respeta.
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Dispara la descarga en el navegador. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Sin esto el blob queda retenido en memoria hasta recargar la página.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Nombre de archivo con la fecha, para que no se pisen entre descargas. */
export function stampedName(base: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * Detecta el separador contando cuántos hay fuera de comillas en la primera
 * línea. Gana el más frecuente. Sin esto, un archivo con punto y coma se lee
 * como una sola columna gigante y el usuario no entiende por qué.
 */
function detectSeparator(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const sep of candidates) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === sep && !inQuotes) count++;
    }
    if (count > bestCount) { best = sep; bestCount = count; }
  }
  return best;
}

/**
 * Lee un CSV a matriz de cadenas. Máquina de estados carácter a carácter: es la
 * única forma de que un valor entrecomillado con saltos de línea dentro no
 * parta la fila en dos.
 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  if (!clean.trim()) return [];
  const sep = detectSeparator(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    // Una línea en blanco no es una fila: no se cuela como registro vacío.
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };

  while (i < clean.length) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        // Comilla doble dentro de comillas: es una comilla literal.
        if (clean[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === sep) { endField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Matriz a objetos, usando la primera fila como encabezados.
 *
 * Los encabezados se normalizan —minúsculas, sin acentos, sin espacios— porque
 * el archivo que exporta otro sistema trae «Teléfono», «TELEFONO» o «Telefono»
 * y las tres son la misma columna. El servidor recibe estas claves ya limpias.
 */
export function csvToObjects(matrix: string[][]): Record<string, string>[] {
  if (matrix.length < 2) return [];
  const headers = matrix[0].map(normalizeHeader);
  const out: Record<string, string>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const obj: Record<string, string> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      const v = (matrix[r][c] ?? '').trim();
      obj[headers[c]] = v;
      if (v !== '') hasValue = true;
    }
    // Fila completamente vacía: la deja fuera en vez de mandarla a fallar.
    if (hasValue) out.push(obj);
  }
  return out;
}

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita acentos
    .trim().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}
