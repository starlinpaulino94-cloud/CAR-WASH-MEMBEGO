import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, ThemeChoice } from '../../context/ThemeContext';

/**
 * Selector de tema: día, noche o el del sistema.
 *
 * Se ofrecen los tres y no un interruptor de dos, porque «sistema» es el que
 * hace que la pantalla se oscurezca sola al anochecer sin que el cajero tenga
 * que acordarse. Un interruptor de dos posiciones obliga a elegir para siempre.
 *
 * Cada opción lleva icono Y nombre accesible: un grupo de tres soles sin
 * etiqueta no se puede usar con lector de pantalla, y el sistema de diseño lo
 * exige para todo icono suelto.
 */
const OPCIONES: { id: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { id: 'light',  label: 'Modo día',     icon: <Sun className="w-4 h-4" /> },
  { id: 'dark',   label: 'Modo noche',   icon: <Moon className="w-4 h-4" /> },
  { id: 'system', label: 'Como el sistema', icon: <Monitor className="w-4 h-4" /> }
];

export const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { choice, setChoice } = useTheme();

  return (
    <div role="group" aria-label="Tema de la interfaz"
      className="inline-flex items-center gap-0.5 bg-surface-2 border border-line rounded-xl p-0.5">
      {OPCIONES.map(o => (
        <button
          key={o.id}
          onClick={() => setChoice(o.id)}
          aria-pressed={choice === o.id}
          aria-label={o.label}
          title={o.label}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold transition-colors ${
            choice === o.id
              ? 'bg-brand text-on-accent'
              : 'text-muted hover:text-strong hover:bg-surface-3'
          }`}
        >
          {o.icon}
          {!compact && <span className="hidden lg:inline">{o.label.replace('Modo ', '')}</span>}
        </button>
      ))}
    </div>
  );
};
