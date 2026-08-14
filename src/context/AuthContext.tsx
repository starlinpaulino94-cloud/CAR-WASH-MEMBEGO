import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, fetchProfile, signIn as doSignIn, signOut as doSignOut, isProvisioned } from '../lib/auth';
import { Tables } from '../lib/database.types';

type Company = Tables<'companies'>;
type Branch = Tables<'branches'>;

export type AuthPhase =
  | 'unconfigured'    // Sin base de datos: la aplicación NO funciona, y lo dice
  | 'loading'
  | 'signed_out'
  | 'unprovisioned'   // autenticado pero sin empresa asignada: no ve nada
  | 'ready';

interface AuthContextValue {
  phase: AuthPhase;
  session: Session | null;
  profile: Profile | null;
  company: Company | null;
  branch: Branch | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phase, setPhase] = useState<AuthPhase>(isSupabaseConfigured ? 'loading' : 'unconfigured');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Carga el contexto del usuario. La empresa y la sucursal se leen a través de
   * RLS, así que si algo no le corresponde sencillamente no vuelve: no hace
   * falta filtrar por company_id desde el cliente.
   */
  const loadContext = useCallback(async (activeSession: Session | null) => {
    if (!supabase) { setPhase('unconfigured'); return; }

    if (!activeSession) {
      setProfile(null); setCompany(null); setBranch(null);
      setPhase('signed_out');
      return;
    }

    try {
      const loaded = await fetchProfile(activeSession.user.id);
      setProfile(loaded);

      if (!isProvisioned(loaded)) {
        setCompany(null); setBranch(null);
        setPhase('unprovisioned');
        return;
      }

      const [companyRes, branchRes] = await Promise.all([
        supabase.from('companies').select('*').maybeSingle(),
        loaded!.branch_id
          ? supabase.from('branches').select('*').eq('id', loaded!.branch_id).maybeSingle()
          : supabase.from('branches').select('*').eq('is_main', true).maybeSingle()
      ]);

      if (companyRes.error) throw companyRes.error;
      if (branchRes.error) throw branchRes.error;

      setCompany(companyRes.data);
      setBranch(branchRes.data);
      setError(null);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el perfil');
      setPhase('signed_out');
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      void loadContext(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadContext(next);
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadContext]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    // La fase NO pasa a 'loading' aquí a propósito: eso desmontaría el
    // formulario y, al fallar el intento, lo remontaría vacío obligando al
    // cajero a reescribir su correo. El formulario gestiona su propio estado
    // de envío y permanece montado; la fase solo cambia cuando el inicio de
    // sesión prospera y llega el evento de autenticación.
    try {
      await doSignIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
      setPhase('signed_out');
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    await doSignOut();
    setProfile(null); setCompany(null); setBranch(null);
    setPhase('signed_out');
  }, []);

  const reload = useCallback(async () => { await loadContext(session); }, [loadContext, session]);

  // Memoizado: sin esto, cada render del proveedor invalidaría a todos los
  // consumidores, que es justo el problema señalado en §3.2 de la auditoría.
  const value = useMemo<AuthContextValue>(
    () => ({ phase, session, profile, company, branch, error, signIn, signOut, reload }),
    [phase, session, profile, company, branch, error, signIn, signOut, reload]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
};
