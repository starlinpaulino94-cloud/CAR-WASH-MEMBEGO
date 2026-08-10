import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Avisos: bandeja de salida.
 *
 * Los avisos se generan en la base —un trigger cuando el vehículo queda listo,
 * un barrido para stock, cobros vencidos, equipos y citas— y se quedan
 * pendientes hasta que alguien los envía o los descarta.
 *
 * No hay proveedor de WhatsApp contratado, así que el envío es manual: la
 * pantalla abre wa.me con el texto ya escrito y luego se marca como enviado.
 * El día que haya proveedor, solo cambia quién vacía la cola.
 */

export type Notification = Tables<'notifications'>;
export type NotificationKind = Enums['notification_kind'];
export type NotificationStatus = Enums['notification_status'];
export type NotificationAudience = Enums['notification_audience'];

/** Lo que devuelve refresh_alerts(): cuántos avisos NUEVOS encoló cada barrido. */
export interface AlertsSummary {
  stock_bajo: number;
  cuentas_vencidas: number;
  mantenimiento: number;
  citas: number;
  caja_sin_cerrar: number;
  total: number;
}

export async function fetchNotifications(
  status: NotificationStatus | 'todas' = 'pendiente'
): Promise<Notification[]> {
  let query = requireSupabase().from('notifications').select('*');
  if (status !== 'todas') query = query.eq('status', status);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

/** Solo cuenta: el badge no necesita traerse los avisos. */
export async function countPendingNotifications(): Promise<number> {
  const { count, error } = await requireSupabase()
    .from('notifications').select('id', { count: 'exact', head: true })
    .eq('status', 'pendiente');
  if (error) throw error;
  return count ?? 0;
}

export async function refreshAlerts(): Promise<AlertsSummary> {
  const { data, error } = await requireSupabase().rpc('refresh_alerts', {});
  if (error) throw error;
  return data as unknown as AlertsSummary;
}

export async function markNotification(
  id: string, status: Exclude<NotificationStatus, 'pendiente'>, error?: string | null
): Promise<Notification> {
  const { data, error: err } = await requireSupabase().rpc('mark_notification', {
    p_notification_id: id, p_status: status, p_error: error ?? null
  });
  if (err) throw err;
  return data as Notification;
}

/**
 * Enlace de WhatsApp con el texto ya escrito.
 *
 * wa.me exige el número sin signos y con código de país. Si el teléfono viene
 * en formato local dominicano (10 dígitos), se le antepone el 1.
 */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.length === 10 ? `1${digits}` : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}
