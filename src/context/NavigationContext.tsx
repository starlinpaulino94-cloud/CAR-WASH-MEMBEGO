import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PATH, LEGACY_TABS, Module, SubModule,
  canSee, firstAvailable, pathFor, resolvePath
} from '../lib/navigation';
import { useAuth } from './AuthContext';

/**
 * Router liviano sobre la History API.
 *
 * La URL es la fuente de verdad: /modulo/submodulo. Eso da enlaces directos,
 * botón atrás/adelante y persistencia al recargar (Vercel reescribe toda ruta
 * no-API a index.html, y el dev server de Vite hace lo mismo). No se añade una
 * dependencia de router para un árbol de dos niveles.
 *
 * Persistencia: además de la URL, se recuerda el último submódulo visitado de
 * cada módulo, para que "ir a Caja" te devuelva a donde estabas dentro de Caja.
 */

const LAST_PATH_KEY = 'cw.nav.last';
const lastSubKey = (modId: string) => `cw.nav.mod.${modId}`;

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* modo privado */ }
  }
};

interface NavigationValue {
  path: string;
  mod: Module;
  sub: SubModule;
  /** Navega a una ruta ('/caja', '/caja/gastos') o a un tab legado ('cash'). */
  navigate: (target: string) => void;
  /** Sidebar contraído (escritorio). */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Drawer abierto (móvil). */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

/** Normaliza cualquier entrada a una ruta resoluble y permitida. */
function settle(target: string, profile: Parameters<typeof canSee>[0]): string {
  const asPath = LEGACY_TABS[target] ?? target;
  const hit = resolvePath(asPath);
  if (!hit) return DEFAULT_PATH;

  let { mod, sub } = hit;

  // Al entrar al módulo "pelado" (/caja), volver al último submódulo visitado.
  const bare = !asPath.replace(/^\/+|\/+$/g, '').includes('/');
  if (bare) {
    const remembered = store.get(lastSubKey(mod.id));
    const rememberedSub = remembered ? mod.items.find(s => s.slug === remembered) : undefined;
    if (rememberedSub) sub = rememberedSub;
  }

  // Guardas: un submódulo oculto al rol, o sin función, cae al primero útil.
  if (!canSee(profile, sub) || (!sub.view && !sub.pronto)) {
    const fallback = firstAvailable(profile, mod);
    if (!fallback) return DEFAULT_PATH;
    sub = fallback;
  }
  return pathFor(mod, sub);
}

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();

  const [path, setPath] = useState<string>(() => {
    const fromUrl = window.location.pathname;
    const initial = resolvePath(fromUrl) ? fromUrl : (store.get(LAST_PATH_KEY) ?? DEFAULT_PATH);
    return settle(initial, null);
  });

  // La URL del navegador refleja siempre el estado (replace en el arranque
  // para no ensuciar el historial con la redirección inicial).
  useEffect(() => {
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si el perfil llega después (login) y la ruta actual quedó vedada, reubicar.
  useEffect(() => {
    const settled = settle(path, profile);
    if (settled !== path) {
      setPath(settled);
      window.history.replaceState(null, '', settled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Atrás / adelante del navegador.
  useEffect(() => {
    const onPop = () => setPath(settle(window.location.pathname, profile));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [profile]);

  const navigate = useCallback((target: string) => {
    const next = settle(target, profile);
    setPath(prev => {
      if (next !== prev) window.history.pushState(null, '', next);
      return next;
    });
  }, [profile]);

  // Persistir: última ruta global y último submódulo por módulo.
  const resolved = useMemo(() => resolvePath(path) ?? resolvePath(DEFAULT_PATH)!, [path]);
  useEffect(() => {
    store.set(LAST_PATH_KEY, path);
    store.set(lastSubKey(resolved.mod.id), resolved.sub.slug);
  }, [path, resolved]);

  // Sidebar: colapso persistente (escritorio) y drawer (móvil).
  const [collapsed, setCollapsed] = useState(() => store.get('cw.nav.collapsed') === '1');
  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      store.set('cw.nav.collapsed', prev ? '0' : '1');
      return !prev;
    });
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Cambiar de ruta cierra el drawer móvil.
  useEffect(() => { setDrawerOpen(false); }, [path]);

  const value = useMemo<NavigationValue>(() => ({
    path, mod: resolved.mod, sub: resolved.sub, navigate,
    collapsed, toggleCollapsed, drawerOpen, setDrawerOpen
  }), [path, resolved, navigate, collapsed, toggleCollapsed, drawerOpen]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export function useNavigation(): NavigationValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation debe usarse dentro de NavigationProvider');
  return ctx;
}
