import React from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTheme, ThemeChoice } from '../../context/ThemeContext';
import { ViewHeader } from '../common/DataViewShell';

/**
 * Apariencia.
 *
 * El tema vivía en la barra superior, con sus tres botones y sus tres rótulos
 * siempre a la vista. Es una preferencia que cada quien toca una vez y no
 * vuelve a mirar: ocupar sitio permanente en la cabecera, al lado de las
 * acciones del día, era darle a un ajuste la importancia de una tarea. Aquí,
 * junto al resto de la configuración, cada opción cabe con su explicación.
 *
 * La preferencia sigue siendo por navegador (`localStorage`), no de la empresa:
 * el turno de noche puede querer la pantalla oscura sin imponérsela al de la
 * mañana en otra caja.
 */

const OPCIONES: {
  id: ThemeChoice;
  label: string;
  detalle: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'light',
    label: 'Día',
    detalle: 'Fondo claro. Es lo que mejor se lee con el sol entrando al local.',
    icon: <Sun className="w-5 h-5" />
  },
  {
    id: 'dark',
    label: 'Noche',
    detalle: 'Fondo oscuro. Cansa menos la vista en turnos de noche.',
    icon: <Moon className="w-5 h-5" />
  },
  {
    id: 'system',
    label: 'Como el sistema',
    detalle: 'Sigue al equipo: se oscurece solo cuando el equipo se oscurece.',
    icon: <Monitor className="w-5 h-5" />
  }
];

export const AppearanceSettingsView: React.FC = () => {
  const { choice, resolved, setChoice } = useTheme();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <ViewHeader
        title="Apariencia"
        subtitle="Tema de la pantalla. Se guarda en este equipo, no para toda la empresa."
      />

      <section className="bg-surface border border-line rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2">Tema</h3>

        <div role="radiogroup" aria-label="Tema de la interfaz" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {OPCIONES.map(o => {
            const activo = choice === o.id;
            return (
              <button
                key={o.id}
                role="radio"
                aria-checked={activo}
                onClick={() => setChoice(o.id)}
                className={`text-left p-4 rounded-xl border transition-colors ${
                  activo
                    ? 'bg-brand-soft/40 border-brand text-strong'
                    : 'bg-canvas border-line text-body hover:border-line-strong'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={activo ? 'text-brand-hi' : 'text-muted'}>{o.icon}</span>
                  {activo && <Check className="w-4 h-4 text-brand-hi" />}
                </span>
                <span className="block font-bold text-sm mt-2">{o.label}</span>
                <span className="block text-xs text-muted mt-1 leading-relaxed">{o.detalle}</span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-faint">
          Ahora mismo se está viendo el modo {resolved === 'dark' ? 'noche' : 'día'}.
        </p>
      </section>
    </div>
  );
};
