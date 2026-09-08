import React from 'react';
import { PAPER_COLS, type ReceiptDoc, type ReceiptLine } from '../../lib/comprobante/tipos';
import { QrCode } from './QrCode';

/**
 * Pinta un `ReceiptDoc` — el documento por bloques que arma el constructor
 * portado de MembeGo — sobre papel de 58 u 80 mm.
 *
 * El documento no sabe de HTML ni de impresoras: es una lista de líneas con su
 * tipo (texto, par etiqueta/valor, separador, QR, logo, avance). Aquí solo se
 * traduce cada tipo a su marca. Esa separación es lo que permite que el MISMO
 * documento salga idéntico en pantalla y en la térmica.
 *
 * El separador se repite por COLUMNAS del papel, no por un ancho fijo en
 * píxeles: 32 en 58 mm y 48 en 80 mm. Con una raya de largo fijo, el ticket
 * angosto sale con la línea desbordada y el ancho con la línea corta.
 */
export const TicketComprobante: React.FC<{
  doc: ReceiptDoc;
  logoUrl?: string | null;
}> = ({ doc, logoUrl }) => {
  const cols = PAPER_COLS[doc.paperWidthMm];
  const alineacion = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

  const linea = (l: ReceiptLine, i: number) => {
    switch (l.kind) {
      case 'text':
        return (
          <div key={i}
            className={`${alineacion[l.align ?? 'left']} ${l.bold ? 'font-bold' : ''} break-words`}
            style={l.size === 'double' ? { fontSize: '1.45em' } : undefined}>
            {l.text}
          </div>
        );
      case 'pair':
        return (
          <div key={i} className="flex justify-between gap-2">
            <span className="shrink-0">{l.label}:</span>
            <span className={`text-right break-all ${l.boldValue ? 'font-bold' : ''}`}>{l.value}</span>
          </div>
        );
      case 'separator':
        return (
          <div key={i} className="overflow-hidden whitespace-nowrap" style={{ letterSpacing: '0.5px' }}>
            {(l.char ?? '-').repeat(cols)}
          </div>
        );
      case 'qr':
        return (
          <div key={i} className="my-1 text-center">
            <QrCode value={l.data} size={doc.paperWidthMm === 58 ? 104 : 128} />
            {l.caption && <div className="text-[0.85em]">{l.caption}</div>}
          </div>
        );
      case 'logo':
        return logoUrl ? (
          <div key={i} className="mb-1 text-center">
            <img src={logoUrl} alt="" className="mx-auto max-h-14 object-contain grayscale" />
          </div>
        ) : null;
      case 'feed':
        return <div key={i} style={{ height: `${(l.lines ?? 1) * 0.9}em` }} />;
      default:
        return null;
    }
  };

  return <>{doc.lines.map(linea)}</>;
};
