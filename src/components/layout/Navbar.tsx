import React from 'react';
import { Building2, User, Wifi, WifiOff, Plus, FileText, LogOut } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

export const Navbar: React.FC = () => {
  const { phase, profile, company: realCompany, branch: realBranch, signOut } = useAuth();
  const authenticated = phase === 'ready';

  const {
    company,
    branches,
    currentBranch,
    setCurrentBranch,
    currentUser,
    users,
    setCurrentUser,
    isMembegoOnline,
    toggleMembegoOnline,
    setIsNuevaLlegadaOpen,
    setIsQrModalOpen,
    setIsArchModalOpen
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
            <h1 className="font-bold text-sm tracking-tight flex items-center gap-2">
              {authenticated ? realCompany?.trade_name : company.tradeName}
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-medium">
                SaaS Ops
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">carwash.membego.com</p>
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
          onClick={() => setIsArchModalOpen(true)}
          className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
          <span>Fase 0 Arquitectura</span>
        </button>

        <button
          onClick={() => setIsNuevaLlegadaOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all transform hover:scale-[1.02]"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Llegada</span>
        </button>
      </div>

      {/* Right Controls: Role & Online Indicator */}
      <div className="flex items-center gap-3">
        {/* Membego API status toggle */}
        <button
          onClick={toggleMembegoOnline}
          title={isMembegoOnline ? "API Membego En Línea (Sincronización activa)" : "Modo Contingencia Offline (API Membego Simulada)"}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
            isMembegoOnline
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
          }`}
        >
          {isMembegoOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
          <span className="hidden sm:inline">{isMembegoOnline ? 'Membego API' : 'Modo Offline'}</span>
        </button>

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
