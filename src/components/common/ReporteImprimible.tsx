import React, { useCallback } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Impresión administrativa: el reporte en papel Carta o A4.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTABA CON window.print()
 *
 * El CSS de impresión oculta TODO el body y revela solo la isla del ticket
 * térmico. Imprimir un reporte daba una hoja en blanco — comprobado. Este
 * componente crea la segunda isla, `.print-report`: invisible en pantalla
 * (`solo-impresion`) y lo único visible en papel, con página Carta/A4 en vez
 * de 80 mm.
 *
 * QUÉ SE IMPRIME
 *
 * Lo que la vista ya calculó: los hijos se componen con LOS MISMOS datos que
 * están en pantalla, sin volver a consultar. Si la pantalla está filtrada, el
 * papel sale filtrado; la cabecera dice el periodo y los filtros para que un
 * papel encontrado en una gaveta se explique solo.
 *
 * El botón vive aquí para que toda vista imprima igual: `<BotonImprimir />`
 * junto a las acciones, y en cualquier parte de la vista un
 * `<ReporteImprimible …>` con el contenido.
 */

export interface CabeceraReporte {
  /** Nombre comercial de la empresa. */
  empresa?: string | null;
  titulo: string;
  /** «01/09/2026 – 10/09/2026», de describirRango. */
  periodo: string;
  /** Filtros activos legibles: «Sucursal: Bávaro», «Lavador: Pedro». */
  filtros?: string[];
  sucursal?: string | null;
  generadoPor?: string | null;
}

/** Fija la página y dispara la impresión. Carta por defecto; A4 si se pide. */
export function imprimirReporte(formato: 'carta' | 'a4' = 'carta'): void {
  const root = document.documentElement;
  root.style.setProperty('--print-page-size', formato === 'a4' ? 'A4' : 'letter');
  root.style.setProperty('--print-page-margin', '12mm');
  window.print();
}

export const BotonImprimir: React.FC<{ disabled?: boolean; formato?: 'carta' | 'a4' }> =
  ({ disabled, formato = 'carta' }) => (
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => imprimirReporte(formato)}>
      <Printer className="w-4 h-4" /> Imprimir
    </Button>
  );

export const ReporteImprimible: React.FC<CabeceraReporte & { children: React.ReactNode }> = ({
  empresa, titulo, periodo, filtros = [], sucursal, generadoPor, children
}) => (
  <section className="print-report solo-impresion" aria-hidden="true">
    <header className="pr-cabecera">
      {empresa && <h1>{empresa}</h1>}
      <h2>{titulo}</h2>
      <dl>
        <div><dt>Periodo:</dt><dd>{periodo}</dd></div>
        {sucursal && <div><dt>Sucursal:</dt><dd>{sucursal}</dd></div>}
        {filtros.map((f, i) => {
          const [k, ...resto] = f.split(':');
          return <div key={i}><dt>{k}:</dt><dd>{resto.join(':').trim()}</dd></div>;
        })}
        {generadoPor && <div><dt>Generado por:</dt><dd>{generadoPor}</dd></div>}
        <div>
          <dt>Fecha de impresión:</dt>
          <dd>{new Date().toLocaleString('es-DO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
          })}</dd>
        </div>
      </dl>
    </header>
    {children}
  </section>
);
