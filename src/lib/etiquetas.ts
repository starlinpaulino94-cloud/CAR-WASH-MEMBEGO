/**
 * Rótulos en español de los códigos internos.
 *
 * Estaban copiados dentro de las vistas (METHOD_LABEL, CATEGORY_LABEL en el
 * reporte de ventas, y variantes en otras). Dos copias de un diccionario son
 * dos vocabularios esperando a separarse: aquí hay UNO, y las pantallas y las
 * impresiones hablan igual.
 */

export const METODO_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  pago_movil: 'Pago móvil',
  membego_beneficio: 'Beneficio Membego',
  credito: 'Crédito',
  cortesia: 'Cortesía',
  mixto: 'Mixto'
};

export const CATEGORIA_GASTO: Record<string, string> = {
  quimicos_insumos: 'Químicos e insumos',
  servicios_publicos: 'Servicios públicos',
  mantenimiento_equipos: 'Mantenimiento',
  nomina_extras: 'Nómina y extras',
  varios: 'Varios'
};

export const etiquetaMetodo = (m: string) => METODO_PAGO[m] ?? m;
export const etiquetaGasto = (c: string) => CATEGORIA_GASTO[c] ?? c;

/** Los tipos de movimiento del kardex, en español. */
export const MOVIMIENTO: Record<string, string> = {
  entrada: 'Entrada',
  compra: 'Compra',
  venta: 'Venta',
  devolucion: 'Devolución',
  consumo: 'Consumo',
  ajuste: 'Ajuste',
  merma: 'Merma',
  transferencia: 'Transferencia'
};

export const etiquetaMovimiento = (m: string) => MOVIMIENTO[m] ?? m;
