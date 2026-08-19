import React from 'react';
import { Button } from '../ui/button';
import { AlertCircle, RefreshCw, Loader2, ChevronLeft, ChevronRight, Search, HelpCircle } from 'lucide-react';

/**
 * Piezas compartidas de los listados.
 *
 * Existen porque el mismo andamiaje —encabezado, buscador, estados de carga y
 * error, paginación— se repetía en once vistas de la aplicación auditada, cada
 * una con sus propias variaciones y ninguna con estados de carga (§14.2).
 */

/**
 * Encabezado de una vista.
 *
 * El título ya no se pinta: lo dice la pestaña activa, que está justo encima,
 * resaltada y subrayada. Escribirlo otra vez en cuerpo 24 era gastar el
 * elemento más grande de la pantalla en repetir lo que el usuario acaba de
 * pulsar. Lo que queda es lo que aporta: el contexto (sucursal, rango, estado)
 * y los botones de la vista.
 *
 * Pero el título SIGUE en el documento, en `sr-only`. Sin un encabezado, quien
 * navega con lector de pantalla se queda sin forma de saber en qué página está
 * ni de saltar al contenido: la pestaña es un enlace, no un título. Lo que se
 * quita es el tamaño, no la estructura.
 *
 * Ya no queda ninguna excepción: el saludo del panel de inicio era la última y
 * también se fue. Sin título visible, el icono que lo acompañaba tampoco tiene
 * a qué acompañar, así que se retiró de la firma.
 */
export const ViewHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => {
  // Sin subtítulo y sin acciones no hay fila que pintar: una franja vacía con
  // su línea de abajo es peor que nada.
  if (!subtitle && !actions) return <h2 className="sr-only">{title}</h2>;

  // La línea de separación solo se pinta cuando hay algo que separar. Sin
  // subtítulo, la fila son unos botones sueltos: subrayarlos deja una franja
  // vacía que parece un encabezado al que se le olvidó el texto.
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
      subtitle ? 'border-b border-line pb-3' : ''
    }`}>
      <h2 className="sr-only">{title}</h2>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      {actions && (
        <div className="flex items-center gap-2 self-start sm:self-auto sm:ml-auto">{actions}</div>
      )}
    </div>
  );
};

export const ErrorState: React.FC<{ message: string; onRetry: () => void; title?: string }> = ({
  message, onRetry, title = 'No se pudieron cargar los datos'
}) => (
  <div className="p-6 max-w-md mx-auto">
    <div role="alert" className="bg-danger/40 border border-danger/40 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-danger font-bold text-sm">
        <AlertCircle className="w-5 h-5" /> {title}
      </div>
      <p className="text-sm text-body">{message}</p>
      <Button size="sm" onClick={onRetry}>
        <RefreshCw /> Reintentar
      </Button>
    </div>
  </div>
);

export const InlineAlert: React.FC<{
  tone: 'error' | 'success' | 'warning';
  children: React.ReactNode;
  onDismiss?: () => void;
}> = ({ tone, children, onDismiss }) => {
  const styles = {
    error:   'bg-danger/50 border-danger/40 text-danger',
    success: 'bg-success/40 border-success/40 text-success',
    warning: 'bg-warning/40 border-warning/40 text-warning'
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 p-3 border rounded-xl text-sm ${styles}`}>
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Descartar aviso" className="px-1 font-bold">×</button>
      )}
    </div>
  );
};

export const SearchBox: React.FC<{
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}> = ({ id, label, value, onChange, placeholder }) => (
  <div className="relative flex-1">
    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
    <label htmlFor={id} className="sr-only">{label}</label>
    <input
      id={id} type="search" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-w-0 rounded-lg border border-input bg-transparent pl-9 pr-3 py-1.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    />
  </div>
);

interface FilterChipsProps<T extends string> {
  options: { id: T; label: string }[];
  // NoInfer: `T` se deduce SOLO de `options`. Sin esto, pasar el `setState` de
  // React como onChange envenena la inferencia —su parámetro es
  // `SetStateAction<T>`, no `T`— y `T` termina cayendo al constraint `string`.
  value: NoInfer<T>;
  onChange: (value: NoInfer<T>) => void;
}

