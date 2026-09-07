import { useEffect, useRef } from 'react';
import {
  ESTADO_INICIAL, codigoPorInactividad, procesarTecla,
  type EstadoLector, type OpcionesLector
} from '../lib/lectorCodigoBarras';

/**
 * Escucha el lector de código de barras en toda la pantalla.
 *
 * La decisión —qué es una ráfaga del lector y qué es el cajero tecleando— vive
 * en `lectorCodigoBarras`, que es puro y está probado. Aquí solo se le pasan
 * las teclas del documento y un reloj.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE ESCUCHA, Y DÓNDE NO
 *
 * El oyente es global a propósito: el cajero escanea sin tener que acordarse de
 * pinchar antes en ningún sitio, que es justo lo que no va a hacer con el carro
 * esperando fuera.
 *
 * Pero se calla cuando el foco está en un campo de texto. Si no, escanear
 * mientras se escribe el nombre del cliente le metería trece dígitos en medio
 * del nombre, y peor: el Enter final enviaría el formulario. La excepción es el
 * buscador del catálogo (`data-escaneable`), donde escanear SÍ es lo esperado;
 * allí se deja pasar y el POS limpia la caja al acertar.
 */
export function useLectorCodigoBarras(
  onScan: (codigo: string) => void,
  opciones: OpcionesLector & { activo?: boolean } = {}
) {
  // El callback en una ref: así el oyente se registra UNA vez y no se
  // desengancha en cada render, que es cuando se pierden escaneos.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const estadoRef = useRef<EstadoLector>(ESTADO_INICIAL);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { activo = true, pausaMaxMs, minLongitud } = opciones;

  useEffect(() => {
    if (!activo) return;

    const cancelarInactividad = () => {
      if (temporizadorRef.current) {
        clearTimeout(temporizadorRef.current);
        temporizadorRef.current = null;
      }
    };

    const emitir = (codigo: string) => {
      estadoRef.current = ESTADO_INICIAL;
      cancelarInactividad();
      onScanRef.current(codigo);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Un atajo del sistema no es un escaneo.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const destino = e.target as HTMLElement | null;
      const editable =
        destino instanceof HTMLInputElement ||
        destino instanceof HTMLTextAreaElement ||
        destino instanceof HTMLSelectElement ||
        destino?.isContentEditable === true;
      // El buscador del catálogo es el único campo donde escanear tiene
      // sentido; el resto (nombre, teléfono, importes) queda intocable.
      const esCampoDeEscaneo = destino?.hasAttribute('data-escaneable') === true;
      if (editable && !esCampoDeEscaneo) return;

      const ahora = Date.now();
      const r = procesarTecla(estadoRef.current, e.key, ahora, { pausaMaxMs, minLongitud });
      estadoRef.current = r.estado;

      if (r.codigo) {
        // El Enter del lector no debe además enviar el formulario que haya
        // debajo: la ráfaga se consume entera.
        if (r.consumir) e.preventDefault();
        emitir(r.codigo);
        return;
      }

      // Respaldo para los lectores que salen de fábrica sin sufijo: si la
      // ráfaga se queda callada, se da por terminada.
      cancelarInactividad();
      const capturado = estadoRef.current;
      temporizadorRef.current = setTimeout(() => {
        const codigo = codigoPorInactividad(capturado, Date.now(), { pausaMaxMs, minLongitud });
        if (codigo && estadoRef.current.buffer === capturado.buffer) emitir(codigo);
      }, (pausaMaxMs ?? 120) + 60);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cancelarInactividad();
    };
  }, [activo, pausaMaxMs, minLongitud]);
}
