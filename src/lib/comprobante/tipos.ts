/**
 * Receipt Engine (Fase E4) — tipos de dominio.
 *
 * Un comprobante es un DOCUMENTO por bloques, independiente del medio de
 * salida: la misma estructura se imprime en térmica (ESC/POS 58/80 mm), se
 * muestra en pantalla, y en el futuro se exporta a PDF/email/WhatsApp. La
 * personalización por empresa vive en `ReceiptTemplateConfig` (datos, nunca
 * código): logo, encabezado, pie, orden de bloques y campos opcionales.
 */

// ── Documento ────────────────────────────────────────────────────────────────

export type ReceiptAlign = 'left' | 'center' | 'right'

export type ReceiptLine =
  | { kind: 'text'; text: string; align?: ReceiptAlign; bold?: boolean; size?: 'normal' | 'double' }
  | { kind: 'pair'; label: string; value: string; boldValue?: boolean }
  | { kind: 'separator'; char?: '-' | '=' | '*' }
  | { kind: 'qr'; data: string; caption?: string }
  | { kind: 'logo' }
  | { kind: 'feed'; lines?: number }

export interface ReceiptDoc {
  /** Ancho de papel en mm (58 u 80): determina columnas por línea. */
  paperWidthMm: 58 | 80
  lines: ReceiptLine[]
}

/** Columnas de texto típicas por ancho de papel (fuente A estándar). */
export const PAPER_COLS: Record<58 | 80, number> = { 58: 32, 80: 48 }

// ── Plantilla por empresa ────────────────────────────────────────────────────

export type ReceiptBlockId =
  | 'encabezado'
  | 'cliente'
  | 'servicio'
  | 'qr'
  | 'pie'

export const DEFAULT_BLOCK_ORDER: readonly ReceiptBlockId[] = [
  'encabezado',
  'cliente',
  'servicio',
  'qr',
  'pie',
]

/**
 * Configuración editable por empresa (persistida en receipt_templates.config).
 * Todo opcional: lo no definido usa DEFAULT_RECEIPT_TEMPLATE.
 */
export interface ReceiptTemplateConfig {
  /** 58 u 80 mm según la impresora configurada por la empresa. */
  paperWidthMm?: 58 | 80
  /** Orden de los bloques del ticket. */
  blockOrder?: ReceiptBlockId[]
  /** Encabezado */
  mostrarLogo?: boolean
  /** RNC u otro identificador fiscal (opcional). */
  rnc?: string
  lineasEncabezado?: string[]
  /** Campos opcionales del cuerpo */
  mostrarVehiculo?: boolean
  mostrarPuntos?: boolean
  mostrarNivel?: boolean
  mostrarPromocion?: boolean
  mostrarBeneficio?: boolean
  mostrarTotales?: boolean
  /** QR de la transacción (consulta del historial de la operación). */
  mostrarQr?: boolean
  /** Pie */
  mensajePie?: string
  web?: string
  redes?: string
  politicas?: string
  proximaVisita?: string
  mostrarPromosActivas?: boolean
}

export interface ReceiptEmpresaInfo {
  nombre: string
  sucursal?: string | null
  direccion?: string | null
  telefono?: string | null
  web?: string | null
  logoUrl?: string | null
}

/** Datos de la transacción que el builder congela en el ticket. */
export interface ReceiptTransaccionInfo {
  codigo: string
  ticketNumero: string
  fecha: Date
  caja?: string | null
  empleado?: string | null
  cliente?: string | null
  vehiculo?: string | null
  placa?: string | null
  membresia?: string | null
  plan?: string | null
  nivel?: string | null
  puntos?: number | null
  servicio?: string | null
  /**
   * ÚNICA diferencia deliberada con el ticket de MembeGo.
   *
   * Allá un comprobante registra el consumo de UN beneficio, así que basta con
   * `servicio`. Aquí es una FACTURA FISCAL con NCF: la DGII exige el detalle
   * línea por línea con su importe, y resumirlo en un renglón para que se
   * parezca más al original sería un comprobante mal emitido. Cuando viene,
   * se imprime dentro del mismo bloque SERVICIO, antes de los totales.
   */
  lineas?: { texto: string; importe: string }[]
  promocion?: string | null
  beneficio?: string | null
  descuento?: string | null
  subtotal?: string | null
  /**
   * El ITBIS con su tasa, entre el subtotal y el total. En MembeGo no existe
   * porque allá el comprobante registra el consumo de un beneficio, no una
   * venta; aquí es una factura fiscal y el impuesto desglosado es obligatorio.
   * La tasa viene ya calculada de la propia factura, no de la empresa de hoy.
   */
  impuesto?: { etiqueta: string; importe: string } | null
  total?: string | null
  /** Vuelto entregado. Se imprime tras el total, y solo cuando lo hubo. */
  cambio?: string | null
  restantes?: number | 'ilimitado' | null
  observaciones?: string | null
  promosActivas?: string[]
  /** Recibo de pago (G6): forma de pago legible y su referencia/banco. */
  metodoPago?: string | null
  referenciaPago?: string | null
}

export interface BuildReceiptInput {
  empresa: ReceiptEmpresaInfo
  transaccion: ReceiptTransaccionInfo
  template?: ReceiptTemplateConfig | null
  /** true = reimpresión: banner COPIA + número de copia. */
  esCopia?: boolean
  copiaNumero?: number
  /** true = comprobante de entrega (regalo/beneficio sin valor comercial). */
  esEntrega?: boolean
  timeZone?: string
}
