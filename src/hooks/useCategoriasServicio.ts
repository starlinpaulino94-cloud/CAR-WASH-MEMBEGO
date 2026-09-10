import { useCallback, useEffect, useState } from 'react';
import { fetchCategoriasServicio, CategoriaServicio } from '../data/adminRepository';

/**
 * Las categorías de servicio de la empresa, para el filtro.
 *
 * Se pide una vez por pantalla. Si falla se devuelve la lista vacía y quien la
 * use debe seguir enseñando TODOS los servicios: un filtro que no carga no
 * puede convertirse en un catálogo vacío — eso dejaría al mostrador sin poder
 * vender por un fallo de una consulta accesoria.
 */
export function useCategoriasServicio(): {
  categorias: CategoriaServicio[];
  recargar: () => void;
} {
  const [categorias, setCategorias] = useState<CategoriaServicio[]>([]);
  const [n, setN] = useState(0);

  useEffect(() => {
    let activo = true;
    fetchCategoriasServicio()
      .then(r => { if (activo) setCategorias(r); })
      .catch(() => { if (activo) setCategorias([]); });
    return () => { activo = false; };
  }, [n]);

  return { categorias, recargar: useCallback(() => setN(v => v + 1), []) };
}
