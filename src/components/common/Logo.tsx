import React, { useId } from 'react';

/**
 * Marca de MembeGo Car Wash.
 *
 * Va en SVG y no como imagen: el símbolo aparece a 36 píxeles en la barra y a
 * 80 en la pantalla de acceso, y un PNG que se ve bien en uno se ve mal en el
 * otro. Además no pesa en la descarga y se puede pintar de un solo color para
 * el ticket.
 *
 * Dos versiones del símbolo, y la diferencia importa:
 *
 *   · Completa — M, carro, agua, brillos y gotas. Para cuando la marca se
 *     mira: la pantalla de acceso.
 *   · `simple` — solo la M y el carro, recortado para llenar la caja. Por
 *     debajo de unos 40 píxeles el agua y los brillos dejan de leerse y se
 *     convierten en suciedad alrededor del logotipo; a ese tamaño lo que hace
 *     falta es que se reconozca de un vistazo, no el detalle.
 */

// Los colores de la marca. NO salen de los tokens del tema a propósito: un
// logotipo que cambia de color con el modo noche deja de ser un logotipo.
const MORADO = '#7C3AED';
const AZUL   = '#2563EB';
const CIAN   = '#22B8D4';
const VERDE  = '#14C79A';
const NAVY   = '#16204A';

interface MarkProps {
  className?: string;
  /** Sin agua ni brillos, y recortado. Para 40 píxeles o menos. */
  simple?: boolean;
  /** Todo en el color del texto. Para la térmica, que no tiene tinta de color. */
  mono?: boolean;
  /** Si se pasa, el símbolo se anuncia con ese nombre; si no, es decorativo. */
  title?: string;
}

export const LogoMark: React.FC<MarkProps> = ({
  className = 'w-9 h-9', simple = false, mono = false, title
}) => {
  const uid = useId();
  const gradId = `mg-${uid}`;
  const aguaId = `mg-agua-${uid}`;
  const trazo = mono ? 'currentColor' : `url(#${gradId})`;
  const agua = mono ? 'currentColor' : `url(#${aguaId})`;

  return (
    <svg
      viewBox={simple ? '14 16 72 62' : '0 0 100 100'}
      className={className}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {!mono && (
        <defs>
          <linearGradient id={gradId} x1="20" y1="18" x2="82" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={MORADO} />
            <stop offset="45%" stopColor={AZUL} />
            <stop offset="100%" stopColor={VERDE} />
          </linearGradient>
          <linearGradient id={aguaId} x1="8" y1="80" x2="92" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={MORADO} />
            <stop offset="50%" stopColor={AZUL} />
            <stop offset="100%" stopColor={VERDE} />
          </linearGradient>
        </defs>
      )}

      {/* La M. Puntas redondeadas: a tamaño pequeño las esquinas vivas se ven
          sucias contra el fondo. */}
      <path d="M24 56V24l26 21 26-21v32"
        stroke={trazo} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />

      {/* El carro, debajo de la M y sin tocarla. Va en trazo y no en relleno
          para que se lea igual sobre fondo claro y oscuro. */}
      <path d="M31 73v-3.2c0-1.5.5-2.9 1.5-4l5-5.6c1.3-1.5 3.2-2.4 5.2-2.4h14.6c2 0 3.9.9 5.2 2.4l5 5.6c1 1.1 1.5 2.5 1.5 4V73"
        stroke={trazo} strokeWidth={simple ? 4 : 3.4} strokeLinecap="round" strokeLinejoin="round" />

      {!simple && (
        <>
          <path d="M37 61.5l2 7h22l2-7"
            stroke={trazo} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />

          {/* El agua, cruzando por debajo del carro. */}
          <path d="M8 82c9-6.5 18.5-8.5 28-6.5" stroke={agua} strokeWidth="3.6" strokeLinecap="round" />
          <path d="M92 82c-9-6.5-18.5-8.5-28-6.5" stroke={agua} strokeWidth="3.6" strokeLinecap="round" />
          <path d="M17 89c11-4.5 22-5.5 33-3.5" stroke={agua} strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />

          {/* Brillos y gotas: lo que dice «limpio» sin escribirlo. */}
          <path d="M84 26l1.7 4.6 4.6 1.7-4.6 1.7L84 38.6l-1.7-4.6-4.6-1.7 4.6-1.7z"
            fill={mono ? 'currentColor' : VERDE} />
          <path d="M92 41l1 2.7 2.7 1-2.7 1-1 2.7-1-2.7-2.7-1 2.7-1z"
            fill={mono ? 'currentColor' : CIAN} />
          <circle cx="11" cy="62" r="3" fill={mono ? 'currentColor' : MORADO} />
          <circle cx="88" cy="62" r="3.4" fill={mono ? 'currentColor' : VERDE} />
          <circle cx="17" cy="70" r="2" fill={mono ? 'currentColor' : AZUL} opacity="0.8" />
        </>
      )}
    </svg>
  );
};

/**
 * El nombre escrito: «Membe» oscuro y «Go» en verde.
 *
 * Se compone con texto y no con contornos para que se pueda seleccionar, se
 * lea con lector de pantalla y respete el tamaño de fuente del sistema.
 */
export const LogoWordmark: React.FC<{ className?: string }> = ({ className = 'text-2xl' }) => (
  <span className={`font-black tracking-tight leading-none ${className}`}>
    {/* En modo noche el azul marino desaparece contra el fondo: allí va blanco.
        El verde de «Go» funciona en los dos, y es el que carga la marca. */}
    <span style={{ color: NAVY }} className="dark:text-white">Membe</span>
    <span style={{ color: VERDE }}>Go</span>
  </span>
);

/**
 * El conjunto completo, con el lema.
 *
 * Solo para la pantalla de acceso: es el único sitio donde la marca ES el
 * contenido, porque todavía no hay nada que hacer más que reconocer dónde se
 * está entrando. En el resto de la aplicación basta el símbolo.
 */
export const LogoLockup: React.FC<{ className?: string; conLema?: boolean }> = ({
  className = '', conLema = true
}) => (
  <div className={`flex flex-col items-center gap-2 ${className}`}>
    <LogoMark className="w-32 h-32" title="MembeGo Car Wash" />
    <div className="text-center space-y-0.5">
      <LogoWordmark className="text-3xl" />
      <div className="text-sm font-bold tracking-wide" style={{ color: AZUL }}>Car Wash</div>
      {conLema && (
        <p className="text-xs text-muted pt-2">
          Conecta<span style={{ color: MORADO }}>.</span>{' '}
          Lava<span style={{ color: AZUL }}>.</span>{' '}
          Ahorra<span style={{ color: VERDE }}>.</span>
        </p>
      )}
    </div>
  </div>
);
