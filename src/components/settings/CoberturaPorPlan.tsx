import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import {
  fetchPlanesMembego, asignarLavadoDelPlan, PlanConCobertura
} from '../../data/membegoRepository';
import { fetchServiciosIncluiblesMembego, ServicioIncluible } from '../../data/adminRepository';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { InlineAlert } from '../common/DataViewShell';

/**
 * Qué lavado incluye cada plan de Membego.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA, SI YA HAY UNA CASILLA
 *
 * La casilla «Incluido en el beneficio Membego» dice que un lavado lo PUEDE
 * pagar una membresía. No dice CUÁL. Con solo eso, marcar el premium hace que
 * el plan más barato lo absorba entero: el lavadero regala la diferencia en
 * cada visita y nada lo delata, porque la factura sale cuadrada.
 *
 * Aquí se dice qué lavado incluye cada plan. En la caja, ese lavado es el TOPE:
 * si al cliente se le hace uno mejor, la membresía pone lo que valía el suyo y
 * la diferencia se cobra sola.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS PLANES NO SE ESCRIBEN, SE ELIGEN
 *
 * La lista sale de las membresías que han llegado de Membego, no de un campo de
 * texto. Un nombre de plan mal tecleado no casa con nada, y el fallo no aparece
 * aquí: aparece días después, en la caja, cobrando de más a un socio y sin
 * ninguna pista de dónde mirar.
 */
export const CoberturaPorPlan: React.FC = () => {
  const { profile } = useAuth();
  const puedeEditar = can(profile, 'manageCatalog');

  const [planes, setPlanes] = useState<PlanConCobertura[]>([]);
  const [incluibles, setIncluibles] = useState<ServicioIncluible[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetchPlanesMembego(),
      fetchServiciosIncluiblesMembego().catch(() => [] as ServicioIncluible[])
    ]);
    setPlanes(p);
    setIncluibles(s);
  }, []);

  useEffect(() => {
    let vivo = true;
    recargar()
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudieron cargar los planes'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [recargar]);

  const asignar = async (plan: string, serviceId: string | null) => {
    if (!puedeEditar || guardando) return;
    setGuardando(plan);
    setError(null);
    try {
      await asignarLavadoDelPlan(plan, serviceId);
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardando(null);
    }
  };

  const sinAsignar = planes.filter(p => !p.service_id).length;

  return (
    <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
      <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
        <BadgeCheck className="w-4 h-4 text-brand" /> Qué lavado incluye cada plan
      </h3>

      <p className="text-xs text-muted leading-relaxed">
        El lavado que elija aquí es el <strong>tope</strong> de ese plan. Si al
        cliente se le hace uno mejor, la membresía pone lo que valía el suyo y la
        caja cobra la diferencia sola. Un plan sin lavado asignado sigue
        cubriendo el lavado completo, como hasta ahora.
      </p>

      {cargando && (
        <p className="text-xs text-faint flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Consultando los planes…
        </p>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {!cargando && !error && planes.length === 0 && (
        <p className="text-xs text-faint italic py-2">
          Todavía no ha llegado ninguna membresía de Membego, así que no hay
          planes que configurar. Aparecerán solos en cuanto un cliente con plan
          entre por aquí.
        </p>
      )}

      {!cargando && !error && planes.length > 0 && (
        <>
          {sinAsignar > 0 && (
            <InlineAlert tone="warning">
              <strong>{sinAsignar} {sinAsignar === 1 ? 'plan' : 'planes'} sin lavado
              asignado.</strong> Esos planes cubren el lavado completo, sea cual
              sea: un cliente con el plan más barato puede llevarse el lavado más
              caro sin pagar diferencia.
            </InlineAlert>
          )}

          <div className="space-y-2">
            {planes.map(p => (
              <div key={p.plan_name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/40 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-strong break-words">{p.plan_name}</p>
                  <p className="text-xs text-faint">
                    {p.clientes} {p.clientes === 1 ? 'cliente' : 'clientes'}
                    {!p.service_id && ' · sin lavado asignado'}
                  </p>
                </div>
                <select
                  value={p.service_id ?? ''}
                  disabled={!puedeEditar || guardando === p.plan_name}
                  onChange={e => void asignar(p.plan_name, e.target.value || null)}
                  aria-label={`Lavado incluido en ${p.plan_name}`}
                  className="p-2 text-xs rounded-lg border border-input bg-transparent text-foreground outline-none focus-visible:border-ring disabled:opacity-60 max-w-full"
                >
                  <option value="">Cubre el lavado completo</option>
                  {incluibles.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {incluibles.length === 0 && (
            <p className="text-xs text-warning">
              No hay ningún servicio marcado como «Incluido en el beneficio
              Membego», así que no hay nada que elegir. Márquelos arriba.
            </p>
          )}
        </>
      )}
    </section>
  );
};
