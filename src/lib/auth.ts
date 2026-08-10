import { Session, User as AuthUser } from '@supabase/supabase-js';
import { supabase, requireSupabase } from './supabase';
import { Tables, Enums } from './database.types';

export type Profile = Tables<'profiles'>;
export type Role = Enums['user_role'];

/**
 * Capa de autenticación y autorización.
 *
 * Sustituye al mecanismo auditado, en el que cambiar de identidad era un
 * <select> en la barra superior (Navbar.tsx:99-112) y cualquiera podía
 * convertirse en propietario con dos clics.
 *
 * Regla de oro: lo que aquí se decide es SOLO para la interfaz — qué botones
 * mostrar. La autorización real la aplica PostgreSQL con RLS. Un cliente
 * manipulado que llame directamente al API sigue topándose con las políticas.
 * Nunca se debe confiar en estas funciones como control de seguridad.
 */

// Jerarquía de privilegio. Un rol superior incluye las capacidades del inferior
// solo donde se declare explícitamente; no se asume herencia automática.
const ROLE_RANK: Record<Role, number> = {
  operario: 10,
  recepcionista: 20,
  cajero: 30,
  contador: 40,
  supervisor: 50,
  administrador: 60,
  propietario: 70,
  superadmin: 100
};

/** Permisos de interfaz, alineados uno a uno con las políticas RLS de 0007. */
export const PERMISSIONS = {
  annulInvoice:      ['propietario', 'administrador', 'supervisor', 'superadmin'],
  manageCatalog:     ['propietario', 'administrador', 'superadmin'],
  manageStaff:       ['propietario', 'administrador', 'superadmin'],
  manageNcfRanges:   ['propietario', 'administrador', 'superadmin'],
  viewNcfRanges:     ['propietario', 'administrador', 'contador', 'superadmin'],
  viewAuditLog:      ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin'],
  operateCash:       ['propietario', 'administrador', 'supervisor', 'cajero', 'superadmin'],
  issueInvoice:      ['propietario', 'administrador', 'cajero', 'superadmin'],
  registerExpense:   ['propietario', 'administrador', 'supervisor', 'cajero', 'contador', 'superadmin'],
  // Mismos roles que el gate de collect_receivable() en la migración 0028.
  manageReceivables: ['propietario', 'administrador', 'supervisor', 'cajero', 'contador', 'superadmin'],
  // La nómina completa es información sensible: solo quien la firma. Mismos
  // roles que la política de payroll_periods en la migración 0030.
  runPayroll:        ['propietario', 'administrador', 'contador', 'superadmin'],
  viewAllCommissions:['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(profile: Profile | null, permission: Permission): boolean {
  if (!profile?.role || !profile.is_active) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(profile.role);
}

export function outranks(a: Role | null, b: Role | null): boolean {
  if (!a || !b) return false;
  return ROLE_RANK[a] > ROLE_RANK[b];
}

/** Un perfil sin empresa asignada no puede operar: fallo cerrado, igual que RLS. */
export function isProvisioned(profile: Profile | null): boolean {
  return Boolean(profile?.company_id && profile.role && profile.is_active);
}

// --------------------------------------------------------------- Sesión

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error('No se recibió sesión del servidor.');
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Carga el perfil del usuario autenticado.
 *
 * Devuelve null si el usuario existe en auth pero todavía no tiene empresa
 * asignada: es el estado normal de alguien recién registrado, y en ese estado
 * RLS no le deja ver absolutamente nada.
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function onAuthStateChange(
  callback: (session: Session | null, user: AuthUser | null) => void
): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session, session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
