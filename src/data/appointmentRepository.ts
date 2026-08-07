import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Agenda de citas.
 *
 * La capacidad la marcan las bahías de la sucursal: el servidor rechaza una
 * reserva cuando la franja está llena. Al llegar el vehículo, la cita se
 * convierte en orden de servicio sin recapturar los datos.
 */

export type Appointment = Tables<'appointments'>;
export type AppointmentStatus = Enums['appointment_status'];
export type VehicleCategory = Enums['vehicle_category'];

export interface Availability { capacity: number; taken: number; free: number }

/** Citas de un día, ordenadas por hora. */
export async function fetchDayAppointments(branchId: string, day: string): Promise<Appointment[]> {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  const { data, error } = await requireSupabase()
    .from('appointments').select('*')
    .eq('branch_id', branchId)
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString())
    .order('scheduled_at');
  if (error) throw error;
  return data ?? [];
}

export async function checkAvailability(
  branchId: string, startIso: string, minutes: number
): Promise<Availability> {
  const { data, error } = await requireSupabase().rpc('appointment_availability', {
    p_branch_id: branchId, p_start: startIso, p_minutes: minutes
  });
  if (error) throw error;
  return data as unknown as Availability;
}

export async function bookAppointment(input: {
  branchId: string; customerName: string; scheduledAt: string;
  serviceId?: string | null; plate?: string; category?: VehicleCategory;
  customerPhone?: string | null; durationMinutes?: number | null; notes?: string | null;
}): Promise<Appointment> {
  const { data, error } = await requireSupabase().rpc('book_appointment', {
    p_branch_id: input.branchId,
    p_customer_name: input.customerName,
    p_scheduled_at: input.scheduledAt,
    p_service_id: input.serviceId ?? null,
    p_vehicle_plate: input.plate ?? '',
    p_vehicle_category: input.category ?? 'sedan',
    p_customer_phone: input.customerPhone ?? null,
    p_duration_minutes: input.durationMinutes ?? null,
    p_notes: input.notes ?? null
  });
  if (error) throw error;
  return data as Appointment;
}

/** Marca la cita (confirmar, no-show) o la cancela con motivo. */
export async function updateAppointmentStatus(
  id: string, status: AppointmentStatus, cancelReason?: string
): Promise<void> {
  const { error } = await requireSupabase()
    .from('appointments')
    .update({ status, cancel_reason: cancelReason ?? null })
    .eq('id', id);
  if (error) throw error;
}

/** La cita se vuelve orden de servicio real. */
export async function convertAppointment(id: string): Promise<Tables<'work_orders'>> {
  const { data, error } = await requireSupabase().rpc('convert_appointment', {
    p_appointment_id: id,
    p_client_request_id: `cita-${id}`
  });
  if (error) throw error;
  return data as Tables<'work_orders'>;
}
