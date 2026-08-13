import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Modo día y modo noche.
 *
 * Tres estados, no dos. «Sistema» no es un adorno: es lo que hace que la
 * aplicación se ponga oscura sola cuando el teléfono del cajero entra en modo
 * noche a las siete de la tarde, sin que nadie toque nada. Y es el valor de
 * partida, porque la primera vez que alguien abre el sistema no tenemos ninguna
 * preferencia suya que respetar — la del sistema operativo ya la expresó.
 *
 * El tema se aplica poniendo `data-theme` en <html>. Sin atributo manda
 * `prefers-color-scheme`, que es exactamente lo que declara src/index.css. Los
 * colores no viven aquí: aquí solo se decide cuál de los dos juegos se usa.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
/** Lo que de verdad se está pintando, ya resuelto el caso «sistema». */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'membego.tema';

interface ThemeValue {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
  /** Alterna entre día y noche. Si estaba en «sistema», parte de lo que se ve. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function leerPreferencia(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // Navegador con almacenamiento bloqueado: no es motivo para no funcionar.
  }
  return 'system';
}

const consultaOscuro = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [choice, setChoiceState] = useState<ThemeChoice>(leerPreferencia);
  const [sistemaOscuro, setSistemaOscuro] = useState<boolean>(
    () => consultaOscuro()?.matches ?? true
  );

  // El sistema operativo puede cambiar mientras la aplicación está abierta.
  useEffect(() => {
    const mq = consultaOscuro();
    if (!mq) return;
    const alCambiar = (e: MediaQueryListEvent) => setSistemaOscuro(e.matches);
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  const resolved: ResolvedTheme =
    choice === 'system' ? (sistemaOscuro ? 'dark' : 'light') : choice;

  useEffect(() => {
    const raiz = document.documentElement;
    if (choice === 'system') {
      // Se quita el atributo a propósito: sin él manda la media query del CSS,
      // que es una sola fuente de verdad en vez de dos que hay que sincronizar.
      raiz.removeAttribute('data-theme');
    } else {
      raiz.setAttribute('data-theme', choice);
    }
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try { localStorage.setItem(STORAGE_KEY, c); } catch { /* sin persistencia */ }
  }, []);

  const toggle = useCallback(() => {
    setChoice(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setChoice]);

  return (
    <ThemeContext.Provider value={{ choice, resolved, setChoice, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
