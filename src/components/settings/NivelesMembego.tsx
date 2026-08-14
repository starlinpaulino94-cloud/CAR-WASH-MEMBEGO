import React, { useEffect, useState } from 'react';
import { Layers, Loader2, Save } from 'lucide-react';
import {
  fetchVehicleCategoryLevels, setVehicleCategoryLevels,
  NivelesPorCategoria, VehicleCategory
} from '../../data/adminRepository';
import { InlineAlert } from '../common/DataViewShell';

/**
 * Equivalencia entre nuestras categorías y los niveles tarifarios de Membego.
 *
 * Membego decide si una membresía cubre un carro comparando NÚMEROS, nunca
 * nombres: cada plan lleva un tope y cada categoría un nivel. Que una jeepeta
 * valga 3 y un sedán 1 es una decisión del negocio —en un local la jeepeta y la
 * SUV son lo mismo y en otro no—, así que se configura aquí en vez de quedar
 * congelada en un despliegue.
 *
 * SIN NIVEL NO ES NIVEL 1. Una categoría sin configurar se queda vacía y el
 * mostrador dirá que no lo sabe. Poner 1 por defecto haría que todas cupieran
 * en el plan más barato y el negocio regalaría lavados de camión sin enterarse:
 * el hueco vacío es información, y es más segura que un valor inventado.
 */

const CATEGORIAS: { id: VehicleCategory; label: string; ejemplo: string }[] = [
  { id: 'sedan',      label: 'Sedán',   ejemplo: 'Corolla, Civic' },
  { id: 'suv',        label: 'SUV',     ejemplo: 'CR-V, RAV4' },
  { id: 'jeep',       label: 'Jeep',    ejemplo: 'Grand Cherokee' },
  { id: 'pickup',     label: 'Pickup',  ejemplo: 'Hilux, Frontier' },
  { id: 'van',        label: 'Van',     ejemplo: 'Hiace, Sprinter' },
  { id: 'truck',      label: 'Camión',  ejemplo: 'Camión de reparto' },
  { id: 'motorcycle', label: 'Moto',    ejemplo: 'Cualquier motor' },
  { id: 'special',    label: 'Especial', ejemplo: 'Lo que no encaje arriba' }
];

export const NivelesMembego: React.FC<{ editable: boolean }> = ({ editable }) => {
  const [niveles, setNiveles] = useState<NivelesPorCategoria>({});
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Lo guardado, para saber qué cambió y no mandar el mapa entero cada vez.
  const [original, setOriginal] = useState<NivelesPorCategoria>({});

  useEffect(() => {
    fetchVehicleCategoryLevels()
      .then(m => { setNiveles(m); setOriginal(m); })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar los niveles'))
      .finally(() => setCargando(false));
  }, []);

  const cambiar = (cat: VehicleCategory, valor: string) => {
    setNiveles(prev => {
      const siguiente = { ...prev };
      const n = Number(valor);
      // Vacío vuelve a «sin configurar». Es un estado legítimo y hay que poder
      // volver a él: una categoría mal clasificada se corrige quitándola, no
      // dejándole un número que nadie sabe si es el bueno.
      if (valor === '' || !Number.isInteger(n) || n < 1 || n > 9) delete siguiente[cat];
      else siguiente[cat] = n;
      return siguiente;
    });
  };

  const sucio = CATEGORIAS.some(c => niveles[c.id] !== original[c.id]);

  const guardar = async () => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Solo lo que cambió. Una categoría que se vació viaja como null, que es
      // lo que la borra; una que no se tocó no viaja y se queda como estaba.
      const cambios: Partial<Record<VehicleCategory, number | null>> = {};
      for (const c of CATEGORIAS) {
        if (niveles[c.id] !== original[c.id]) cambios[c.id] = niveles[c.id] ?? null;
      }
      const guardado = await setVehicleCategoryLevels(cambios);
      setNiveles(guardado); setOriginal(guardado);
      setNotice('Niveles guardados. Membego ya los usa para decidir la cobertura.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los niveles');
    } finally {
      setBusy(false);
    }
  };

  const sinConfigurar = CATEGORIAS.filter(c => niveles[c.id] === undefined).length;

  return (
    <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
      <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
        <Layers className="w-4 h-4 text-brand" /> Niveles de vehículo en Membego
      </h3>

      <p className="text-xs text-muted leading-relaxed">
        Membego decide si una membresía cubre un carro comparando estos números
        con el tope del plan. Un plan de nivel 2 cubre todo lo que sea 1 o 2.
        Los niveles los define Membego en su catálogo; aquí se dice cuál le
        corresponde a cada categoría de este local.
      </p>

      {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}

      {cargando ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-canvas border border-line rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CATEGORIAS.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 bg-canvas border border-line rounded-xl px-3 py-2">
                <label htmlFor={`nivel-${c.id}`} className="min-w-0">
                  <span className="block text-sm font-bold text-strong">{c.label}</span>
                  <span className="block text-xs text-faint truncate">{c.ejemplo}</span>
                </label>
                <input
                  id={`nivel-${c.id}`}
                  type="number" min={1} max={9} inputMode="numeric"
                  value={niveles[c.id] ?? ''}
                  disabled={!editable || busy}
                  onChange={e => cambiar(c.id, e.target.value)}
                  placeholder="—"
                  className="w-16 flex-shrink-0 bg-surface border border-line rounded-lg px-2 py-1.5 text-center text-sm font-bold text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-60"
                />
              </div>
            ))}
          </div>

          {/* El hueco vacío es información: se dice en voz alta en vez de
              dejar que alguien suponga que vale 1. */}
          {sinConfigurar > 0 && (
            <p className="text-xs text-warning">
              {sinConfigurar === 1
                ? 'Queda 1 categoría sin nivel.'
                : `Quedan ${sinConfigurar} categorías sin nivel.`}{' '}
              Mientras no lo tengan, el mostrador no podrá decir si la membresía
              cubre esos vehículos — y no los dará por cubiertos.
            </p>
          )}

          {editable && (
            <div className="flex justify-end">
              <button
                onClick={() => void guardar()}
                disabled={busy || !sucio}
                className="flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold text-xs rounded-xl transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar niveles
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
