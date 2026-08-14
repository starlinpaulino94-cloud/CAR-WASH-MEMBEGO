import React from 'react';
import { ChevronRight, Home, Hammer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { useQueueCount } from '../../context/QueueCountContext';
import { useApp } from '../../context/AppContext';
import { DEFAULT_PATH, pathFor, visibleItems } from '../../lib/navigation';

/**
 * Página contenedora de un módulo.
 *
 * Estructura fija: breadcrumb + pestañas de submódulos arriba, contenido
 * debajo. El título, la descripción, la acción principal y los filtros los
 * pone cada vista (ya los tienen); esta capa solo aporta ubicación y
 * navegación secundaria, sin duplicar encabezados.
 */

const Breadcrumb: React.FC = () => {
  const { mod, sub, navigate } = useNavigation();
  return (
    <nav aria-label="Ruta de navegación" className="flex items-center gap-1.5 text-sm min-w-0">
      <a
        href={DEFAULT_PATH}
        onClick={e => { e.preventDefault(); navigate(DEFAULT_PATH); }}
        className="text-muted hover:text-strong flex items-center gap-1 shrink-0"
        aria-label="Inicio"
      >
        <Home className="w-4 h-4" />
      </a>
      <ChevronRight className="w-4 h-4 text-faint shrink-0" />
      <a
        href={`/${mod.pathId}`}
        onClick={e => { e.preventDefault(); navigate(`/${mod.pathId}`); }}
        className="text-muted hover:text-strong font-medium truncate"
      >
        {mod.label}
      </a>
      <ChevronRight className="w-4 h-4 text-faint shrink-0" />
      <span className="text-strong font-semibold truncate" aria-current="page">{sub.label}</span>
    </nav>
  );
};

const SubModuleTabs: React.FC = () => {
  const { mod, sub, navigate } = useNavigation();
  const { profile, phase } = useAuth();
  const { workOrders } = useApp();
  const { count: liveQueueCount } = useQueueCount();

  const queueCount = phase === 'demo'
    ? workOrders.filter(w => w.status !== 'entregado' && w.status !== 'cancelado').length
    : liveQueueCount ?? undefined;

  const items = visibleItems(profile, mod);
  // Con un único submódulo no hay nada que elegir: sin pestañas.
  if (items.length <= 1) return null;

  return (
    <nav aria-label="Submódulos" className="flex items-center gap-1 overflow-x-auto -mb-px">
      {items.map(item => {
        const isActive = item.slug === sub.slug;
        const badge = item.queueBadge && queueCount !== undefined && queueCount > 0
          ? queueCount : undefined;
        return (
          <a
            key={item.slug}
            href={pathFor(mod, item)}
            aria-current={isActive ? 'page' : undefined}
            onClick={e => { e.preventDefault(); navigate(pathFor(mod, item)); }}
            className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              isActive
                ? 'border-brand text-strong'
                : item.pronto
                  ? 'border-transparent text-faint hover:text-muted'
                  : 'border-transparent text-muted hover:text-strong hover:border-line-strong'
            }`}
          >
            {item.label}
            {badge !== undefined && (
              <span className="px-1.5 py-0.5 rounded-full bg-brand/30 text-brand-hi border border-brand/30 text-xs font-extrabold">
                {badge}
              </span>
            )}
            {item.pronto && (
              <span className="px-1.5 py-0.5 rounded bg-surface-2 text-faint text-xs font-bold uppercase tracking-wide">
                Pronto
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
};

/** Estado para submódulos planificados que aún no tienen función. */
export const ComingSoon: React.FC = () => {
  const { mod, sub, navigate } = useNavigation();
  return (
    <div className="p-6 max-w-lg mx-auto mt-10">
      <div className="bg-surface border border-line rounded-2xl p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-surface-2 grid place-items-center mx-auto">
          <Hammer className="w-7 h-7 text-faint" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-strong">{sub.label}: en preparación</h2>
          <p className="text-sm text-muted">
            {sub.hint ?? 'Este submódulo está planificado y llegará en una próxima fase.'}
          </p>
        </div>
        <button
          onClick={() => navigate(`/${mod.pathId}`)}
          className="px-4 py-2.5 bg-surface-2 hover:bg-surface-3 text-strong text-sm font-bold rounded-xl"
        >
          Volver a {mod.label}
        </button>
      </div>
    </div>
  );
};

export const ModulePage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sub } = useNavigation();
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 bg-canvas/95 backdrop-blur border-b border-line px-6 pt-4">
        <Breadcrumb />
        <div className="mt-2">
          <SubModuleTabs />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {sub.pronto ? <ComingSoon /> : children}
      </div>
    </div>
  );
};
