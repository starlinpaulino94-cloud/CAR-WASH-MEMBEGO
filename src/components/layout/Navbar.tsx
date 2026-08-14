import React, { useEffect, useRef, useState } from 'react';
import { User, LogOut, ExternalLink, Loader2, Menu, Settings, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabase';

// Portal de Membego (el hub de fidelización). Respaldo si el SSO no está
// disponible (sesión demo, config pendiente, etc.).
const MEMBEGO_URL = 'https://membego.com';

/**
 * Barra superior.
 *
 * Se dejó en lo que de verdad tiene que estar siempre a la vista: quién eres,
 * dónde estás y la salida a Membego. Lo demás se fue a su sitio —el tema, a
 * Configuración › Apariencia; «Nueva llegada», al módulo de Operaciones, donde
 * ya existía el mismo botón—. La sucursal aparecía dos veces, bajo el nombre de
 * la empresa y otra vez en una etiqueta al lado: se quedó una.
 *
 * El criterio: una cabecera es un sitio caro. Cada cosa que vive ahí compite
 * por la atención con las demás, todo el día, en todas las pantallas. Un ajuste
 * que se toca una vez no paga ese alquiler.
 */

export const Navbar: React.FC = () => {
  const { phase, profile, company: realCompany, branch: realBranch, signOut } = useAuth();
  const { setDrawerOpen, navigate } = useNavigation();
  const authenticated = phase === 'ready';

  // "Ir a Membego": con sesión real pide un pase de SSO y aterriza al usuario
  // logueado en Membego. Sin sesión (o si algo falla), abre membego.com.
  const [yendoMembego, setYendoMembego] = useState(false);
  const irAMembego = async () => {
    if (yendoMembego) return;
    // Abrir la pestaña YA, dentro del gesto del clic, para no toparse con el
    // bloqueo de pop-ups tras el await. OJO: NO usar 'noopener' aquí — con esa
    // opción el navegador devuelve null y la pestaña se queda en blanco. Abrimos
    // con handle y luego anulamos el opener a mano (misma protección).
    const tab = window.open('about:blank', '_blank');
    const irA = (destino: string) => {
      if (tab && !tab.closed) {
        try { (tab as { opener: unknown }).opener = null; } catch { /* no crítico */ }
        tab.location.href = destino;
      } else {
        // El navegador bloqueó la pestaña: navegamos en la actual como respaldo.
        window.location.href = destino;
      }
    };
    if (!authenticated || !supabase) { irA(MEMBEGO_URL); return; }
    setYendoMembego(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('sin token');
      const res = await fetch('/api/ir-a-membego', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string };
      irA(res.ok && body.url ? body.url : MEMBEGO_URL);
    } catch {
      irA(MEMBEGO_URL);
    } finally {
      setYendoMembego(false);
    }
  };


  // Menú de la cuenta. El rol y la sucursal siguen estando —hacen falta para
  // saber con qué permisos se está trabajando— pero a un clic, no gritando
  // desde la barra en todas las pantallas.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAbierto) return;
    const fuera = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [menuAbierto]);

  return (
    <header className="bg-surface border-b border-line sticky top-0 z-30 px-4 py-2.5 flex items-center justify-between gap-3 text-strong">
      {/* Identidad del local */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Hamburguesa: abre el menú (drawer) en pantallas pequeñas. */}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menú"
          className="md:hidden p-2 -ml-1 text-body hover:text-strong rounded-lg hover:bg-surface-2"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-tr from-brand to-accent flex items-center justify-center font-black text-lg shadow-lg shadow-brand/30 text-strong">
          M
        </div>
        <div className="min-w-0">
          <h1 className="font-bold text-[15px] tracking-tight truncate">
            {realCompany?.trade_name}
          </h1>
          {realBranch?.name && (
            <p className="text-xs text-muted truncate">{realBranch.name}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Lo único que queda: la salida a Membego. Con sesión, entra logueado
            vía SSO; sin ella, al portal público. */}
        <button
          onClick={() => void irAMembego()}
          disabled={yendoMembego}
          title="Entrar a Membego (tu cuenta) en una pestaña nueva"
          className="flex items-center gap-2 px-4 py-2 bg-warning hover:bg-warning disabled:opacity-70 text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-warning/30 transition-colors"
        >
          {yendoMembego ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
          <span className="hidden sm:inline">Ir a Membego</span>
        </button>

        {/* Cuenta. NO hay selector de usuario: cambiar de identidad exige
            iniciar sesión. El desplegable que hubo aquí permitía convertirse en
            propietario con dos clics (§7.1 de la auditoría); este solo informa
            y deja salir. */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuAbierto(v => !v)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            aria-label={`Cuenta de ${profile?.full_name ?? 'usuario'}`}
            className="flex items-center gap-1.5 bg-canvas border border-line hover:border-line-strong rounded-xl px-2.5 py-1.5 text-xs transition-colors"
          >
            <User className="w-4 h-4 text-brand flex-shrink-0" />
            <span className="text-body font-medium max-w-[130px] truncate hidden sm:inline">
              {profile?.full_name}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform ${menuAbierto ? 'rotate-180' : ''}`} />
          </button>

          {menuAbierto && (
            <div role="menu"
              className="absolute right-0 mt-2 w-60 bg-surface border border-line rounded-xl shadow-2xl overflow-hidden">
              <div className="px-3 py-2.5 border-b border-line">
                <p className="font-bold text-sm text-strong truncate">{profile?.full_name}</p>
                <p className="text-xs text-muted capitalize">
                  {profile?.role}
                  {realBranch?.name && <> · {realBranch.name}</>}
                </p>
              </div>
              <button
                role="menuitem"
                onClick={() => { setMenuAbierto(false); navigate('/configuracion/apariencia'); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-body hover:bg-surface-2 transition-colors"
              >
                <Settings className="w-4 h-4 text-muted" /> Apariencia y ajustes
              </button>
              <button
                role="menuitem"
                onClick={() => void signOut()}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-danger hover:bg-danger/10 border-t border-line transition-colors"
              >
                <LogOut className="w-4 h-4" /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
