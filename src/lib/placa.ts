/**
 * La forma canónica de una placa.
 *
 * Vive en `lib` y no junto a las consultas porque la comparan tanto la pantalla
 * como las reglas de la llegada, y una segunda copia de esta línea en otro
 * archivo es una matrícula que un día coincide en un sitio y no en el otro:
 * «A-123456» y «A123456» serían dos carros distintos para la mitad del sistema.
 *
 * La base la guarda ya normalizada (trigger `vehicles_normalize_plate`), así
 * que buscar con otra forma simplemente no encuentra.
 */
export const normalizePlate = (plate: string) =>
  plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
