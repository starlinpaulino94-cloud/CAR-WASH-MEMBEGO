import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { ACTIVE_STATUSES } from '../data/ordersRepository';

interface QueueCountValue {
  /** Vehículos en taller ahora mismo. `null` mientras no se sabe. */
  count: number | null;
  /** Fuerza una relectura. La llaman las vistas tras mover una orden. */
  refresh: () => void;
}

const QueueCountContext = createContext<QueueCountValue>({ count: null, refresh: () => {} });

/** Cada cuánto se revisa por si otro dispositivo movió la cola. */
const POLL_MS = 60_000;

/**
 * Contador de la cola activa para el badge de la barra lateral.
 *
 * Se consulta con `head: true`: PostgREST devuelve solo la cabecera con el
 * total, sin transferir una sola fila. Contar trayéndose las órdenes sería
 * repetir el error de la versión auditada, que calculaba este número
 * recorriendo el array completo en cada render (§3.2).
 *
 * Se refresca en tres momentos: al cambiar de sucursal, cuando una vista avisa
 * de que movió algo, y en un sondeo lento como red de seguridad para los
 * cambios hechos desde otro dispositivo. El sondeo desaparecerá cuando el
 * tablero use Realtime.
 */
export const QueueCountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { phase, branch } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (phase !== 'ready' || !branch || !supabase) {
      setCount(null);
      return;
    }

    let active = true;

    const read = async () => {
      const { count: total, error } = await supabase
        .from('work_orders')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', branch.id)
        .in('status', ACTIVE_STATUSES);

      // Un fallo aquí no debe romper nada: es un adorno informativo, no un
      // dato operativo. Se deja el valor anterior y se reintenta al siguiente
      // ciclo.
      if (active && !error) setCount(total ?? 0);
    };

    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);

    // Al volver a la pestaña, el número puede estar obsoleto: se relee.
    const onVisible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, branch, nonce]);

  const value = useMemo<QueueCountValue>(() => ({ count, refresh }), [count, refresh]);

  return <QueueCountContext.Provider value={value}>{children}</QueueCountContext.Provider>;
};

export const useQueueCount = (): QueueCountValue => useContext(QueueCountContext);
