import React from 'react';
import { AlertTriangle, Database } from 'lucide-react';
import { useApp } from '../../context/AppContext';

/**
 * Aviso persistente y no descartable sobre el estado del almacenamiento local.
 *
 * Existe porque el modo de fallo anterior era el peor posible para un sistema de
 * caja: al agotarse la cuota del navegador, `setItem` lanzaba dentro de un
 * useEffect sin capturar y la escritura se perdía en silencio. El cajero seguía
 * cobrando durante horas creyendo que todo quedaba registrado.
 *
 * Se muestra en dos momentos: de forma preventiva al acercarse al límite, y de
 * forma crítica cuando una escritura ya ha fallado.
 */
export const StorageAlertBanner: React.FC = () => {
  const { storageStatus, storageUsageRatio } = useApp();

  const isCritical = storageStatus.kind !== 'ok';
  const isNearLimit = !isCritical && storageUsageRatio >= 0.8;

  if (!isCritical && !isNearLimit) return null;

  const percent = Math.min(100, Math.round(storageUsageRatio * 100));

  if (isNearLimit) {
    return (
      <div
        role="status"
        className="bg-amber-950/60 border-b border-amber-500/40 px-4 py-2.5 flex items-start sm:items-center gap-3 text-amber-200"
      >
        <Database className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5 sm:mt-0" />
        <p className="text-xs leading-relaxed">
          <strong className="font-bold">Almacenamiento local al {percent}% de su capacidad.</strong>{' '}
          Este dispositivo guarda los datos en el navegador y tiene un límite. Al alcanzarlo
          dejarán de registrarse órdenes y facturas. Exporte o respalde la información y
          contacte al administrador del sistema.
        </p>
      </div>
    );
  }

  const message =
    storageStatus.kind === 'quota_exceeded'
      ? 'Se agotó el espacio de almacenamiento del navegador. Las órdenes y facturas nuevas YA NO SE ESTÁN GUARDANDO y se perderán al cerrar o recargar esta página.'
      : storageStatus.kind === 'unavailable'
      ? 'El navegador no permite guardar datos en este dispositivo (puede ser el modo privado o una restricción de seguridad). Nada de lo que registre se conservará al recargar.'
      : 'No se pudieron guardar los últimos cambios en este dispositivo. La información registrada a partir de ahora puede perderse al recargar.';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-rose-950/70 border-b border-rose-500/50 px-4 py-3 flex items-start gap-3 text-rose-100"
    >
      <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-rose-300">
          Los datos no se están guardando
        </p>
        <p className="text-xs leading-relaxed">
          {message}{' '}
          <strong className="font-bold">
            No continúe cobrando en este dispositivo hasta resolverlo.
          </strong>
        </p>
      </div>
    </div>
  );
};
