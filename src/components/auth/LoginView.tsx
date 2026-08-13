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
    <div className="min-h-screen bg-canvas text-strong flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand to-accent flex items-center justify-center font-black text-2xl shadow-lg shadow-brand/30 mx-auto">
            M
          </div>
          <h1 className="text-xl font-bold text-strong">Membego Car Wash</h1>
          <p className="text-xs text-muted">Acceso al sistema operacional</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-line rounded-2xl p-6 space-y-4 shadow-xl"
          noValidate
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-semibold text-muted uppercase tracking-wider">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-muted uppercase tracking-wider">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={busy}
              className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand disabled:opacity-50"
            />
          </div>

          {message && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" />
              <span>{message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 bg-brand hover:bg-brand disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {busy ? 'Verificando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-xs text-faint text-center leading-relaxed flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
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
    <div className="min-h-screen bg-canvas text-strong flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-6 space-y-4 text-center">
        <div className="w-12 h-12 bg-warning/20 text-warning rounded-2xl flex items-center justify-center mx-auto border border-warning/30">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="font-bold text-strong">Su cuenta aún no tiene acceso</h1>
        <p className="text-xs text-muted leading-relaxed">
          La cuenta <strong className="text-body">{profile?.email}</strong> existe, pero todavía
          no está asignada a ninguna empresa ni tiene un rol. Un administrador debe habilitarla
          antes de que pueda operar.
        </p>
        <button
          onClick={() => void signOut()}
          className="w-full py-2.5 bg-surface-2 hover:bg-surface-3 border border-line-strong text-body font-bold text-xs rounded-xl transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
};
