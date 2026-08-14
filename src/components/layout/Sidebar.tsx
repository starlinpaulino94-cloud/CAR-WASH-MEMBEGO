import React from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { useQueueCount } from '../../context/QueueCountContext';
import { visibleModules } from '../../lib/navigation';

/**
 * Barra lateral: SOLO módulos principales.
 *
 * Los submódulos viven dentro de cada módulo (pestañas de ModulePage), no
 * aquí: el menú anterior listaba 16 pantallas a la vez y era imposible de
 * recorrer. En escritorio se puede contraer a iconos (con tooltip); en móvil
 * es un drawer que abre la hamburguesa del Navbar.
 */

const NavList: React.FC<{ iconsOnly?: boolean }> = ({ iconsOnly = false }) => {
  const { path, navigate } = useNavigation();
  const { profile, phase } = useAuth();
  const { count: liveQueueCount } = useQueueCount();

  // Contador de órdenes activas: de la base con sesión real; local en demo.
  const queueCount = liveQueueCount;

  const modules = visibleModules(profile);
  const activeModId = path.split('/')[1];

  return (
    <nav aria-label="Módulos" className="flex-1 overflow-y-auto p-3 space-y-1">
      {modules.map(mod => {
        const Icon = mod.icon;
        const isActive = mod.pathId === activeModId;
        const badge = mod.queueBadge && queueCount !== undefined && queueCount > 0
          ? queueCount : undefined;
        return (
          <a
            key={mod.id}
            href={`/${mod.pathId}`}
            title={iconsOnly ? mod.label : undefined}
            aria-current={isActive ? 'page' : undefined}
            onClick={e => { e.preventDefault(); navigate(`/${mod.pathId}`); }}
            className={`group relative flex items-center rounded-xl font-semibold transition-colors ${
              iconsOnly ? 'justify-center px-0 py-3' : 'justify-between px-3.5 py-2.5'
            } text-[15px] ${
              isActive
                ? 'bg-brand text-on-accent shadow-lg shadow-brand/30'
                : 'text-body hover:text-strong hover:bg-surface-2/70'
            }`}
          >
            <span className={`flex items-center ${iconsOnly ? '' : 'gap-3'}`}>
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-strong' : 'text-muted group-hover:text-body'}`} />
              {!iconsOnly && <span>{mod.label}</span>}
            </span>

            {badge !== undefined && !iconsOnly && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                isActive ? 'bg-surface text-brand' : 'bg-brand/30 text-brand-hi border border-brand/30'
              }`}>
                {badge}
              </span>
            )}
            {badge !== undefined && iconsOnly && (
              <span className="absolute top-1.5 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-on-accent text-xs font-extrabold grid place-items-center">
                {badge}
              </span>
            )}

            {/* Tooltip propio al estar contraído (además del title nativo). */}
            {iconsOnly && (
              <span className="pointer-events-none absolute left-full ml-2 z-50 hidden group-hover:block whitespace-nowrap rounded-lg bg-surface-2 border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-strong shadow-xl">
                {mod.label}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
};

export const Sidebar: React.FC = () => {
  const { collapsed, toggleCollapsed, drawerOpen, setDrawerOpen } = useNavigation();

  return (
    <>
      {/* ---- Escritorio: columna fija, colapsable ---- */}
      <aside
        className={`hidden md:flex flex-col flex-shrink-0 h-full bg-surface/90 border-r border-line transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-60'
        }`}
      >
        <NavList iconsOnly={collapsed} />
        <div className="p-3 border-t border-line">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expandir menú' : 'Contraer menú'}
            aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
            className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-muted hover:text-strong hover:bg-surface-2/70 ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
            {!collapsed && <span>Contraer</span>}
          </button>
        </div>
      </aside>

      {/* ---- Móvil: drawer sobre la página ---- */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            aria-label="Cerrar menú"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-surface border-r border-line flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-line">
              <span className="font-bold text-strong">Menú</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Cerrar menú"
                className="p-2 text-muted hover:text-strong rounded-lg hover:bg-surface-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavList />
          </aside>
        </div>
      )}
    </>
  );
};
