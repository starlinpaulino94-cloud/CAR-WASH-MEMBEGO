import React from 'react';
import { FiltrosReporte } from '../../data/reportsRepository';
import { METODO_PAGO } from '../../lib/etiquetas';

/**
 * Los filtros avanzados de un reporte: sucursal, cajero, lavador, servicio,
 * categoría, método y estado. Cada uno se muestra solo si se le pasan opciones,
 * así una misma barra sirve a pantallas con dimensiones distintas.
 *
 * Emite un objeto FiltrosReporte que viaja TAL CUAL a la RPC, a la exportación
 * y a la impresión: un solo universo para todo lo que se ve. Cambiar un filtro
 * refresca la pantalla entera, no solo la tabla.
 */
export interface OpcionSelect { id: string; label: string }

export const FiltrosReporteBar: React.FC<{
  valor: FiltrosReporte;
  onCambiar: (f: FiltrosReporte) => void;
  sucursales?: OpcionSelect[];
  cajeros?: OpcionSelect[];
  lavadores?: OpcionSelect[];
  servicios?: OpcionSelect[];
  categorias?: OpcionSelect[];
  conEstado?: boolean;
  conMetodo?: boolean;
  disabled?: boolean;
}> = ({
  valor, onCambiar, sucursales, cajeros, lavadores, servicios, categorias,
  conEstado, conMetodo, disabled
}) => {
  const sel = 'bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-strong focus:outline-none focus:border-brand disabled:opacity-50';
  const set = (k: keyof FiltrosReporte, v: string) =>
    onCambiar({ ...valor, [k]: v || undefined });

  const Campo: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => (
    <label className="flex items-center gap-1.5 text-xs text-muted">{etiqueta}{children}</label>
  );

  const hayAlguno = (sucursales && sucursales.length > 1) || cajeros?.length || lavadores?.length
    || servicios?.length || categorias?.length || conEstado || conMetodo;
  if (!hayAlguno) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {sucursales && sucursales.length > 1 && (
        <Campo etiqueta="Sucursal">
          <select className={sel} disabled={disabled} value={valor.branch_id ?? ''} onChange={e => set('branch_id', e.target.value)}>
            <option value="">Todas</option>
            {sucursales.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Campo>
      )}
      {cajeros && cajeros.length > 0 && (
        <Campo etiqueta="Cajero">
          <select className={sel} disabled={disabled} value={valor.cashier_id ?? ''} onChange={e => set('cashier_id', e.target.value)}>
            <option value="">Todos</option>
            {cajeros.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Campo>
      )}
      {lavadores && lavadores.length > 0 && (
        <Campo etiqueta="Lavador">
          <select className={sel} disabled={disabled} value={valor.washer_id ?? ''} onChange={e => set('washer_id', e.target.value)}>
            <option value="">Todos</option>
            {lavadores.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Campo>
      )}
      {servicios && servicios.length > 0 && (
        <Campo etiqueta="Servicio">
          <select className={sel} disabled={disabled} value={valor.service_id ?? ''} onChange={e => set('service_id', e.target.value)}>
            <option value="">Todos</option>
            {servicios.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Campo>
      )}
      {categorias && categorias.length > 0 && (
        <Campo etiqueta="Categoría">
          <select className={sel} disabled={disabled} value={valor.service_category ?? ''} onChange={e => set('service_category', e.target.value)}>
            <option value="">Todas</option>
            {categorias.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Campo>
      )}
      {conMetodo && (
        <Campo etiqueta="Método">
          <select className={sel} disabled={disabled} value={valor.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(METODO_PAGO).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Campo>
      )}
      {conEstado && (
        <Campo etiqueta="Estado">
          <select className={sel} disabled={disabled} value={valor.status ?? ''} onChange={e => set('status', e.target.value)}>
            <option value="">Vigentes</option>
            <option value="anulada">Anuladas</option>
            <option value="todas">Todas</option>
          </select>
        </Campo>
      )}
    </div>
  );
};
