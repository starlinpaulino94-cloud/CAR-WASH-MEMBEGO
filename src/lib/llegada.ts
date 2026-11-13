/**
 * Reglas del formulario de llegada que no dependen de React.
 *
 * Están fuera del componente para poder probarlas solas: son las decisiones
 * que, cuando fallan, no se notan en pantalla hasta que el cliente pregunta
 * por qué le cobraron un servicio distinto al que pidió.
 */
import { normalizePlate } from './placa';

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

/**
 * Qué pasa con el cliente en pantalla cuando cambia la placa.
 *
 * SÍNTOMA QUE ARREGLA, en palabras del dueño: «cuando un cliente tiene más de
 * un vehículo, no deja seleccionar el que no es el principal».
 *
 * La regla anterior era: si el cliente lo había puesto la placa, y la placa
 * nueva no tiene dueño registrado, se suelta al cliente con su nombre y su
 * teléfono. Nació para lo correcto —el carro de otro no puede quedar colgado
 * del cliente anterior— pero no distinguía DE DÓNDE venía la placa nueva.
 *
 * Y hay un caso en que sí se sabe de quién es: el mostrador acaba de tocarla en
 * la lista de vehículos de ESE cliente. Entonces la placa no es de otro, es el
 * segundo carro del mismo —y ese segundo carro suele no estar registrado
 * todavía, que es justo cuando la regla lo soltaba—. El cliente desaparecía de
 * la pantalla al tocar su propio carro, con el nombre y el teléfono en blanco,
 * y en el mostrador eso se lee como «solo deja el principal».
 *
 * Devuelve la decisión en vez de tomarla para poder probarla sola: las tres
 * salidas son «proponer a este», «soltar al que hay» y «no tocar nada».
 */
export type AccionDueno<T> =
  | { accion: 'proponer'; cliente: T }
  | { accion: 'soltar' }
  | { accion: 'dejar' };

export function duenoTrasCambioDePlaca<T>(
  conocido: { plate: string; customer: T | null } | null,
  estado: EstadoCliente & {
    /** El cliente en pantalla lo propuso la placa anterior. */
    duenoPorPlaca: boolean;
    /** La placa nueva salió de la lista de vehículos del cliente en pantalla. */
    placaDeSuLista: boolean;
  }
): AccionDueno<T> {
  // Lo que eligió el mostrador a mano no se toca nunca.
  if (estado.elegidoAMano) return { accion: 'dejar' };
  // Su propio carro: la placa cambió, el cliente no.
  if (estado.placaDeSuLista) return { accion: 'dejar' };

  const propuesto = duenoPropuesto(conocido, estado);
  if (propuesto) return { accion: 'proponer', cliente: propuesto };
  // Sin dueño que proponer, solo se suelta al que había puesto la placa: el
  // que escribió el mostrador se queda.
  return estado.duenoPorPlaca ? { accion: 'soltar' } : { accion: 'dejar' };
}

/**
 * Los carros entre los que el mostrador puede elegir, en una sola lista.
 *
 * Vienen de dos sitios que no se solapan del todo: el registro del car wash
 * —lo que de verdad se factura— y los que el cliente tenga en su membresía de
 * Membego, que pueden no haber pasado nunca por aquí. Enseñarlos en dos listas
 * obliga a mirar en dos sitios para una pregunta de un segundo («¿cuál de sus
 * carros es este?»), así que se juntan.
 *
 * Se comparan por placa normalizada, que es la identidad del carro: «A-123456»
 * y «A123456» son el mismo. Gana el del car wash, que es el que trae marca,
 * modelo, color y categoría; del de Membego solo se sabe la matrícula y poco
 * más. Los que no tienen placa se caen: un botón que rellena un campo vacío no
 * sirve para nada.
 */
export interface VehiculoElegible {
  id: string;
  placa: string;
  /** Marca y modelo, ya juntos. Cadena vacía si no se sabe. */
  descripcion: string;
  /** `true` si está en el registro del car wash (trae categoría y color). */
  registrado: boolean;
}

export function vehiculosDelCliente(
  locales: readonly { id: string; plate: string; make?: string | null; model?: string | null }[],
  membego: readonly { id: string; placa?: string | null; marca?: string | null; modelo?: string | null }[]
): VehiculoElegible[] {
  const salida: VehiculoElegible[] = [];
  const vistas = new Set<string>();

  const añadir = (id: string, placa: string, partes: (string | null | undefined)[], registrado: boolean) => {
    const norm = normalizePlate(placa);
    if (norm.length === 0 || vistas.has(norm)) return;
    vistas.add(norm);
    salida.push({
      id, placa: placa.trim(),
      descripcion: partes.map(p => (p ?? '').trim()).filter(Boolean).join(' '),
      registrado
    });
  };

  for (const v of locales) añadir(v.id, v.plate, [v.make, v.model], true);
  for (const v of membego) añadir(v.id, v.placa ?? '', [v.marca, v.modelo], false);

  return salida;
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
