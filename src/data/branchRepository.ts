import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Sucursales y alcance del personal.
 *
 * Hasta 0031 el `branch_id` estaba en casi todas las tablas pero no separaba
 * nada: cualquiera del tenant veía la caja y las órdenes de todos los locales.
 * El alcance de cada empleado es lo que convierte esa columna en una frontera,
 * y quien la aplica es RLS — aquí solo se administra.
 */

export type Branch = Tables<'branches'>;
export type Profile = Tables<'profiles'>;
export type BranchScope = Enums['branch_scope'];

export async function fetchBranches(): Promise<Branch[]> {
  const { data, error } = await requireSupabase()
    .from('branches').select('*')
    .order('is_main', { ascending: false })
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Solo las activas: es lo que se ofrece para operar. */
export async function fetchActiveBranches(): Promise<Branch[]> {
  const { data, error } = await requireSupabase()
    .from('branches').select('*')
    .eq('is_active', true)
    .order('is_main', { ascending: false })
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function upsertBranch(input: {
  name: string; branchId?: string | null; address?: string | null;
  phone?: string | null; isMain?: boolean; isActive?: boolean;
}): Promise<Branch> {
  const { data, error } = await requireSupabase().rpc('upsert_branch', {
    p_name: input.name,
    p_branch_id: input.branchId ?? null,
    p_address: input.address ?? null,
    p_phone: input.phone ?? null,
    p_is_main: input.isMain ?? false,
    p_is_active: input.isActive ?? true
  });
  if (error) throw error;
  return data as Branch;
}

export async function setEmployeeBranch(input: {
  profileId: string; branchId: string | null; scope: BranchScope;
}): Promise<Profile> {
  const { data, error } = await requireSupabase().rpc('set_employee_branch', {
    p_profile_id: input.profileId,
    p_branch_id: input.branchId,
    p_scope: input.scope
  });
  if (error) throw error;
  return data as Profile;
}
