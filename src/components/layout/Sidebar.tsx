import React from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
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
  const { workOrders } = useApp();
  const { count: liveQueueCount } = useQueueCount();

  // Contador de órdenes activas: de la base con sesión real; local en demo.
  const queueCount = phase === 'demo'
    ? workOrders.filter(w => w.status !== 'entregado' && w.status !== 'cancelado').length
    : liveQueueCount ?? undefined;

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
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
            }`}
          >
            <span className={`flex items-center ${iconsOnly ? '' : 'gap-3'}`}>
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />
              {!iconsOnly && <span>{mod.label}</span>}
            </span>

            {badge !== undefined && !iconsOnly && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                isActive ? 'bg-white text-indigo-700' : 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30'
              }`}>
                {badge}
              </span>
            )}
            {badge !== undefined && iconsOnly && (
              <span className="absolute top-1.5 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-500 text-white text-xs font-extrabold grid place-items-center">
                {badge}
              </span>
            )}

            {/* Tooltip propio al estar contraído (además del title nativo). */}
            {iconsOnly && (
              <span className="pointer-events-none absolute left-full ml-2 z-50 hidden group-hover:block whitespace-nowrap rounded-lg bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xl">
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
        className={`hidden md:flex flex-col flex-shrink-0 h-full bg-slate-900/90 border-r border-slate-800 transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-60'
        }`}
      >
        <NavList iconsOnly={collapsed} />
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expandir menú' : 'Contraer menú'}
            aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
            className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-800/70 ${
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
          <aside className="relative w-72 max-w-[85vw] h-full bg-slate-900 border-r border-slate-800 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <span className="font-bold text-white">Menú</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Cerrar menú"
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
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
