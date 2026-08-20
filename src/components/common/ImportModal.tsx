import React, { useId, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Upload, Loader2, X, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { parseCsv, csvToObjects, toCsv, downloadCsv } from '../../lib/csv';
import {
  importBatch, ImportEntity, ImportResult, MAX_IMPORT_ROWS
} from '../../data/importExportRepository';
import { InlineAlert } from './DataViewShell';

/**
 * Importar desde CSV, en dos tiempos.
 *
 * Primero se lee el archivo y se manda como ENSAYO: el servidor hace el trabajo
 * entero y lo revierte, devolviendo fila por fila qué haría. Esa tabla es la
 * pantalla; el botón de aplicar solo aparece después de haberla visto.
 *
 * No hay «mapeo de columnas» que rellenar: los encabezados se normalizan y el
 * servidor acepta sinónimos («Teléfono», «phone», «celular»). Pedirle a alguien
 * que empareje veinte columnas a mano antes de ver un solo dato es la forma más
 * segura de que abandone la migración.
 */

const ENTITY_HELP: Record<ImportEntity, { titulo: string; columnas: string; ejemplo: string[][] }> = {
  clientes: {
    titulo: 'Clientes',
    columnas: 'nombre (obligatorio), apellido, telefono, correo, rnc, direccion, notas',
    ejemplo: [
      ['nombre', 'apellido', 'telefono', 'correo', 'rnc'],
      ['Juan', 'Pérez', '829-555-0101', 'juan@ejemplo.com', ''],
    ]
  },
  vehiculos: {
    titulo: 'Vehículos',
    columnas: 'placa (obligatorio), marca, modelo, ano, color, categoria, telefono_cliente',
    ejemplo: [
      ['placa', 'marca', 'modelo', 'ano', 'color', 'categoria', 'telefono_cliente'],
      ['A123456', 'Toyota', 'Corolla', '2019', 'Gris', 'Sedán', '829-555-0101'],
    ]
  },
  servicios: {
    titulo: 'Servicios',
    columnas: 'nombre (obligatorio), codigo, categoria, minutos, precio, precio_suv, precio_pickup…',
    ejemplo: [
      ['nombre', 'categoria', 'minutos', 'precio', 'precio_suv', 'precio_pickup'],
      ['Cuidado Estándar', 'Lavado', '45', '900.00', '1300.00', '1500.00'],
    ]
  },
  productos: {
    titulo: 'Productos',
    columnas: 'nombre (obligatorio), codigo, categoria, precio, costo, existencia, minimo, unidad',
    ejemplo: [
      ['nombre', 'categoria', 'precio', 'costo', 'existencia', 'unidad'],
      ['Gatorade Uva', 'Bebidas', '84.75', '60.00', '24', 'Botella'],
    ]
  },
  proveedores: {
    titulo: 'Proveedores',
    columnas: 'nombre (obligatorio), rnc, telefono, correo, direccion, notas',
    ejemplo: [
      ['nombre', 'rnc', 'telefono', 'correo'],
      ['Químicos del Caribe SRL', '130768102', '829-423-5467', 'ventas@ejemplo.com'],
    ]
  },
  promociones: {
    titulo: 'Descuentos',
    columnas: 'nombre (obligatorio), codigo, tipo (porcentaje | importe), valor, desde, hasta, minimo',
    ejemplo: [
      ['nombre', 'codigo', 'tipo', 'valor'],
      ['Primer lavado gratis', 'PRIMERO', 'porcentaje', '100'],
    ]
  }
};

const ACCION_ESTILO: Record<string, string> = {
  crear:      'bg-success/20 text-success',
  actualizar: 'bg-info/20 text-info',
  omitir:     'bg-surface-3/50 text-muted',
  error:      'bg-danger/20 text-danger'
};

export const ImportModal: React.FC<{
  entity: ImportEntity;
  onClose: () => void;
  /** Se llama tras aplicar, para que la vista recargue su listado. */
  onImported: () => void;
}> = ({ entity, onClose, onImported }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const help = ENTITY_HELP[entity];

  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [applied, setApplied] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const leerArchivo = async (file: File) => {
    setError(null); setPreview(null); setApplied(null);
    try {
      const texto = await file.text();
      const objetos = csvToObjects(parseCsv(texto));
      if (objetos.length === 0) {
        setError('El archivo no trae filas con datos, o le falta la fila de encabezados.');
        setRows([]); return;
      }
      if (objetos.length > MAX_IMPORT_ROWS) {
        setError(`El archivo trae ${objetos.length} filas y el máximo por tanda es ${MAX_IMPORT_ROWS}. Párelo en varios archivos.`);
        setRows([]); return;
      }
      setRows(objetos);
      setFileName(file.name);
    } catch {
      setError('No se pudo leer el archivo. ¿Es un CSV?');
    }
  };

  const ensayar = async () => {
    if (!rows.length || busy) return;
    setBusy(true); setError(null);
    try {
      setPreview(await importBatch(entity, rows, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo previsualizar');
    } finally {
      setBusy(false);
    }
  };

  const aplicar = async () => {
    if (!rows.length || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await importBatch(entity, rows, true);
      setApplied(res);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar');
    } finally {
      setBusy(false);
    }
  };

  const plantilla = () => {
    downloadCsv(`plantilla-${entity}`, toCsv(
      help.ejemplo[0].map((h, i) => ({ header: h, value: (r: string[]) => r[i] ?? '' })),
      help.ejemplo.slice(1)
    ));
  };

  const resultado = applied ?? preview;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="w-full max-w-3xl bg-surface border border-line-strong rounded-2xl shadow-2xl max-h-[90vh] flex flex-col focus:outline-none">

        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="font-bold text-strong text-sm flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand" /> Importar {help.titulo.toLowerCase()}
          </h2>
          <button onClick={() => { if (!busy) onClose(); }} disabled={busy} aria-label="Cerrar"
            className="p-1 text-muted hover:text-strong disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

          {applied ? (
            <InlineAlert tone="success">
              Importación aplicada: {applied.resumen.crear} creados,{' '}
              {applied.resumen.actualizar} actualizados, {applied.resumen.omitir} sin cambios
              {applied.resumen.error > 0 && `, ${applied.resumen.error} con error`}.
            </InlineAlert>
          ) : (
            <>
              <div className="bg-canvas/60 border border-line rounded-xl p-4 space-y-2">
                <p className="text-sm text-body">
                  Un archivo <strong>CSV</strong> con la primera fila de encabezados. No hace falta
                  que coincidan exactamente: se aceptan mayúsculas, acentos y sinónimos comunes.
                </p>
                <p className="text-xs text-faint">
                  Columnas que se leen: {help.columnas}
                </p>
                <Button variant="link" size="xs" onClick={plantilla}
                  >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Descargar plantilla de ejemplo
                </Button>
              </div>

              <div>
                <label htmlFor="import-file"
                  className="block text-sm font-semibold text-muted uppercase tracking-wide mb-1">
                  Archivo
                </label>
                <input id="import-file" type="file" accept=".csv,text/csv,text/plain" disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }}
                  className="w-full text-sm text-body file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-surface-2 file:text-body hover:file:bg-surface-3" />
                {rows.length > 0 && (
                  <p className="text-xs text-faint mt-1.5">
                    {fileName}: {rows.length} {rows.length === 1 ? 'fila leída' : 'filas leídas'}.
                  </p>
                )}
              </div>
            </>
          )}

          {resultado && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                {([
                  ['crear', 'Nuevos', 'text-success'],
                  ['actualizar', 'Se actualizan', 'text-info'],
                  ['omitir', 'Sin cambios', 'text-muted'],
                  ['error', 'Con error', 'text-danger']
                ] as const).map(([k, label, tone]) => (
                  <div key={k} className="bg-canvas border border-line rounded-xl p-3">
                    <div className={`text-xl font-black tabular-nums ${tone}`}>
                      {resultado.resumen[k]}
                    </div>
                    <div className="text-xs text-faint">{label}</div>
                  </div>
                ))}
              </div>

              {!applied && (
                <InlineAlert tone="warning">
                  Esto es una previsualización: <strong>todavía no se ha guardado nada</strong>. El
                  servidor hizo el trabajo completo y lo deshizo para poder enseñárselo.
                </InlineAlert>
              )}

              <div className="border border-line rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Detalle fila por fila de la importación</caption>
                  <thead className="sticky top-0">
                    <tr className="bg-canvas text-muted border-b border-line">
                      <th scope="col" className="p-2 font-semibold w-12">FILA</th>
                      <th scope="col" className="p-2 font-semibold w-28">ACCIÓN</th>
                      <th scope="col" className="p-2 font-semibold">REGISTRO</th>
                      <th scope="col" className="p-2 font-semibold">DETALLE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {resultado.detalle.map(d => (
                      <tr key={d.fila} className="hover:bg-surface-2/40">
                        <td className="p-2 text-faint tabular-nums">{d.fila}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded font-bold ${ACCION_ESTILO[d.accion]}`}>
                            {d.accion}
                          </span>
                        </td>
                        <td className="p-2 text-strong font-semibold">{d.clave ?? '—'}</td>
                        <td className="p-2 text-muted">{d.nota ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" type="button" onClick={() => { if (!busy) onClose(); }} disabled={busy}
            >
            {applied ? 'Cerrar' : 'Cancelar'}
          </Button>

          {!applied && !preview && (
            <Button variant="secondary" type="button" onClick={() => void ensayar()} disabled={busy || rows.length === 0}
              >
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Revisando…</>
                    : <><AlertTriangle className="w-4 h-4" /> Previsualizar</>}
            </Button>
          )}

          {!applied && preview && (
            <button type="button" onClick={() => void aplicar()} disabled={busy}
              className="px-4 py-2 bg-brand hover:bg-brand disabled:bg-surface-3 text-on-accent font-bold text-sm rounded-xl flex items-center gap-2">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando…</>
                    : <><CheckCircle2 className="w-4 h-4" /> Aplicar esta importación</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** Botón que abre el diálogo. Se oculta solo si el rol no puede importar. */
export const ImportButton: React.FC<{
  entity: ImportEntity;
  onImported: () => void;
  label?: string;
}> = ({ entity, onImported, label = 'Importar' }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 text-body font-bold text-sm rounded-xl border border-line-strong">
        <Upload className="w-4 h-4" /> {label}
      </button>
      {open && (
        <ImportModal entity={entity} onClose={() => setOpen(false)}
          onImported={onImported} />
      )}
    </>
  );
};
