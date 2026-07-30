import React, { useState } from 'react';
import {
  ShieldCheck,
  Key,
  UserCheck,
  Building2,
  Lock,
  Mail,
  Sparkles,
  ArrowRight,
  Database,
  CheckCircle2,
  AlertCircle,
  Delete,
  Zap,
  UserPlus,
  LogIn,
  Settings
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { User, UserRole } from '../../types';
import { getSupabaseConfig, getSupabaseClient } from '../../lib/supabase';

export const LoginView: React.FC = () => {
  const {
    users,
    company,
    branches,
    currentBranch,
    setCurrentBranch,
    loginWithUser,
    loginWithEmail,
    setIsSupabaseModalOpen
  } = useApp();

  const supabaseConfig = getSupabaseConfig();

  const [authMode, setAuthMode] = useState<'pin' | 'email'>('pin');
  const [selectedUser, setSelectedUser] = useState<User>(users[0]);
  const [pinInput, setPinInput] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('carlos@membegocarwash.com');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Role badge helper
  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'propietario':
        return { label: 'Propietario', class: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
      case 'administrador':
        return { label: 'Administrador', class: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
      case 'cajero':
        return { label: 'Cajera POS', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
      case 'recepcionista':
        return { label: 'Recepción', class: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
      case 'operario':
        return { label: 'Operario / Lavador', class: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
      default:
        return { label: role, class: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
  };

  const handlePinDigit = (digit: string) => {
    if (pinInput.length < 6) {
      setPinInput(prev => prev + digit);
      setErrorMsg('');
      setSuccessMsg('');
    }
  };

  const handlePinClear = () => {
    setPinInput('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handlePinBackspace = () => {
    setPinInput(prev => prev.slice(0, -1));
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handlePinSubmit = () => {
    if (!selectedUser) return;
    setErrorMsg('');
    setSuccessMsg('');
    const result = loginWithUser(selectedUser, pinInput);
    if (!result.success) {
      setErrorMsg(result.message);
      setPinInput('');
    }
  };

  const handleQuickDemoLogin = (user: User) => {
    setSelectedUser(user);
    setErrorMsg('');
    setSuccessMsg('');
    const result = loginWithUser(user, user.pinCode);
    if (!result.success) {
      setErrorMsg(result.message);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput) {
      setErrorMsg('Por favor ingrese su correo electrónico.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const cleanEmail = emailInput.trim().toLowerCase();

      if (supabase && passwordInput) {
        if (isSignUp) {
          // Register user in Supabase Auth
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password: passwordInput,
            options: {
              data: {
                full_name: cleanEmail.split('@')[0],
                role: 'administrador'
              }
            }
          });

          if (error) {
            throw error;
          }

          if (data.user) {
            setSuccessMsg('Usuario registrado correctamente en Supabase. Iniciando sesión...');
            const res = await loginWithEmail(cleanEmail, passwordInput);
            if (!res.success) {
              setErrorMsg(res.message);
            }
          }
        } else {
          // Direct Supabase Authentication
          const { data, error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: passwordInput
          });

          if (error) {
            let msg = error.message;
            if (msg.includes('Invalid login credentials')) {
              msg = 'Credenciales de acceso incorrectas en Supabase. Verifique correo/contraseña o intente con la clave o PIN local.';
            } else if (msg.includes('Email not confirmed')) {
              msg = 'El correo electrónico aún no ha sido confirmado en Supabase.';
            }
            throw new Error(msg);
          }

          if (data.user) {
            const res = await loginWithEmail(cleanEmail, passwordInput);
            if (!res.success) {
              setErrorMsg(res.message);
            }
          }
        }
      } else {
        // Fallback local authentication / PIN matching via AppContext
        const res = await loginWithEmail(cleanEmail, passwordInput);
        if (!res.success) {
          setErrorMsg(res.message);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error durante la autenticación con Supabase.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 selection:bg-indigo-600 selection:text-white">
      {/* Radial glow background effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-950/30 via-slate-950 to-slate-950 pointer-events-none" />

      <div className="relative z-10 w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Sidebar Branding */}
        <div className="lg:col-span-5 bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 p-8 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
          <div className="space-y-6">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-600/30">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-white tracking-tight leading-tight">
                  {company.tradeName}
                </h1>
                <p className="text-xs text-indigo-300 font-medium">Control POS & Operaciones</p>
              </div>
            </div>

            {/* Branch Picker */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-400" /> Sucursal Activa
              </label>
              <select
                value={currentBranch.id}
                onChange={e => {
                  const b = branches.find(br => br.id === e.target.value);
                  if (b) setCurrentBranch(b);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {branches.map(br => (
                  <option key={br.id} value={br.id} className="bg-slate-900 text-white">
                    {br.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Features List */}
            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-2.5 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>Gestión de Llegadas, Lavaderos y Turnos POS</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>Validación de Membresías & Beneficios Membego</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>Cierre de Caja, Facturación NCF y Comisiones</span>
              </div>
            </div>
          </div>

          {/* Database Status Indicator */}
          <div className="pt-6 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Database className={`w-4 h-4 ${supabaseConfig.isConfigured ? 'text-emerald-400' : 'text-amber-400'}`} />
                <span className="font-semibold text-slate-300">
                  {supabaseConfig.isConfigured ? 'Supabase PostgreSQL Activo' : 'Modo Persistencia Local'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSupabaseModalOpen(true)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-bold"
              >
                <Settings className="w-3 h-3" /> Config
              </button>
            </div>
          </div>
        </div>

        {/* Right Main Login Form */}
        <div className="lg:col-span-7 p-6 sm:p-8 space-y-6 bg-slate-900">
          {/* Header & Tabs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-400" /> Iniciar Sesión de Usuario
                </h2>
                <p className="text-xs text-slate-400">Selecciona tu perfil de personal o ingresa con correo</p>
              </div>
            </div>

            {/* Mode Tabs */}
            <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => { setAuthMode('pin'); setErrorMsg(''); setSuccessMsg(''); }}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  authMode === 'pin'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Key className="w-3.5 h-3.5" /> Personal POS (PIN)
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode('email'); setErrorMsg(''); setSuccessMsg(''); }}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  authMode === 'email'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Correo / Supabase
              </button>
            </div>
          </div>

          {/* Feedback Alerts */}
          {errorMsg && (
            <div className="bg-rose-950/50 border border-rose-500/40 p-3 rounded-2xl flex items-center gap-3 text-rose-200 text-xs animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-950/50 border border-emerald-500/40 p-3 rounded-2xl flex items-center gap-3 text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: PIN POS / Quick Staff Cards */}
          {authMode === 'pin' && (
            <div className="space-y-5">
              {/* Staff Select Cards Grid */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Selecciona tu cuenta de personal</span>
                  <span className="text-indigo-400 text-[10px]">Un clic o ingresa PIN</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[180px] overflow-y-auto pr-1">
                  {users.map(u => {
                    const badge = getRoleBadge(u.role);
                    const isSelected = selectedUser.id === u.id;
                    return (
                      <div
                        key={u.id}
                        onClick={() => {
                          setSelectedUser(u);
                          setPinInput('');
                          setErrorMsg('');
                          setSuccessMsg('');
                        }}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-md'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
                            {u.name.charAt(0)}
                          </div>
                          <div className="truncate">
                            <div className="text-xs font-bold truncate">{u.name}</div>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded-md border font-semibold inline-block mt-0.5 ${badge.class}`}>
                              {badge.label}
                            </span>
                          </div>
                        </div>

                        {/* Quick Demo Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickDemoLogin(u);
                          }}
                          title={`Acceso directo como ${u.name} (PIN: ${u.pinCode || '1234'})`}
                          className="p-1.5 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg transition-colors flex items-center gap-1 text-[10px] font-bold"
                        >
                          <Zap className="w-3 h-3 text-amber-400" /> Entrar
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected User PIN Entry */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-indigo-400" />
                    <span className="text-slate-300">Usuario seleccionado:</span>
                    <strong className="text-white">{selectedUser.name}</strong>
                  </div>
                  {selectedUser.pinCode && (
                    <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded-md font-mono">
                      PIN predeterminado: {selectedUser.pinCode}
                    </span>
                  )}
                </div>

                {/* PIN Display bullets */}
                <div className="flex items-center justify-center gap-3 py-2">
                  {[0, 1, 2, 3].map(idx => (
                    <div
                      key={idx}
                      className={`w-10 h-12 rounded-xl border flex items-center justify-center text-xl font-bold font-mono transition-all ${
                        pinInput.length > idx
                          ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/40'
                          : 'bg-slate-900 border-slate-800 text-slate-600'
                      }`}
                    >
                      {pinInput.length > idx ? '•' : ''}
                    </div>
                  ))}
                </div>

                {/* Tactile Numeric Keypad */}
                <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto pt-1">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handlePinDigit(num)}
                      className="h-11 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-white font-bold text-base active:scale-95 transition-transform"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handlePinClear}
                    className="h-11 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-400 font-bold text-xs uppercase"
                  >
                    Borrar
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePinDigit('0')}
                    className="h-11 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-white font-bold text-base active:scale-95 transition-transform"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handlePinBackspace}
                    className="h-11 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-400 flex items-center justify-center"
                  >
                    <Delete className="w-4 h-4" />
                  </button>
                </div>

                {/* Submit PIN button */}
                <button
                  type="button"
                  onClick={handlePinSubmit}
                  disabled={pinInput.length < 4}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 uppercase tracking-wide cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" /> Iniciar Sesión con PIN
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Email & Password / Supabase Form */}
          {authMode === 'email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>
                    {supabaseConfig.isConfigured ? 'Autenticación Cloud de Supabase' : 'Autenticación por Correo Electrónico'}
                  </span>
                </div>

                {/* Toggle Sign In / Sign Up */}
                {supabaseConfig.isConfigured && (
                  <button
                    type="button"
                    onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(''); setSuccessMsg(''); }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline"
                  >
                    {isSignUp ? '¿Ya tienes cuenta? Iniciar Sesión' : '¿Nuevo usuario? Registrarse'}
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" /> Correo Electrónico
                </label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="ejemplo@membegocarwash.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-400" /> Contraseña / PIN
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={e => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Demo Accounts List */}
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                <div className="font-bold text-slate-300">Cuentas predeterminadas para pruebas:</div>
                <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                  <li><strong className="text-slate-200">Propietario:</strong> carlos@membegocarwash.com (PIN: 1111)</li>
                  <li><strong className="text-slate-200">Administrador:</strong> roberto@membegocarwash.com (PIN: 2222)</li>
                  <li><strong className="text-slate-200">Cajera POS:</strong> ana@membegocarwash.com (PIN: 1234)</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 uppercase tracking-wide cursor-pointer"
              >
                {isSubmitting ? (
                  'Verificando en Supabase...'
                ) : isSignUp ? (
                  <>
                    <UserPlus className="w-4 h-4" /> Crear Cuenta en Supabase
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" /> Acceder con Supabase
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

