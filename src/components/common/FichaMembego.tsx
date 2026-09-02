import React from 'react';
import { Loader2, AlertCircle, BadgeCheck } from 'lucide-react';
import { normalizePlate, type FichaMembego } from '../../data/customersRepository';

/**
 * Lo que Membego sabe del cliente, en un sitio y con un solo criterio.
 *
 * Vive aquí porque se enseña en dos pantallas —la llegada y la caja— y son el
 * MISMO hecho: su membresía, sus lavados, sus carros. Tenerlo escrito dos veces
 * garantizaba que un día dijeran cosas distintas del mismo cliente, y el que
 * cobra y el que recibe no pueden ver saldos diferentes.
 */

export const EtiquetaMembego: React.FC<{
  children: React.ReactNode; tono?: 'ok' | 'info';
}> = ({ children, tono }) => (
  <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${
    tono === 'ok'   ? 'bg-success/15 border-success/40 text-success'
    : tono === 'info' ? 'bg-info/15 border-info/40 text-info'
    : 'bg-surface-2 border-line text-muted'
  }`}>
    {children}
  </span>
);

interface Props {
  ficha: FichaMembego | null;
  error: string | null;
  buscando: boolean;
  /** Placa actual, para resaltar cuál de sus carros está en el mostrador. */
  placa?: string;
  /** Si se pasa, los vehículos son botones que rellenan la placa. */
  onElegirPlaca?: (placa: string) => void;
  /**
   * Si se pasa, cada beneficio usable muestra un botón «Aplicar» que agrega el
   * servicio cubierto a la venta. Sin él, la ficha solo informa.
   */
  onAplicarBeneficio?: (b: { tipo: 'membership' | 'promotion'; id: string; nombre: string }) => void;
  disabled?: boolean;
}

export const PanelFichaMembego: React.FC<Props> = ({
  ficha, error, buscando, placa = '', onElegirPlaca, onAplicarBeneficio, disabled = false
}) => {
  const promosElegibles = ficha?.promotions.filter(p => p.eligible) ?? [];

  return (
    <div className="space-y-2">
      {buscando && (
        <p className="text-xs text-muted flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Consultando Membego…
        </p>
      )}

      {/* Si Membego no contesta se avisa y se sigue: un lavadero no deja de
          trabajar porque la fidelización esté caída. Por eso el aviso vive
          junto al cliente y no encima del botón que cierra la operación. */}
      {error && !buscando && (
        <p className="text-xs text-warning flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Membego no respondió ({error}). Puede continuar igual.</span>
        </p>
      )}

      {ficha?.memberships.map(m => {
        const cubre = m.coverage?.covers;
        return (
          <div key={m.id} className="space-y-1">
            <p className="text-sm font-bold text-strong flex items-center gap-1.5">
              <BadgeCheck className="w-4 h-4 text-warning flex-shrink-0" />
              {m.nombre}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <EtiquetaMembego tono={m.usesLeft > 0 ? 'ok' : undefined}>
                {m.coverage?.unlimited
                  ? 'Lavados ilimitados'
                  : `${m.usesLeft} ${m.usesLeft === 1 ? 'lavado' : 'lavados'} restantes`}
              </EtiquetaMembego>
              {m.expiresAt && (
                <EtiquetaMembego>
                  Vence {new Date(m.expiresAt).toLocaleDateString('es-DO',
                    { day: '2-digit', month: 'short', year: 'numeric' })}
                </EtiquetaMembego>
              )}
            </div>

            {/* El veredicto sobre ESTE carro. `null` es «no se preguntó»
                —todavía no hay placa— y no se pinta: enseñarlo como «no
                cubre» sería cobrar de más. */}
            {cubre === true && (
              <p className="text-xs text-success font-bold">Cubre este vehículo.</p>
            )}
            {cubre === false && (
              <p className="text-xs text-warning">
                {m.coverage?.reason === 'VEHICLE_LEVEL_ABOVE_PLAN'
                  ? 'Este vehículo es de categoría superior a la del plan: la diferencia se cobra.'
                  : m.coverage?.reason === 'VEHICLE_NOT_IN_MEMBERSHIP'
                    ? 'Esta placa no está en su membresía: el lavado se cobra completo.'
                    : 'Sin lavados disponibles: el lavado se cobra completo.'}
              </p>
            )}

            {/* Aplicar: agrega el servicio cubierto a la venta. Solo si la
                membresía tiene lavados (ilimitada o con saldo) y NO está negada
                de plano por falta de saldo/placa; la diferencia por categoría sí
                se permite (se cobra el excedente). */}
            {onAplicarBeneficio && (m.coverage?.unlimited || m.usesLeft > 0) &&
              m.coverage?.reason !== 'NO_USES_LEFT' &&
              m.coverage?.reason !== 'VEHICLE_NOT_IN_MEMBERSHIP' && (
              <button type="button" disabled={disabled}
                onClick={() => onAplicarBeneficio({ tipo: 'membership', id: m.id, nombre: m.nombre })}
                className="mt-1 px-3 py-1.5 rounded-lg bg-success text-on-accent text-xs font-bold disabled:opacity-50 hover:opacity-90 transition-opacity">
                Aplicar al lavado
              </button>
            )}
          </div>
        );
      })}

      {ficha && ficha.memberships.length === 0 && !error && (
        <p className="text-xs text-faint">Sin membresía activa en Membego.</p>
      )}

      {promosElegibles.length > 0 && (
        <p className="text-xs text-body">
          <strong>{promosElegibles.length}</strong>{' '}
          {promosElegibles.length === 1 ? 'promoción disponible' : 'promociones disponibles'}
          : {promosElegibles.map(p => p.nombre).join(' · ')}
        </p>
      )}

      {/* Sus carros en Membego. Tocar uno pone su placa: es lo que el mostrador
          iba a teclear mirando la matrícula. */}
      {ficha && ficha.vehicles.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-semibold text-muted uppercase">Sus vehículos</span>
          <div className="flex flex-wrap gap-1.5">
            {ficha.vehicles.map(v => {
              const esActual = !!v.placa && normalizePlate(v.placa) === normalizePlate(placa);
              const etiqueta = (
                <>
                  <strong>{v.placa ?? 'sin placa'}</strong>
                  {(v.marca || v.modelo) && (
                    <span className="font-normal opacity-80">
                      {' '}· {[v.marca, v.modelo].filter(Boolean).join(' ')}
                    </span>
                  )}
                </>
              );

              // Sin `onElegirPlaca` no son botones: un botón que no hace nada
              // al pulsarlo es peor que un texto.
              return onElegirPlaca ? (
                <button key={v.id} type="button" disabled={disabled}
                  onClick={() => onElegirPlaca(v.placa ?? '')}
                  className={`px-2 py-1 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                    esActual
                      ? 'bg-brand text-on-accent border-brand font-bold'
                      : 'bg-surface border-line text-body hover:border-brand'
                  }`}>
                  {etiqueta}
                </button>
              ) : (
                <span key={v.id}
                  className={`px-2 py-1 rounded-lg border text-xs ${
                    esActual ? 'bg-brand/15 border-brand text-strong font-bold'
                             : 'bg-surface border-line text-body'
                  }`}>
                  {etiqueta}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
