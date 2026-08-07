import React, { useState } from 'react';
import { Building2, User, Plus, LogOut, ExternalLink, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

// Portal de Membego (el hub de fidelización). Respaldo si el SSO no está
// disponible (sesión demo, config pendiente, etc.).
const MEMBEGO_URL = 'https://membego.com';

export const Navbar: React.FC = () => {
  const { phase, profile, company: realCompany, branch: realBranch, signOut } = useAuth();
  const authenticated = phase === 'ready';

  // "Ir a Membego": con sesión real pide un pase de SSO y aterriza al usuario
  // logueado en Membego. Sin sesión (o si algo falla), abre membego.com.
  const [yendoMembego, setYendoMembego] = useState(false);
  const irAMembego = async () => {
    if (yendoMembego) return;
    // Abrir la pestaña YA, dentro del gesto del clic, para no toparse con el
    // bloqueo de pop-ups tras el await. Luego se le fija el destino.
    const tab = window.open('', '_blank', 'noopener,noreferrer');
    if (!authenticated || !supabase) {
      if (tab) tab.location.href = MEMBEGO_URL;
      return;
    }
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
      const destino = res.ok && body.url ? body.url : MEMBEGO_URL;
      if (tab) tab.location.href = destino; else window.open(destino, '_blank', 'noopener,noreferrer');
    } catch {
      if (tab) tab.location.href = MEMBEGO_URL; else window.open(MEMBEGO_URL, '_blank', 'noopener,noreferrer');
    } finally {
      setYendoMembego(false);
    }
  };

  const {
    company,
    branches,
    currentBranch,
    setCurrentBranch,
    currentUser,
    users,
    setCurrentUser,
    setIsNuevaLlegadaOpen
  } = useApp();

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 px-4 py-2.5 flex items-center justify-between text-white">
      {/* Brand & Branch */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-black text-lg shadow-lg shadow-indigo-600/30 text-white">
            M
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight">
              {authenticated ? realCompany?.trade_name : company.tradeName}
            </h1>
            {authenticated && realBranch?.name && (
              <p className="text-[11px] text-slate-400">{realBranch.name}</p>
            )}
          </div>
        </div>

        {/* Sucursal. Con sesión real es un dato del perfil, no algo elegible:
            la sucursal la determina la asignación del usuario, y RLS la aplica. */}
        {authenticated ? (
          <div className="hidden md:flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-medium">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            {realBranch?.name ?? 'Sin sucursal'}
          </div>
        ) : (
        <div className="hidden md:flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
          <Building2 className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={currentBranch.id}
            onChange={e => {
              const b = branches.find(br => br.id === e.target.value);
              if (b) setCurrentBranch(b);
            }}
            className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
          >
            {branches.map(b => (
              <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                {b.name}
              </option>
            ))}
          </select>
        </div>
        )}
      </div>

      {/* Center Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsNuevaLlegadaOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all transform hover:scale-[1.02]"
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
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-70 text-slate-900 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/30 transition-all transform hover:scale-[1.02]"
        >
          {yendoMembego ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
          <span>Ir a Membego</span>
        </button>
      </div>

      {/* Right Controls: Identidad */}
      <div className="flex items-center gap-3">
        {/* Identidad. Autenticado NO hay selector: cambiar de usuario exige
            iniciar sesión. El desplegable de la demo permitía convertirse en
            propietario con dos clics (§7.1 de la auditoría). */}
        {authenticated ? (
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs">
            <User className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-200 font-medium max-w-[150px] truncate">
              {profile?.full_name}
            </span>
            <span className="text-[10px] text-slate-500 uppercase">{profile?.role}</span>
            <button
              onClick={() => void signOut()}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs">
          <User className="w-3.5 h-3.5 text-indigo-400" />
          <select
            value={currentUser.id}
            onChange={e => {
              const u = users.find(usr => usr.id === e.target.value);
              if (u) setCurrentUser(u);
            }}
            className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer max-w-[150px] truncate"
          >
            {users.map(u => (
              <option key={u.id} value={u.id} className="bg-slate-900 text-white">
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>
        )}
      </div>
    </header>
  );
};
