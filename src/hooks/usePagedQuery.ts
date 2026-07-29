import { useCallback, useEffect, useRef, useState } from 'react';

export interface PagedResult<T> {
  rows: T[];
  total: number;
}

export interface PagedQueryOptions<T> {
  /** Consulta paginada. Recibe la página, el tamaño y el término ya estabilizado. */
  fetcher: (page: number, pageSize: number, search: string) => Promise<PagedResult<T>>;
  pageSize?: number;
  /** Valores que, al cambiar, obligan a releer desde la primera página. */
  deps?: unknown[];
  /** Milisegundos de espera antes de consultar por lo tecleado. */
  debounceMs?: number;
  enabled?: boolean;
}

export interface PagedQuery<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  loading: boolean;
  error: string | null;
  searchInput: string;
  setSearchInput: (value: string) => void;
  setPage: (page: number) => void;
  reload: () => void;
}

/**
 * Consulta paginada con búsqueda diferida.
 *
 * Concentra el andamiaje que si no habría que repetir en cada listado:
 * paginación en servidor, retardo de teclado, estados de carga y error, y
 * vuelta a la primera página al cambiar un filtro. La aplicación auditada
 * filtraba en memoria sobre el array completo en cada pulsación (§3.3).
 *
 * Las respuestas que llegan tarde se descartan: sin eso, teclear rápido puede
 * dejar en pantalla el resultado de una búsqueda anterior.
 */
export function usePagedQuery<T>(options: PagedQueryOptions<T>): PagedQuery<T> {
  const { fetcher, pageSize = 25, deps = [], debounceMs = 350, enabled = true } = options;

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const requestSeq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const id = window.setTimeout(() => { setSearch(searchInput); setPage(0); }, debounceMs);
    return () => window.clearTimeout(id);
  }, [searchInput, debounceMs]);

  // Cambiar un filtro debe devolver a la primera página: quedarse en la 4 de un
  // resultado que ahora tiene una sola es desconcertante.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); }, deps);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);

    fetcherRef.current(page, pageSize, search)
      .then(result => {
        if (seq !== requestSeq.current) return;   // llegó tarde: se ignora
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch(err => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los datos');
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, nonce, enabled, ...deps]);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  return {
    rows, total, page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    loading, error, searchInput, setSearchInput, setPage, reload
  };
}
