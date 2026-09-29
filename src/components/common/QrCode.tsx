import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Código QR como SVG.
 *
 * Se dibuja en SVG, no en <canvas> ni como imagen rasterizada, porque el
 * comprobante se imprime: un SVG sale nítido a cualquier tamaño —58 mm o una
 * hoja Carta— y la impresora térmica no lo difumina. Los módulos oscuros se
 * juntan en un solo <path> para que el navegador pinte una figura, no cientos
 * de rectángulos.
 *
 * La corrección de errores es 'M': suficiente para un comprobante que no va a
 * ensuciarse, y deja el patrón menos denso (más fácil de leer con la cámara).
 */

/**
 * Margen blanco alrededor del patrón, en módulos.
 *
 * La norma del QR pide cuatro: es lo que permite al lector encontrar dónde
 * empieza el código. Sin ella el patrón llegaba al filo del SVG y el pie de
 * texto del comprobante quedaba pegado al borde de abajo —comprobado: cero
 * píxeles entre uno y otro—, que es justo lo que hace que una cámara falle
 * sobre papel térmico.
 *
 * El margen se descuenta del tamaño pedido en vez de agrandar el SVG: el
 * comprobante reserva un ancho concreto y crecer por fuera lo desbordaría.
 */
const ZONA_SILENCIO = 4;
export const QrCode: React.FC<{ value: string; size?: number; className?: string }> = ({
  value, size = 96, className
}) => {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    // Un comando de path por módulo oscuro: "M{col} {row} h1 v1 h-1 z".
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);

  // `shape-rendering: crispEdges` evita el antialias que borronea los módulos.
  const lado = count + ZONA_SILENCIO * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${lado} ${lado}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Código QR de la operación"
    >
      <rect width={lado} height={lado} fill="#fff" />
      <g transform={`translate(${ZONA_SILENCIO} ${ZONA_SILENCIO})`}>
        <path d={path} fill="#000" />
      </g>
    </svg>
  );
};
