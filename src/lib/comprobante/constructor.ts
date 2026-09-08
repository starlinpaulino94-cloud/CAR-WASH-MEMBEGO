/**
 * EL CONSTRUCTOR DEL COMPROBANTE — copia literal del motor de MembeGo.
 *
 * Este archivo NO se escribió aquí: es el mismo `buildReceiptDoc` que imprime
 * MembeGo, traído tal cual. Y es a propósito. El encargo era que el ticket del
 * car wash fuera EXACTAMENTE el de MembeGo, y un formato «equivalente» escrito
 * a mano empieza igual y se separa a la tercera semana: cambia un separador
 * allá, se añade un campo acá, y un día los dos comprobantes de la misma
 * empresa no se parecen.
 *
 * Al ser puro —datos entran, documento sale— copiarlo es barato y verificable:
 * mismos bloques, mismo orden, mismos rótulos. Lo que cambia entre los dos
 * sistemas son los DATOS que se le pasan, no la forma.
 *
 * Si algún día MembeGo cambia su ticket, este archivo se vuelve a copiar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Builder del comprobante (Receipt Engine, Fase E4). PURO: datos → ReceiptDoc.
 * La plantilla de la empresa decide bloques, orden y campos; el builder no
 * conoce industria ni impresora. El QR impreso codifica el Transaction ID
 * (TX-…): escanearlo en el panel consulta el historial de esa operación
 * (nunca se reutiliza el QR de autenticación del cliente).
 */

import {
  DEFAULT_BLOCK_ORDER,
  type BuildReceiptInput,
  type ReceiptBlockId,
  type ReceiptDoc,
  type ReceiptLine,
  type ReceiptTemplateConfig,
} from './tipos'

export const DEFAULT_RECEIPT_TEMPLATE: Required<
  Pick<
    ReceiptTemplateConfig,
    | 'paperWidthMm'
    | 'mostrarLogo'
    | 'mostrarVehiculo'
    | 'mostrarPuntos'
    | 'mostrarNivel'
    | 'mostrarPromocion'
    | 'mostrarBeneficio'
    | 'mostrarTotales'
    | 'mostrarQr'
    | 'mostrarPromosActivas'
  >
> & { blockOrder: ReceiptBlockId[]; mensajePie: string } = {
  paperWidthMm: 80,
  blockOrder: [...DEFAULT_BLOCK_ORDER],
  mostrarLogo: true,
  mostrarVehiculo: true,
  mostrarPuntos: true,
  mostrarNivel: true,
  mostrarPromocion: true,
  mostrarBeneficio: true,
  mostrarTotales: true,
  mostrarQr: true,
  mostrarPromosActivas: true,
  mensajePie: '¡Gracias por tu preferencia!',
}

function fmtFecha(d: Date, timeZone = 'America/Santo_Domingo') {
  return {
    fecha: new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium' }).format(d),
    hora: new Intl.DateTimeFormat('es-DO', { timeZone, timeStyle: 'short' }).format(d),
  }
}

