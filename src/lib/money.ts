/**
 * Manejo de importes en centavos.
 *
 * La aplicación auditada guardaba el dinero como `number` de JavaScript (coma
 * flotante binaria) y redondeaba el ITBIS a pesos enteros con Math.round().
 * Sobre miles de transacciones eso produce una deriva imposible de reconciliar
 * contra el conteo físico de efectivo (§5.5 de la auditoría).
 *
 * A partir de aquí, TODO importe que cruce la frontera con la base de datos es
 * un entero de centavos. Los pesos solo existen en el borde de la interfaz:
 * al pintar un número y al leer lo que teclea el cajero.
 */

/** Céntimos por unidad monetaria. */
const MINOR_UNITS = 100;

/**
 * Convierte lo que escribe una persona ("1500", "1.500,50", "1500.50") a
 * centavos. Devuelve null si no es un importe válido: nunca NaN, que es lo que
 * acababa propagándose hasta localStorage en la versión anterior.
 */
export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Se admiten ambas convenciones. Si hay coma y punto, el último separador
  // que aparece es el decimal.
  const lastComma = trimmed.lastIndexOf(',');
  const lastDot = trimmed.lastIndexOf('.');
  const decimalSep = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : '';

  let normalized = trimmed;
  if (decimalSep) {
    const other = decimalSep === ',' ? '.' : ',';
    normalized = trimmed.split(other).join('');
    normalized = normalized.replace(decimalSep, '.');
  }
  normalized = normalized.replace(/\s/g, '');

  if (!/^-?\d*\.?\d*$/.test(normalized) || normalized === '' || normalized === '-') return null;

  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) return null;

  // Se redondea al centavo más próximo en lugar de truncar.
  return Math.round(asNumber * MINOR_UNITS);
}

/** Formatea centavos para mostrar. Locale explícito: sin él, cada dispositivo pintaba distinto. */
export function formatCents(
  cents: number,
  symbol: string = 'RD$',
  locale: string = 'es-DO'
): string {
  const value = cents / MINOR_UNITS;
  return `${symbol} ${value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/** Solo el número, sin símbolo. Para campos de entrada. */
export function centsToInput(cents: number): string {
  return (cents / MINOR_UNITS).toFixed(2);
}

/** Para los pocos sitios donde todavía hay un importe en pesos. */
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * MINOR_UNITS);
}

/**
 * ITBIS sobre una base imponible, en centavos.
 *
 * Réplica exacta de app.recalc_work_order_totals() y de create_invoice(): la
 * interfaz solo PREVISUALIZA; el importe que vale es el que calcula la base de
 * datos. Si ambos divergen, manda el servidor.
 */
export function taxFromBps(taxableCents: number, taxRateBps: number): number {
  return Math.round((taxableCents * taxRateBps) / 10000);
}

/** Puntos base a porcentaje legible: 1800 -> "18%". */
export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
