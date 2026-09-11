import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '../ui/table';
import { SkeletonRows, EmptyRow } from './DataViewShell';

/**
 * La tabla administrativa estándar.
 *
 * No sustituye a usePagedQuery ni a las primitivas de ui/table: elimina el
 * ternario `cargando ? esqueleto : vacío ? mensaje : filas` que estaba copiado
 * verbatim en doce vistas con el número de columnas contado a mano (y por
 * tanto desincronizable). Aquí las columnas se declaran una vez y el esqueleto,
 * el vacío, la fila de totales y el clic de fila salen solos.
 */
export interface ColumnaDatos<T> {
  id: string;
  label: string;
  render: (fila: T) => React.ReactNode;
  /** Alineado a la derecha con números tabulares. */
  numerica?: boolean;
  /** En pantallas pequeñas esta columna se esconde. */
  ocultarEnMovil?: boolean;
  /** Valor de la fila de totales, si la tabla la lleva. */
  total?: React.ReactNode;
}

export function TablaDatos<T>({
  columnas, filas, clave, cargando = false, vacio = 'Sin datos en este periodo.',
  onFila, conTotales = false, etiqueta
}: {
  columnas: ColumnaDatos<T>[];
  filas: T[];
  clave: (fila: T) => string;
  cargando?: boolean;
  vacio?: string;
  /** Si se pasa, la fila entera es clicable: abre su detalle. */
  onFila?: (fila: T) => void;
  conTotales?: boolean;
  etiqueta?: string;
}): React.ReactElement {
  const celda = (c: ColumnaDatos<T>) =>
    `p-3 ${c.numerica ? 'text-right tabular-nums' : ''} ${c.ocultarEnMovil ? 'hidden md:table-cell' : ''}`;

  return (
    <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="text-xs">
          {etiqueta && <caption className="sr-only">{etiqueta}</caption>}
          <TableHeader>
            <TableRow className="border-b border-line text-muted bg-canvas/50">
              {columnas.map(c => (
                <TableHead key={c.id} scope="col"
                  className={`p-3 font-semibold whitespace-nowrap ${c.numerica ? 'text-right' : ''} ${c.ocultarEnMovil ? 'hidden md:table-cell' : ''}`}>
                  {c.label.toUpperCase()}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando ? (
              <SkeletonRows cols={columnas.length} />
            ) : filas.length === 0 ? (
              <EmptyRow cols={columnas.length}>{vacio}</EmptyRow>
            ) : filas.map(f => (
              <TableRow key={clave(f)}
                onClick={onFila ? () => onFila(f) : undefined}
                tabIndex={onFila ? 0 : undefined}
                onKeyDown={onFila ? e => { if (e.key === 'Enter') onFila(f); } : undefined}
                className={`hover:bg-surface-2/40 ${onFila ? 'cursor-pointer' : ''}`}>
                {columnas.map(c => (
                  <TableCell key={c.id} className={celda(c)}>{c.render(f)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {conTotales && !cargando && filas.length > 0 && (
            <TableFooter>
              <TableRow className="border-t border-line bg-canvas/50 font-bold">
                {columnas.map((c, i) => (
                  <TableCell key={c.id} className={celda(c)}>
                    {c.total ?? (i === 0 ? 'Total' : '')}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
