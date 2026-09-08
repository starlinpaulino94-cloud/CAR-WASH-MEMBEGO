/**
 * CARGA DIFERIDA · sobrevivir a un despliegue con la aplicación abierta.
 *
 * Las 36 vistas se cargan bajo demanda, y cada compilación las publica con un
 * nombre distinto (`CustomersSupabaseView-u5ehYpKP.js`). Al desplegar, los
 * archivos de la versión anterior DESAPARECEN del servidor.
 *
 * Quien tuviera el mostrador abierto se queda con un índice que nombra archivos
 * que ya no existen. Mientras se mueva por vistas ya cargadas no pasa nada;
 * en cuanto entra en una que no había abierto, el navegador pide un archivo
 * borrado, recibe un 404 y lanza «Failed to fetch dynamically imported module».
 *
 * Eso NO es corrupción de datos ni un fallo del código de la vista: es una
 * pestaña vieja pidiendo una versión que ya no está. La cura es recargar, que
 * trae el índice nuevo con los nombres nuevos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE RECARGA SOLO, Y POR QUÉ SOLO UNA VEZ
 *
 * La alternativa era la pantalla roja de error en mitad de un turno, que
 * tampoco conserva nada y además culpa al usuario de tener los datos dañados.
 * El fallo ocurre justo al CAMBIAR de vista —un momento en el que no hay nada a
 * medio escribir en la pantalla de destino—, así que recargar ahí es barato.
 *
 * Una sola vez, con marca en `sessionStorage`: si tras recargar vuelve a
 * fallar, entonces el archivo no falta por un despliegue (red caída, proxy que
 * lo bloquea, compilación rota) y hay que ENSEÑAR el error en vez de recargar
 * en bucle, que dejaría el mostrador dando vueltas sin poder trabajar.
 */

const CLAVE_REINTENTO = 'cw:recarga-por-version';

/**
 * Cuánto tiene que pasar para permitir OTRA recarga.
 *
 * Es lo único que separa «recargar para tomar la versión nueva» de «recargar en
 * bucle». Un despliegue ocurre cada muchos minutos; un bucle, cada segundo.
 */
const VENTANA_MS = 60_000;

/** `sessionStorage` puede lanzar (modo privado, cookies bloqueadas). */
function ultimaRecarga(): number {
  try {
    const v = sessionStorage.getItem(CLAVE_REINTENTO);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}
function anotarRecarga(): void {
  try { sessionStorage.setItem(CLAVE_REINTENTO, String(Date.now())); } catch { /* sin marca: se recargará una vez más y ya */ }
}

/**
 * ¿Es este error una vista que ya no está en el servidor?
 *
 * Cada navegador lo dice a su manera y ninguno expone un código: Chrome habla
 * de «Failed to fetch dynamically imported module», Firefox de «error loading
 * dynamically imported module» y Safari de «Importing a module script failed».
 * Por eso se reconoce por el texto — y se reconoce en los tres, porque el
 * mostrador no usa solo Chrome.
 */
export function esFalloDeVersion(error: unknown): boolean {
  const texto = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return (
    /failed to fetch dynamically imported module/i.test(texto) ||
    /error loading dynamically imported module/i.test(texto) ||
    /importing a module script failed/i.test(texto) ||
    // Un chunk servido como HTML (el index de un 404) al evaluarse da esto.
    /unexpected token '<'/i.test(texto)
  );
}

/** ¿Toca recargar, o ya se recargó hace nada y hay que enseñar el error? */
export function debeRecargar(error: unknown, ahoraMs: number, ultimaMs: number): boolean {
  if (!esFalloDeVersion(error)) return false;
  return ahoraMs - ultimaMs > VENTANA_MS;
}

/**
 * Envuelve la carga de una vista: si falla por versión caducada, recarga.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA GUARDA ES EL TIEMPO, NO «SI YA SE RECARGÓ UNA VEZ»
 *
 * La primera versión limpiaba la marca en cuanto CUALQUIER vista cargaba bien.
 * Parecía razonable —«esta pestaña ya está sana»— y era una trampa: basta con
 * que un solo archivo quede inaccesible de verdad (una subida a medias, un
 * bloqueo del proxy) para que la vista buena limpie la marca, la mala vuelva a
 * recargar, y el mostrador entre en un bucle de recargas del que no se sale.
 *
 * Con una ventana de tiempo eso no puede pasar: como mucho una recarga por
 * minuto, pase lo que pase. Un despliegue de dentro de una hora sigue teniendo
 * la suya, y un archivo roto se enseña como error en el segundo intento en vez
 * de dejar la pantalla parpadeando.
 *
 * Devuelve una promesa que nunca resuelve cuando va a recargar, a propósito: la
 * página se está yendo y resolver con algo a medias haría que React intentara
 * pintar durante la descarga.
 */
export function importarVista<T>(cargar: () => Promise<T>): Promise<T> {
  return cargar().catch((error: unknown) => {
    if (!debeRecargar(error, Date.now(), ultimaRecarga())) throw error;
    anotarRecarga();
    window.location.reload();
    return new Promise<T>(() => { /* la página se recarga */ });
  });
}
