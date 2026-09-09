/**
 * Reglas del formulario de llegada que no dependen de React.
 *
 * Están fuera del componente para poder probarlas solas: son las decisiones
 * que, cuando fallan, no se notan en pantalla hasta que el cliente pregunta
 * por qué le cobraron un servicio distinto al que pidió.
 */

export interface ConId { id: string }

/**
 * Qué servicios siguen marcados cuando cambia el catálogo.
 *
 * Al cambiar la categoría —a mano o porque la placa la reconoció— se vuelve a
 * cargar la lista con los precios de esa categoría. Antes eso borraba TODO lo
 * marcado, y como la placa se resuelve unos cientos de milisegundos después de
 * escribirla, el mostrador marcaba «Lavado completo», la categoría saltaba a
 * SUV y la selección desaparecía sin aviso. Se conserva lo que sigue existiendo
 * en la lista nueva; lo que ya no tiene precio para esa categoría se suelta.
 */
export function conservarSeleccion(
  anterior: Iterable<string>,
  disponibles: readonly ConId[]
): Set<string> {
  const ids = new Set(disponibles.map(s => s.id));
  return new Set([...anterior].filter(id => ids.has(id)));
}

export interface EstadoCliente {
  /** La recepción eligió un cliente en el buscador: no se le pisa. */
  elegidoAMano: boolean;
  /** Lo que ya escribió como cliente nuevo. Si hay algo, no se propone otro. */
  nombreEscrito: string;
  telefonoEscrito: string;
  /** Placa cuyo dueño ya fue rechazado con «Sin cliente»: no se vuelve a proponer. */
  placaRechazada: string | null;
}

/**
 * El dueño que se elige SOLO al reconocer la placa.
 *
 * La mayoría de las llegadas son de carros que ya vinieron: hacer que el
 * mostrador pulse «Usar este cliente» en cada una es un toque que se salta,
 * y la orden queda como visitante aunque la ficha exista. Se elige solo, pero
 * se enseña con la etiqueta «dueño según la placa» y un botón para cambiarlo,
 * porque los carros se venden.
 *
 * NO se elige solo cuando la recepción ya decidió otra cosa: eligió un cliente
 * a mano, empezó a escribir uno nuevo o quitó al propuesto para esa misma placa.
 */
export function duenoPropuesto<T>(
  conocido: { plate: string; customer: T | null } | null,
  estado: EstadoCliente
): T | null {
  if (!conocido?.customer) return null;
  if (estado.elegidoAMano) return null;
  if (estado.nombreEscrito.trim() || estado.telefonoEscrito.trim()) return null;
  if (estado.placaRechazada && estado.placaRechazada === conocido.plate) return null;
  return conocido.customer;
}

export type AccionTecla = 'registrar' | 'irAServicios' | null;

/**
 * Atajos de teclado de la caja.
 *
 * En la computadora la llegada se registra sin soltar el teclado: Enter en la
 * placa salta a los servicios y Ctrl+Enter (⌘+Enter en Mac) registra desde
 * cualquier campo. Enter a secas NO registra: en un formulario con varios
 * campos de texto, un Enter por costumbre crearía una orden a medias.
 */
export function accionDeTecla(
  tecla: { key: string; ctrlKey: boolean; metaKey: boolean },
  enPlaca: boolean
): AccionTecla {
  if (tecla.key !== 'Enter') return null;
  if (tecla.ctrlKey || tecla.metaKey) return 'registrar';
  if (enPlaca) return 'irAServicios';
  return null;
}
