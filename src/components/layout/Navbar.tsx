import React, { useState } from 'react';
import { Building2, User, Plus, LogOut, ExternalLink, Loader2, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabase';
import { ThemeToggle } from '../common/ThemeToggle';

// Portal de Membego (el hub de fidelización). Respaldo si el SSO no está
// disponible (sesión demo, config pendiente, etc.).
const MEMBEGO_URL = 'https://membego.com';

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


  return (
    <header className="bg-surface border-b border-line sticky top-0 z-30 px-4 py-2.5 flex items-center justify-between text-strong">
      {/* Brand & Branch */}
      <div className="flex items-center gap-4">
        {/* Hamburguesa: abre el menú (drawer) en pantallas pequeñas. */}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menú"
          className="md:hidden p-2 -ml-1 text-body hover:text-strong rounded-lg hover:bg-surface-2"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand to-accent flex items-center justify-center font-black text-lg shadow-lg shadow-brand/30 text-strong">
            M
          </div>
          <div>
            <h1 className="font-bold text-[15px] tracking-tight">
              {realCompany?.trade_name}
            </h1>
            {realBranch?.name && (
              <p className="text-xs text-muted">{realBranch.name}</p>
            )}
          </div>
        </div>

        {/* Sucursal. Con sesión real es un dato del perfil, no algo elegible:
            la sucursal la determina la asignación del usuario, y RLS la aplica. */}
        <div className="hidden md:flex items-center gap-1.5 bg-canvas border border-line rounded-xl px-3 py-1.5 text-xs text-body font-medium">
          <Building2 className="w-3.5 h-3.5 text-muted" />
          {realBranch?.name ?? 'Sin sucursal'}
        </div>
      </div>

      {/* Center Actions */}
      <div className="flex items-center gap-2">
        <ThemeToggle />

        <button
          onClick={() => navigate('/operaciones/ordenes')}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand to-accent hover:from-brand hover:to-accent text-strong font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-all transform hover:scale-[1.02]"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Llegada</span>
        </button>

        {/* Acceso directo a Membego. Ámbar para que resalte y se distinga de la
            acción principal (morada). Con sesión, entra logueado vía SSO. */}
        <button
          onClick={() => void irAMembego()}
          disabled={yendoMembego}
          title="Entrar a Membego (tu cuenta) en una pestaña nueva"
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-warning to-warning hover:from-warning hover:to-warning disabled:opacity-70 text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-warning/30 transition-all transform hover:scale-[1.02]"
        >
          {yendoMembego ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
          <span>Ir a Membego</span>
        </button>
      </div>

      {/* Right Controls: Identidad */}
      <div className="flex items-center gap-3">
        {/* Identidad. NO hay selector de usuario: cambiar de identidad exige
            iniciar sesión. El desplegable que hubo aquí permitía convertirse en
            propietario con dos clics (§7.1 de la auditoría). */}
        <div className="flex items-center gap-2 bg-canvas border border-line rounded-xl px-2.5 py-1 text-xs">
          <User className="w-3.5 h-3.5 text-brand" />
          <span className="text-body font-medium max-w-[150px] truncate">
            {profile?.full_name}
          </span>
          <span className="text-xs text-faint uppercase">{profile?.role}</span>
          <button
            onClick={() => void signOut()}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="p-1 text-muted hover:text-danger transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
