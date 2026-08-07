import React from 'react';
import { AlertCircle, RefreshCw, Loader2, ChevronLeft, ChevronRight, Search } from 'lucide-react';

/**
 * Piezas compartidas de los listados.
 *
 * Existen porque el mismo andamiaje —encabezado, buscador, estados de carga y
 * error, paginación— se repetía en once vistas de la aplicación auditada, cada
 * una con sus propias variaciones y ninguna con estados de carga (§14.2).
 */

export const ViewHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ icon, title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
    <div>
      <h2 className="text-2xl font-bold text-white flex items-center gap-2.5 tracking-tight">{icon} {title}</h2>
      {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 self-start sm:self-auto">{actions}</div>}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry: () => void; title?: string }> = ({
  message, onRetry, title = 'No se pudieron cargar los datos'
}) => (
  <div className="p-6 max-w-md mx-auto">
    <div role="alert" className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
        <AlertCircle className="w-5 h-5" /> {title}
      </div>
      <p className="text-sm text-slate-300">{message}</p>
      <button onClick={onRetry}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2">
        <RefreshCw className="w-4 h-4" /> Reintentar
      </button>
    </div>
  </div>
);

export const InlineAlert: React.FC<{
  tone: 'error' | 'success' | 'warning';
  children: React.ReactNode;
  onDismiss?: () => void;
}> = ({ tone, children, onDismiss }) => {
  const styles = {
    error:   'bg-rose-950/50 border-rose-500/40 text-rose-200',
    success: 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200',
    warning: 'bg-amber-950/40 border-amber-500/40 text-amber-200'
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
    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
    <label htmlFor={id} className="sr-only">{label}</label>
    <input
      id={id} type="search" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
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
        className={`px-3 py-2 rounded-xl text-sm font-bold border transition-all ${
          value === o.id
            ? 'bg-indigo-600 text-white border-indigo-500'
            : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
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
        <td colSpan={cols} className="p-3"><div className="h-5 bg-slate-800/60 rounded animate-pulse" /></td>
      </tr>
    ))}
  </>
);

export const EmptyRow: React.FC<{ cols: number; children: React.ReactNode }> = ({ cols, children }) => (
  <tr><td colSpan={cols} className="p-10 text-center text-slate-500 italic">{children}</td></tr>
);

export const Pagination: React.FC<{
  page: number; pageCount: number; total: number; pageSize: number;
  loading?: boolean; onPage: (p: number) => void;
}> = ({ page, pageCount, total, pageSize, loading, onPage }) => (
  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-sm">
    <span className="text-slate-400">
      {total === 0 ? 'Sin resultados'
        : <>Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} de {total}</>}
    </span>
    <div className="flex items-center gap-2">
      <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0 || loading}
        aria-label="Página anterior"
        className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-slate-300">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-slate-400 tabular-nums">{page + 1} / {pageCount}</span>
      <button onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1 || loading}
        aria-label="Página siguiente"
        className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-slate-300">
        <ChevronRight className="w-4 h-4" />
      </button>
      {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
    </div>
  </div>
);

export const StatCard: React.FC<{ label: string; value: string; tone?: string; hint?: string }> = ({
  label, value, tone = 'text-white', hint
}) => (
  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
    <div className="text-sm text-slate-400">{label}</div>
    <div className={`text-2xl font-black ${tone} tabular-nums`}>{value}</div>
    {hint && <div className="text-xs text-slate-500">{hint}</div>}
  </div>
);

/** Aviso de permiso insuficiente, uniforme en todas las vistas. */
export const ReadOnlyNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="status" className="bg-amber-950/40 border border-amber-500/40 rounded-xl px-4 py-3 text-sm text-amber-200">
    {children}
  </div>
);
