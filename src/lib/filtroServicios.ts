/**
 * Agrupar y filtrar el catálogo de servicios por tipo de trabajo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO VIVE APARTE
 *
 * Porque el mismo filtro tiene que comportarse IGUAL en las seis pantallas
 * donde se elige un servicio: la caja, la recepción, la edición de una orden,
 * el catálogo, las citas y las tarifas de flota. Escrito seis veces serían seis
 * criterios que empiezan iguales y se separan a la tercera semana — uno
 * ignorando acentos y otro no, uno escondiendo las categorías vacías y otro
 * enseñándolas—, y el cajero aprendería que «depende de la pantalla».
 */

export interface ConCategoria {
  /** El `code` de `service_categories`. Vacío = sin clasificar. */
  category: string;
  name: string;
  description?: string;
}

export interface CategoriaLegible {
  code: string;
  label: string;
}

/** Marca de «los que no tienen categoría», para el filtro y los grupos. */
export const SIN_CATEGORIA = '__sin__';
/** Marca de «todos», el estado por defecto del filtro. */
export const TODAS = '__todas__';

/** Sin acentos y en minúsculas: «Cera a máquina» se encuentra tecleando "maquina". */
export const normalizar = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Los servicios que pasan el filtro.
 *
 * La categoría y el texto se aplican a la vez: elegir «Brillado» y teclear
 * «faro» deja los brillados de faroles, no todo lo que se llame faro.
 */
export function filtrarServicios<T extends ConCategoria>(
  servicios: readonly T[],
  filtro: { categoria?: string; texto?: string }
): T[] {
  const cat = filtro.categoria ?? TODAS;
  const q = normalizar((filtro.texto ?? '').trim());

  return servicios.filter(s => {
    if (cat === SIN_CATEGORIA) { if (s.category) return false; }
    else if (cat !== TODAS && s.category !== cat) return false;
    if (!q) return true;
    return normalizar(`${s.name} ${s.description ?? ''}`).includes(q);
  });
}

/**
 * Las categorías que merecen un botón en el filtro.
 *
 * Solo las que tienen algo dentro. Un filtro que ofrece «Reparaciones» y al
 * pulsarlo deja la pantalla en blanco enseña que el filtro no es de fiar, y a
 * partir de ahí no se usa. Se añade «Sin categoría» solo si de verdad hay
 * alguno suelto, que es como se ven los que quedan por clasificar.
 */
export function categoriasConServicios<T extends ConCategoria>(
  servicios: readonly T[],
  categorias: readonly CategoriaLegible[]
): CategoriaLegible[] {
  const presentes = new Set(servicios.map(s => s.category).filter(Boolean));
  const vivas = categorias.filter(c => presentes.has(c.code));
  const sueltos = servicios.some(s => !s.category);
  return sueltos ? [...vivas, { code: SIN_CATEGORIA, label: 'Sin categoría' }] : vivas;
}

export interface GrupoServicios<T> {
  code: string;
  label: string;
  servicios: T[];
}

/**
 * El catálogo repartido en grupos, para los desplegables.
 *
 * Un `<select>` no admite botones de filtro, pero sí `<optgroup>`: la misma
 * agrupación, con el mismo orden y las mismas etiquetas. Los grupos vacíos no
 * se devuelven, y los servicios sin clasificar van al final —nunca se pierden—.
 */
export function agruparPorCategoria<T extends ConCategoria>(
  servicios: readonly T[],
  categorias: readonly CategoriaLegible[]
): GrupoServicios<T>[] {
  const grupos = categorias
    .map(c => ({ code: c.code, label: c.label, servicios: servicios.filter(s => s.category === c.code) }))
    .filter(g => g.servicios.length > 0);

  // Los que apuntan a una categoría que ya no existe (la desactivaron, la
  // borraron) NO se esconden: se venden igual, así que se ven con los sueltos.
  const conocidas = new Set(categorias.map(c => c.code));
  const sueltos = servicios.filter(s => !s.category || !conocidas.has(s.category));
  return sueltos.length > 0
    ? [...grupos, { code: SIN_CATEGORIA, label: 'Sin categoría', servicios: sueltos }]
    : grupos;
}
