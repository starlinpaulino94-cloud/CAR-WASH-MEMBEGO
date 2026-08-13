import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { CsvColumn, toCsv, downloadCsv, stampedName } from '../../lib/csv';
import { InlineAlert } from './DataViewShell';

/**
 * Botón de exportar a CSV.
 *
 * Exporta lo que hay en la BASE, no lo que se ve en pantalla. Una tabla paginada
 * muestra 25 filas; exportar esas 25 y llamarlo «exportar clientes» sería una
 * mentira que el usuario solo descubre al abrir el archivo. Por eso recibe un
 * `fetchRows` que recorre el servidor por páginas.
 */
export function ExportButton<T>({ columns, fetchRows, filename, label = 'Exportar' }: {
  columns: CsvColumn<T>[];
  /** Trae TODAS las filas, paginando contra el servidor. */
  fetchRows: () => Promise<{ rows: T[]; truncated: boolean }>;
  /** Base del nombre; se le añade la fecha. */
  filename: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const { rows, truncated } = await fetchRows();
      if (rows.length === 0) {
        setError('No hay nada que exportar todavía.');
        return;
      }
      downloadCsv(stampedName(filename), toCsv(columns, rows));
      setNotice(truncated
        ? `Se exportaron las primeras ${rows.length} filas; hay más. Acote el rango para llevarse el resto.`
        : `${rows.length} ${rows.length === 1 ? 'fila exportada' : 'filas exportadas'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-body font-bold text-sm rounded-xl border border-line-strong"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {label}
      </button>
      {/* Los avisos se anclan fuera del botón para no romper la fila de acciones. */}
      {(error || notice) && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm">
          <InlineAlert tone={error ? 'error' : 'success'}
            onDismiss={() => { setError(null); setNotice(null); }}>
            {error ?? notice}
          </InlineAlert>
        </div>
      )}
    </>
  );
}
