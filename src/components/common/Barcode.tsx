import React from 'react';
import { modulosEan13, gruposLegibles, esEan13Valido } from '../../lib/barcode';

/**
 * El código de barras de un producto, dibujado como SVG.
 *
 * SVG y no imagen: una etiqueta se imprime, y un PNG a 96 ppp sale con las
 * barras borrosas y el lector falla. El vector se imprime a la resolución de la
 * impresora, que es lo que hace que el escaneo funcione a la primera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN CÓDIGO QUE NO ES EAN-13 SE ENSEÑA IGUAL
 *
 * Si el producto trae el código del envase, puede ser un UPC de 12 dígitos o
 * cualquier otra cosa. Aquí NO se dibuja a la fuerza —dibujar barras a partir de
 * algo que no cumple el formato produce una etiqueta que ningún lector acepta—
 * sino que se enseña el número y se avisa. Es preferible una etiqueta que dice
 * la verdad a una que parece buena y no pita en caja.
 */

interface Props {
  value: string | null | undefined;
  /** Alto de las barras, en módulos (el ancho de la barra más fina). */
  alto?: number;
  /** Oculta el número bajo las barras. */
  sinTexto?: boolean;
  className?: string;
}

/** Zonas mudas: sin ellas el lector no encuentra dónde empieza el código. */
const MUDA_IZQ = 11;
const MUDA_DER = 7;
const MODULOS = 95;
const ANCHO = MUDA_IZQ + MODULOS + MUDA_DER;

/** Las guardas bajan más que el resto: es como se reconoce un EAN a simple vista. */
const GUARDAS: [number, number][] = [[0, 3], [45, 50], [92, 95]];
const esGuarda = (i: number) => GUARDAS.some(([a, b]) => i >= a && i < b);

export const Barcode: React.FC<Props> = ({ value, alto = 60, sinTexto = false, className }) => {
  const codigo = (value ?? '').trim();

  if (!codigo) {
    return <span className={`text-xs text-faint ${className ?? ''}`}>Sin código de barras</span>;
  }

  if (!esEan13Valido(codigo)) {
    // No es EAN-13: se enseña el número tal cual, sin inventar barras.
    return (
      <span className={`font-mono text-xs tracking-wider ${className ?? ''}`} title="No es un EAN-13: no se puede dibujar">
        {codigo}
      </span>
    );
  }

  const modulos = modulosEan13(codigo);
  const [primero, izquierda, derecha] = gruposLegibles(codigo);
  const sobresale = 5;              // cuánto bajan las guardas
  const altoTexto = sinTexto ? 0 : 10;
  const altoTotal = alto + sobresale + altoTexto;

  const barras: React.ReactElement[] = [];
  for (let i = 0; i < modulos.length; i++) {
    if (modulos[i] !== '1') continue;
    barras.push(
      <rect
        key={i}
        x={MUDA_IZQ + i}
        y={0}
        width={1}
        height={alto + (esGuarda(i) ? sobresale : 0)}
        fill="currentColor"
      />
    );
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${ANCHO} ${altoTotal}`}
      role="img"
      aria-label={`Código de barras ${codigo}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {/* Fondo blanco explícito: las zonas mudas tienen que ser blancas de
          verdad, también sobre una tarjeta de color. */}
      <rect x={0} y={0} width={ANCHO} height={altoTotal} fill="#fff" />
      {barras}

      {!sinTexto && (
        <g fill="currentColor" style={{ font: `bold ${altoTexto - 1}px ui-monospace, monospace` }}>
          {/* El primer dígito va FUERA de las barras, en la zona muda izquierda:
              no tiene barras propias, viaja en la paridad de las seis siguientes. */}
          <text x={0} y={altoTotal - 1} textAnchor="start">{primero}</text>
          <text x={MUDA_IZQ + 24} y={altoTotal - 1} textAnchor="middle">{izquierda}</text>
          <text x={MUDA_IZQ + 71} y={altoTotal - 1} textAnchor="middle">{derecha}</text>
        </g>
      )}
    </svg>
  );
};
