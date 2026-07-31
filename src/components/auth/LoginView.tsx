import React, { useState } from 'react';
import { LogIn, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Puerta de acceso.
 *
 * Sustituye al mecanismo auditado, donde cambiar de identidad era un <select>
 * en la barra superior y cualquiera podía convertirse en propietario con dos
 * clics (§7.1).
 */
export const LoginView: React.FC = () => {
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;                    // sin doble envío
    setLocalError(null);

    if (!email.trim() || !password) {
      setLocalError('Introduzca su correo y su contraseña.');
      return;
    }

    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      // El mensaje llega por el contexto; aquí solo se libera el formulario.
    } finally {
      setBusy(false);
    }
  };

  const message = localError ?? error;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-black text-2xl shadow-lg shadow-indigo-600/30 mx-auto">
            M
          </div>
          <h1 className="text-xl font-bold text-white">Membego Car Wash</h1>
          <p className="text-xs text-slate-400">Acceso al sistema operacional</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl"
          noValidate
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={busy}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          {message && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
              <span>{message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {busy ? 'Verificando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-[11px] text-slate-500 text-center leading-relaxed flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          Cada acceso queda registrado en la bitácora de auditoría.
        </p>
      </div>
    </div>
  );
};

/** Autenticado, pero sin empresa asignada: por diseño no ve absolutamente nada. */
export const UnprovisionedView: React.FC = () => {
  const { signOut, profile } = useAuth();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-center">
        <div className="w-12 h-12 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/30">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="font-bold text-white">Su cuenta aún no tiene acceso</h1>
        <p className="text-xs text-slate-400 leading-relaxed">
          La cuenta <strong className="text-slate-200">{profile?.email}</strong> existe, pero todavía
          no está asignada a ninguna empresa ni tiene un rol. Un administrador debe habilitarla
          antes de que pueda operar.
        </p>
        <button
          onClick={() => void signOut()}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
};
