import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Turnos, asistencia y nómina.
 *
 * El personal es el mayor costo de un car wash. Aquí se planifica el turno, se
 * registra la jornada real y se calcula lo que se le entrega a cada quien.
 *
 * Nada de esto se escribe directo: sueldo, marcaje y nómina pasan por RPC. Una
 * comisión o un adelanto quedan amarrados a la partida que los recoge, y es lo
 * que impide pagarlos dos veces.
 */

export type Profile = Tables<'profiles'>;
export type WorkShift = Tables<'work_shifts'>;
export type AttendanceRecord = Tables<'attendance_records'>;
export type PayrollAdvance = Tables<'payroll_advances'>;
export type PayrollPeriod = Tables<'payroll_periods'>;
export type PayrollItem = Tables<'payroll_items'>;
export type PayrollType = Enums['payroll_type'];
export type PaymentMethod = Enums['payment_method'];

/** Turno con el nombre del empleado resuelto. */
export interface ShiftRow extends WorkShift {
  full_name: string;
}
/** Marcaje con el nombre del empleado resuelto. */
export interface AttendanceRow extends AttendanceRecord {
  full_name: string;
}
/** Partida de nómina con el nombre del empleado resuelto. */
export interface PayrollItemRow extends PayrollItem {
  full_name: string;
}

const named = <T extends { profiles?: { full_name: string } | null }>(row: T) => ({
  ...row,
  full_name: row.profiles?.full_name ?? '—'
});

// ------------------------------------------------------------------ Personal

export async function fetchStaff(): Promise<Profile[]> {
  const { data, error } = await requireSupabase()
    .from('profiles').select('*')
    .eq('is_active', true)
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}

export async function setEmployeePay(input: {
  profileId: string; payrollType: PayrollType;
  baseSalaryCents?: number; hourlyRateCents?: number; commissionBps?: number | null;
}): Promise<Profile> {
  const { data, error } = await requireSupabase().rpc('set_employee_pay', {
    p_profile_id: input.profileId,
    p_payroll_type: input.payrollType,
    p_base_salary_cents: input.baseSalaryCents ?? 0,
    p_hourly_rate_cents: input.hourlyRateCents ?? 0,
    p_commission_bps: input.commissionBps ?? null
  });
  if (error) throw error;
  return data as Profile;
}

// -------------------------------------------------------------------- Turnos

export async function fetchShifts(fromIso: string, toIso: string): Promise<ShiftRow[]> {
  const { data, error } = await requireSupabase()
    .from('work_shifts').select('*, profiles(full_name)')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at');
  if (error) throw error;
  return (data ?? []).map(r => named(r as never)) as ShiftRow[];
}

export async function scheduleShift(input: {
  profileId: string; startsAt: string; endsAt: string;
  branchId?: string | null; notes?: string | null; shiftId?: string | null;
}): Promise<WorkShift> {
  const { data, error } = await requireSupabase().rpc('schedule_shift', {
    p_profile_id: input.profileId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_branch_id: input.branchId ?? null,
    p_notes: input.notes ?? null,
    p_shift_id: input.shiftId ?? null
  });
  if (error) throw error;
  return data as WorkShift;
}

export async function deleteShift(shiftId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('delete_shift', { p_shift_id: shiftId });
  if (error) throw error;
}

// ---------------------------------------------------------------- Asistencia

export async function fetchAttendance(fromIso: string, toIso: string): Promise<AttendanceRow[]> {
  const { data, error } = await requireSupabase()
    .from('attendance_records').select('*, profiles(full_name)')
    .gte('checked_in_at', fromIso)
    .lt('checked_in_at', toIso)
    .order('checked_in_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => named(r as never)) as AttendanceRow[];
}

/** Jornada abierta del propio usuario, si la hay. */
export async function fetchOpenAttendance(profileId: string): Promise<AttendanceRecord | null> {
  const { data, error } = await requireSupabase()
    .from('attendance_records').select('*')
    .eq('profile_id', profileId)
    .is('checked_out_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function clockIn(profileId?: string | null): Promise<AttendanceRecord> {
  const { data, error } = await requireSupabase()
    .rpc('clock_in', { p_profile_id: profileId ?? null, p_notes: null });
  if (error) throw error;
  return data as AttendanceRecord;
}

export async function clockOut(profileId?: string | null): Promise<AttendanceRecord> {
  const { data, error } = await requireSupabase()
    .rpc('clock_out', { p_profile_id: profileId ?? null, p_notes: null });
  if (error) throw error;
  return data as AttendanceRecord;
}

// ----------------------------------------------------------------- Adelantos

export async function fetchPendingAdvances(): Promise<PayrollAdvance[]> {
  const { data, error } = await requireSupabase()
    .from('payroll_advances').select('*')
    .is('payroll_item_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function registerAdvance(input: {
  profileId: string; amountCents: number; reason?: string | null; cashSessionId?: string | null;
}): Promise<PayrollAdvance> {
  const { data, error } = await requireSupabase().rpc('register_payroll_advance', {
    p_profile_id: input.profileId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason ?? null,
    p_cash_session_id: input.cashSessionId ?? null
  });
  if (error) throw error;
  return data as PayrollAdvance;
}

// -------------------------------------------------------------------- Nómina

export async function fetchPayrollPeriods(limit = 24): Promise<PayrollPeriod[]> {
  const { data, error } = await requireSupabase()
    .from('payroll_periods').select('*')
    .order('period_from', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchPayrollItems(periodId: string): Promise<PayrollItemRow[]> {
  const { data, error } = await requireSupabase()
    .from('payroll_items').select('*, profiles(full_name)')
    .eq('period_id', periodId);
  if (error) throw error;
  return ((data ?? []).map(r => named(r as never)) as PayrollItemRow[])
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function openPayrollPeriod(input: {
  from: string; to: string; branchId?: string | null; notes?: string | null;
}): Promise<PayrollPeriod> {
  const { data, error } = await requireSupabase().rpc('open_payroll_period', {
    p_from: input.from,
    p_to: input.to,
    p_branch_id: input.branchId ?? null,
    p_notes: input.notes ?? null
  });
  if (error) throw error;
  return data as PayrollPeriod;
}

export async function adjustPayrollItem(input: {
  itemId: string; bonusCents?: number; deductionsCents?: number; notes?: string | null;
}): Promise<PayrollItem> {
  const { data, error } = await requireSupabase().rpc('adjust_payroll_item', {
    p_item_id: input.itemId,
    p_bonus_cents: input.bonusCents ?? 0,
    p_deductions_cents: input.deductionsCents ?? 0,
    p_notes: input.notes ?? null
  });
  if (error) throw error;
  return data as PayrollItem;
}

export async function approvePayroll(periodId: string): Promise<PayrollPeriod> {
  const { data, error } = await requireSupabase().rpc('approve_payroll', { p_period_id: periodId });
  if (error) throw error;
  return data as PayrollPeriod;
}

export async function payPayroll(input: {
  periodId: string; method: PaymentMethod; cashSessionId?: string | null;
}): Promise<PayrollPeriod> {
  const { data, error } = await requireSupabase().rpc('pay_payroll', {
    p_period_id: input.periodId,
    p_payment_method: input.method,
    p_cash_session_id: input.cashSessionId ?? null
  });
  if (error) throw error;
  return data as PayrollPeriod;
}

export async function deletePayrollPeriod(periodId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('delete_payroll_period', { p_period_id: periodId });
  if (error) throw error;
}
