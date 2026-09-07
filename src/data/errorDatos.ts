/**
 * NORMALIZAR LOS ERRORES DE LA BASE DE DATOS.
 *
 * Lo que devuelve supabase-js cuando algo falla NO es un `Error`: es un objeto
 * plano `{ message, code, details, hint }`. Parece un detalle y no lo es,
 * porque toda la aplicación decide qué enseñar con esta forma:
 *
 *     catch (err) { setError(err instanceof Error ? err.message : 'No se pudo …') }
 *
 * Con un objeto plano, `instanceof Error` es FALSO, así que el mensaje real se
 * descarta y el usuario recibe siempre la frase genérica. Es exactamente lo que
 * pasó con Horarios: PostgREST explicaba con precisión que no podía resolver la
 * relación con `profiles`, y en pantalla salía «No se pudieron cargar los
 * turnos» — dos veces, sin una sola pista de la causa.
 *
 * Envolver aquí, en el borde de datos, arregla los ~120 sitios que enseñan
 * errores sin tocar ninguno: a partir de ahora reciben un `Error` de verdad y
 * su `.message` es el de la base.
 *
 * El código técnico (`code`, `details`, `hint`) viaja como propiedades para que
 * el reporte de errores lo conserve, pero NO se mete en el mensaje: quien está
 * cobrando no necesita leer «PGRST201» para entender que algo falló.
 */

export class ErrorDatos extends Error {
  readonly codigo?: string;
  readonly detalles?: string;
  readonly pista?: string;

  constructor(mensaje: string, extra: { codigo?: string; detalles?: string; pista?: string } = {}) {
    super(mensaje);
    this.name = 'ErrorDatos';
    this.codigo = extra.codigo;
    this.detalles = extra.detalles;
    this.pista = extra.pista;
  }
}

/** Lee un campo de texto de un objeto desconocido sin asumir su forma. */
function texto(obj: unknown, clave: string): string | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const v = (obj as Record<string, unknown>)[clave];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Convierte lo que sea que haya fallado en un `Error` con mensaje utilizable.
 * Un `Error` de verdad se devuelve tal cual: ya sirve.
 */
export function fallaDatos(error: unknown): Error {
  if (error instanceof Error) return error;

  const mensaje = texto(error, 'message') ?? 'La base de datos rechazó la operación.';
  return new ErrorDatos(mensaje, {
    codigo: texto(error, 'code'),
    detalles: texto(error, 'details'),
    pista: texto(error, 'hint'),
  });
}
