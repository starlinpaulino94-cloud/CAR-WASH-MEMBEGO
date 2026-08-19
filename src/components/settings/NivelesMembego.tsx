import React, { useEffect, useState } from 'react';
import { Layers, Loader2, Save } from 'lucide-react';
import {
  fetchVehicleCategoryLevels, setVehicleCategoryLevels, fetchNivelesDeMembego,
  NivelesPorCategoria, VehicleCategory, NivelesDeMembego
} from '../../data/adminRepository';
import { InlineAlert } from '../common/DataViewShell';
import { Button } from '../ui/button';

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
  /*
   * Los niveles que Membego usa DE VERDAD.
   *
   * Antes esta pantalla pedía ocho números que el usuario no tenía de dónde
   * sacar, y un nivel que en Membego no existe no casa con nada: cobraría mal
   * para siempre y el cliente solo vería «no cubierto».
   *
   * `null` = no se pudieron consultar. Es una ayuda para mapear, no un
   * requisito: que Membego esté caído no impide guardar los niveles.
   */
  const [membego, setMembego] = useState<NivelesDeMembego | null>(null);

  useEffect(() => {
    fetchVehicleCategoryLevels()
      .then(m => { setNiveles(m); setOriginal(m); })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar los niveles'))
      .finally(() => setCargando(false));
    // En paralelo y sin bloquear: si Membego no contesta, la tabla funciona igual.
    void fetchNivelesDeMembego().then(setMembego);
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

      {/*
       * Los niveles REALES de Membego, cuando se pueden consultar.
       *
       * Antes aquí había una advertencia estática que decía «puede que en
       * Membego estén todos en 1». Ahora se pregunta y se sabe: enseñar el
       * catálogo de allá convierte ocho casillas a ciegas en un mapeo mirando.
       */}
      {membego && membego.tipos.length > 0 && (
        <div className="border border-line rounded-lg p-3 space-y-2 bg-canvas/50">
          <span className="text-xs font-semibold text-muted uppercase">
            Los niveles que usa Membego
          </span>
          <div className="flex flex-wrap gap-1.5">
            {membego.tipos.map(t => (
              <span key={t.id}
                className="px-2 py-0.5 rounded-md text-xs border bg-surface border-line text-body">
                {t.nombre} <strong className="text-strong">· {t.nivelTarifario}</strong>
              </span>
            ))}
          </div>
          {/* Este es el aviso que de verdad importa, y ahora se da con dato en
              la mano en vez de por si acaso. */}
          {membego.sinDiferenciar && (
            <p className="text-xs text-warning">
              <strong>Todos están en nivel 1</strong>, que es el valor de fábrica.
              Mientras siga así, cualquier plan cubre cualquier vehículo y aquí no
              se cobrará ninguna diferencia. Los niveles se diferencian en Membego,
              en Panel → App → Car wash → Catálogo → Tipos de vehículo.
            </p>
          )}
        </div>
      )}

      {/* Sin respuesta de Membego se dice, en vez de callar y dejar que alguien
          crea que su catálogo está vacío. */}
      {membego === null && (
        <p className="text-xs text-faint">
          No se pudieron consultar los niveles de Membego. Puede guardar igual: la
          tabla funciona sin ellos, solo que sin la lista de referencia al lado.
        </p>
      )}

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
                  className="w-16 flex-shrink-0 rounded-lg border border-input bg-transparent px-2 py-1.5 text-center text-sm font-bold text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30"
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
              <Button onClick={() => void guardar()} disabled={busy || !sucio}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                Guardar niveles
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