export function construirComprobante(input: BuildReceiptInput): ReceiptDoc {
  const t = { ...DEFAULT_RECEIPT_TEMPLATE, ...(input.template ?? {}) }
  const { empresa, transaccion: tx } = input
  const { fecha, hora } = fmtFecha(tx.fecha, input.timeZone)
  const lines: ReceiptLine[] = []

  const push = (l: ReceiptLine | null | undefined) => l && lines.push(l)
  const pair = (label: string, value: string | null | undefined, boldValue = false) => {
    if (value) push({ kind: 'pair', label, value, boldValue })
  }

  const bloques: Record<ReceiptBlockId, () => void> = {
    encabezado() {
      if (input.esCopia) {
        push({ kind: 'separator', char: '*' })
        push({ kind: 'text', text: `COPIA${input.copiaNumero ? ` #${input.copiaNumero}` : ''}`, align: 'center', bold: true, size: 'double' })
        push({ kind: 'separator', char: '*' })
      }
      // Comprobante de entrega: regalo/beneficio sin valor comercial.
      if (input.esEntrega) {
        push({ kind: 'separator', char: '*' })
        push({ kind: 'text', text: 'COMPROBANTE DE ENTREGA', align: 'center', bold: true })
        push({ kind: 'text', text: 'Sin valor comercial', align: 'center' })
        push({ kind: 'separator', char: '*' })
      }
      if (t.mostrarLogo && empresa.logoUrl) push({ kind: 'logo' })
      push({ kind: 'text', text: empresa.nombre, align: 'center', bold: true, size: 'double' })
      if (empresa.sucursal) push({ kind: 'text', text: empresa.sucursal, align: 'center' })
      if (empresa.direccion) push({ kind: 'text', text: empresa.direccion, align: 'center' })
      if (empresa.telefono) push({ kind: 'text', text: `Tel: ${empresa.telefono}`, align: 'center' })
      if (t.rnc) push({ kind: 'text', text: `RNC: ${t.rnc}`, align: 'center' })
      for (const extra of t.lineasEncabezado ?? []) {
        push({ kind: 'text', text: extra, align: 'center' })
      }
      push({ kind: 'separator' })
      pair('Fecha', fecha)
      pair('Hora', hora)
      if (tx.caja) pair('Caja', tx.caja)
      pair('Empleado', tx.empleado)
      pair('Transacción', tx.codigo, true)
      pair('Ticket', tx.ticketNumero, true)
      push({ kind: 'separator' })
    },
    cliente() {
      if (!tx.cliente && !tx.membresia) return
      push({ kind: 'text', text: 'CLIENTE', bold: true })
      pair('Nombre', tx.cliente)
      if (t.mostrarVehiculo) {
        pair('Vehículo', tx.vehiculo)
        pair('Placa', tx.placa)
      }
      pair('Membresía', tx.membresia ?? tx.plan)
      if (t.mostrarNivel) pair('Nivel', tx.nivel)
      if (t.mostrarPuntos && tx.puntos != null) pair('Puntos', String(tx.puntos))
      push({ kind: 'separator' })
    },
    servicio() {
      push({ kind: 'text', text: 'SERVICIO', bold: true })
      // El detalle de la factura fiscal (ver `lineas` en los tipos). Sin él,
      // `servicio` a secas — que es lo que imprime MembeGo.
      if (tx.lineas?.length) {
        for (const l of tx.lineas) push({ kind: 'pair', label: l.texto, value: l.importe })
      } else {
        pair('Servicio', tx.servicio, true)
      }
      if (t.mostrarPromocion) pair('Promoción', tx.promocion)
      if (t.mostrarBeneficio) pair('Beneficio', tx.beneficio)
      if (tx.restantes != null) {
        pair('Usos restantes', tx.restantes === 'ilimitado' ? 'Ilimitado' : String(tx.restantes))
      }
      if (t.mostrarTotales && (tx.descuento || tx.subtotal || tx.total)) {
        push({ kind: 'separator' })
        pair('Descuento', tx.descuento)
        pair('Subtotal', tx.subtotal)
        // Añadido fiscal (ver `impuesto` en los tipos).
        if (tx.impuesto) pair(tx.impuesto.etiqueta, tx.impuesto.importe)
        pair('TOTAL', tx.total, true)
        pair('Cambio', tx.cambio, true)
      }
      // Recibo de pago (G6): forma de pago y referencia/banco de quien validó.
      if (tx.metodoPago || tx.referenciaPago) {
        push({ kind: 'separator' })
        pair('Pago', tx.metodoPago)
        pair('Referencia', tx.referenciaPago)
      }
      if (tx.observaciones) pair('Obs.', tx.observaciones)
      push({ kind: 'separator' })
    },
    qr() {
      if (!t.mostrarQr) return
      // QR ESPECÍFICO de la transacción (codifica el TX-ID, no el QR de
      // autenticación del cliente): permite consultar esta operación.
      push({ kind: 'qr', data: tx.codigo, caption: 'Escanea para consultar esta operación' })
      push({ kind: 'separator' })
    },
    pie() {
      if (t.mensajePie) push({ kind: 'text', text: t.mensajePie, align: 'center', bold: true })
      if (t.proximaVisita) push({ kind: 'text', text: t.proximaVisita, align: 'center' })
      if (t.mostrarPromosActivas && tx.promosActivas?.length) {
        push({ kind: 'text', text: 'Promociones activas:', align: 'center' })
        for (const p of tx.promosActivas.slice(0, 3)) {
          push({ kind: 'text', text: `• ${p}`, align: 'center' })
        }
      }
      if (t.web ?? empresa.web) push({ kind: 'text', text: (t.web ?? empresa.web)!, align: 'center' })
      if (t.redes) push({ kind: 'text', text: t.redes, align: 'center' })
      if (t.politicas) push({ kind: 'text', text: t.politicas, align: 'center' })
      push({ kind: 'feed', lines: 2 })
    },
  }

  for (const id of t.blockOrder) bloques[id]?.()

  return { paperWidthMm: t.paperWidthMm, lines }
}
