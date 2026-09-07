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

/** `sessionStorage` puede lanzar (modo privado, cookies bloqueadas). */
function leerMarca(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_REINTENTO) !== null;
  } catch {
    return false;
  }
}
function ponerMarca(): void {
  try { sessionStorage.setItem(CLAVE_REINTENTO, String(Date.now())); } catch { /* sin marca: se recarga una vez más y ya */ }
}
function quitarMarca(): void {
  try { sessionStorage.removeItem(CLAVE_REINTENTO); } catch { /* nada que limpiar */ }
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

/**
 * Envuelve la carga de una vista: si falla por versión caducada, recarga.
 *
 * Devuelve una promesa que nunca resuelve cuando va a recargar, a propósito:
 * la página se está yendo y resolver con algo a medias haría que React
 * intentara pintar durante la descarga.
 */
export function importarVista<T>(cargar: () => Promise<T>): Promise<T> {
  return cargar().then(
    modulo => {
      // Una carga buena significa que la versión de esta pestaña sirve: se
      // limpia la marca para que un despliegue POSTERIOR pueda recargar otra vez.
      quitarMarca();
      return modulo;
    },
    error => {
      if (!esFalloDeVersion(error) || leerMarca()) throw error;
      ponerMarca();
      window.location.reload();
      return new Promise<T>(() => { /* la página se recarga */ });
    }
  );
}