// Declaración de función, no arrow genérica: en un .tsx la segunda pierde la
// inferencia del parámetro de tipo.
export function FilterChips<T extends string>({ options, value, onChange }: FilterChipsProps<T>) {
  return (
  <div className="flex gap-1.5 flex-wrap">
    {options.map(o => (
      <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
          value === o.id
            ? 'bg-primary text-primary-foreground border-transparent'
            : 'bg-transparent text-muted border-line hover:bg-surface-2 hover:text-strong'
        }`}>
        {o.label}
      </button>
    ))}
  </div>
  );
}

/** Fila de esqueleto mientras llega la página. */
export const SkeletonRows: React.FC<{ rows?: number; cols: number }> = ({ rows = 6, cols }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i} aria-hidden="true">
        <td colSpan={cols} className="p-3"><div className="h-5 bg-surface-2/60 rounded animate-pulse" /></td>
      </tr>
    ))}
  </>
);

export const EmptyRow: React.FC<{ cols: number; children: React.ReactNode }> = ({ cols, children }) => (
  <tr><td colSpan={cols} className="p-10 text-center text-faint italic">{children}</td></tr>
);

export const Pagination: React.FC<{
  page: number; pageCount: number; total: number; pageSize: number;
  loading?: boolean; onPage: (p: number) => void;
}> = ({ page, pageCount, total, pageSize, loading, onPage }) => (
  <div className="flex items-center justify-between px-4 py-3 border-t border-line text-sm">
    <span className="text-muted">
      {total === 0 ? 'Sin resultados'
        : <>Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} de {total}</>}
    </span>
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon-sm" aria-label="Página anterior"
        onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0 || loading}>
        <ChevronLeft />
      </Button>
      <span className="text-muted tabular-nums">{page + 1} / {pageCount}</span>
      <Button variant="outline" size="icon-sm" aria-label="Página siguiente"
        onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1 || loading}>
        <ChevronRight />
      </Button>
      {loading && <Loader2 className="w-4 h-4 animate-spin text-faint" />}
    </div>
  </div>
);

export const StatCard: React.FC<{ label: string; value: string; tone?: string; hint?: string }> = ({
  label, value, tone = 'text-strong', hint
}) => (
  <div className="bg-surface border border-line rounded-2xl p-4 space-y-1">
    <div className="text-sm text-muted">{label}</div>
    <div className={`text-2xl font-black ${tone} tabular-nums`}>{value}</div>
    {hint && <div className="text-xs text-faint">{hint}</div>}
  </div>
);

/** Aviso de permiso insuficiente, uniforme en todas las vistas. */
export const ReadOnlyNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="status" className="bg-warning/40 border border-warning/40 rounded-xl px-4 py-3 text-sm text-warning">
    {children}
  </div>
);

/**
 * Explicación plegada.
 *
 * Varias listas llevaban al pie un párrafo que explicaba una regla del negocio
 * —cómo se fija la procedencia, qué descuenta el margen, por dónde se cambia un
 * cupo—. Son ciertos y hacen falta la primera vez; a partir de la segunda son
 * ruido permanente que el ojo aprende a saltarse, y de paso enseña a saltarse
 * también los avisos que sí importan.
 *
 * Plegado se ve un renglón; desplegado, el texto entero. No se borra nada: se
 * deja de cobrar el sitio todos los días por algo que se lee una vez.
 */
export const HelpNote: React.FC<{ summary: string; children: React.ReactNode }> = ({
  summary, children
}) => (
  <details className="group">
    <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs text-muted hover:text-strong transition-colors">
      <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="underline decoration-dotted underline-offset-2">{summary}</span>
      <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
    </summary>
    <p className="mt-2 text-xs text-faint max-w-2xl leading-relaxed">{children}</p>
  </details>
);
