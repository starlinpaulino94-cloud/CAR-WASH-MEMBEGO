import React from 'react';
import { CategoriaLegible, TODAS } from '../../lib/filtroServicios';

/**
 * La fila de botones que agrupa el catálogo por tipo de trabajo.
 *
 * Se usa en la caja, en la recepción, al editar una orden y en el catálogo.
 * Es el MISMO componente en las cuatro a propósito: un filtro que se ve
 * distinto en cada pantalla se aprende cuatro veces.
 *
 * «Todos» va primero y es el estado por defecto: quien no quiera filtrar no
 * tiene que hacer nada, y el que llega nuevo ve el catálogo entero como
 * siempre. Cada botón lleva su cuenta, que es lo que dice de un vistazo si vale
 * la pena entrar.
 *
 * No se pinta si solo hay una categoría: un filtro con una sola opción ocupa
 * sitio y no decide nada.
 */
export const FiltroCategoriaServicio: React.FC<{
  categorias: CategoriaLegible[];
  valor: string;
  onCambiar: (code: string) => void;
  /** Cuántos servicios hay en cada categoría, por `code`. */
  cuentas?: Record<string, number>;
  total?: number;
  disabled?: boolean;
  /** Botones más grandes para tablet. */
  grande?: boolean;
}> = ({ categorias, valor, onCambiar, cuentas, total, disabled, grande }) => {
  if (categorias.length < 2) return null;

  const clase = (activo: boolean) =>
    `${grande ? 'px-4 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'} rounded-xl border font-semibold ` +
    `transition-colors disabled:opacity-50 whitespace-nowrap ${
      activo ? 'bg-brand text-on-accent border-brand'
             : 'bg-surface border-line text-body hover:border-brand'
    }`;

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo de servicio">
      <button type="button" disabled={disabled} aria-pressed={valor === TODAS}
        onClick={() => onCambiar(TODAS)} className={clase(valor === TODAS)}>
        Todos{total !== undefined && <span className="opacity-60 font-normal"> · {total}</span>}
      </button>
      {categorias.map(c => (
        <button key={c.code} type="button" disabled={disabled} aria-pressed={valor === c.code}
          onClick={() => onCambiar(c.code)} className={clase(valor === c.code)}>
          {c.label}
          {cuentas?.[c.code] !== undefined && (
            <span className="opacity-60 font-normal"> · {cuentas[c.code]}</span>
          )}
        </button>
      ))}
    </div>
  );
};

/** Las opciones de un `<select>`, agrupadas igual que los botones. */
export function OpcionesAgrupadas<T extends { id: string; name: string }>(
  { grupos, etiqueta }: { grupos: { code: string; label: string; servicios: T[] }[]; etiqueta?: (s: T) => string }
): React.ReactElement {
  return (
    <>
      {grupos.map(g => (
        <optgroup key={g.code} label={g.label}>
          {g.servicios.map(s => (
            <option key={s.id} value={s.id}>{etiqueta ? etiqueta(s) : s.name}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
