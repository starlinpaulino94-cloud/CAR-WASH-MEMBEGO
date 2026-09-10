import React, { useEffect, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { fetchServiciosIncluiblesMembego, ServicioIncluible } from '../../data/adminRepository';
import { useVehicleCategories } from '../../hooks/useVehicleCategories';
import { InlineAlert } from '../common/DataViewShell';

/**
 * Qué servicios puede cubrir una membresía de Membego.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PANTALLA EXISTE
 *
 * La marca «Incluido en el beneficio Membego» nace apagada y NADA la enciende
 * sola: Membego no conoce el catálogo de este local —su contrato dice que las
 * tarifas del satélite son del satélite— así que no puede marcar nada, y
 * «Sincronizar catálogo» tampoco la toca.
 *
 * El resultado era un local con membresías vendidas, clientes con lavados
 * pagados y la cobertura sin funcionar en silencio, hasta que un cajero pulsaba
 * «Aplicar al lavado» con el cliente delante y le salía un aviso. Un ajuste
 * obligatorio que no se pide en ningún sitio no está configurado: está olvidado.
 *
 * Esto no edita nada —la marca vive en la ficha de cada servicio, donde se ve
 * junto a su precio y su comisión— pero dice si falta y qué falta, que es lo
 * que no había forma de saber sin ir servicio por servicio.
 */
export const ServiciosIncluibles: React.FC = () => {
  const CATEGORIAS = useVehicleCategories();
  const [incluibles, setIncluibles] = useState<ServicioIncluible[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetchServiciosIncluiblesMembego()
      .then(r => { if (activo) setIncluibles(r); })
      .catch(e => { if (activo) setError(e instanceof Error ? e.message : 'No se pudieron cargar los servicios'); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  // Categorías en las que NINGÚN servicio marcado tiene precio. Son justo las
  // que fallan en la caja: la marca está puesta pero para ese carro no hay
  // nada que cubrir, y el aviso de antes mandaba a marcar lo ya marcado.
  const sinCobertura = CATEGORIAS.filter(
    c => !incluibles.some(s => s.categorias.includes(c.id))
  );

  return (
    <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
      <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
        <BadgeCheck className="w-4 h-4 text-brand" /> Qué cubre una membresía
      </h3>

      <p className="text-xs text-muted leading-relaxed">
        Cuando un cliente con membresía llega, la caja descuenta UN servicio de
        los marcados como «Incluido en el beneficio Membego». Si hay varios en la
        venta, descuenta el más caro. Marque solo los lavados que sus planes
        cubren de verdad: si marca el más caro del catálogo, un plan básico
        absorberá ese precio.
      </p>

      {cargando && (
        <p className="text-xs text-faint flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Consultando el catálogo…
        </p>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {!cargando && !error && incluibles.length === 0 && (
        <InlineAlert tone="warning">
          <strong>Ningún servicio está marcado, así que ninguna membresía puede
          cubrir nada.</strong> Márquelos en <strong>Configuración →
          Servicios</strong>: abra la ficha del servicio y active «Incluido en el
          beneficio Membego». Mientras no lo haga, aplicar el beneficio en la
          caja va a fallar aunque el cliente tenga su plan al día.
        </InlineAlert>
      )}

      {!cargando && !error && incluibles.length > 0 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase">
              Servicios marcados ({incluibles.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {incluibles.map(s => (
                <span key={s.id}
                  className="px-2 py-0.5 rounded-md text-xs border bg-brand/15 border-brand/40 text-brand-hi font-semibold">
                  {s.name}
                </span>
              ))}
            </div>
          </div>

          {sinCobertura.length > 0 && (
            <InlineAlert tone="warning">
              Ningún servicio marcado tiene precio para{' '}
              <strong>{sinCobertura.map(c => c.label).join(', ')}</strong>. Un
              cliente que llegue en un carro de esa categoría no podrá usar su
              membresía. Póngale precio a esa categoría en{' '}
              <strong>Configuración → Servicios</strong>.
            </InlineAlert>
          )}
        </div>
      )}
    </section>
  );
};
