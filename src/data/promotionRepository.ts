import { requireSupabase } from '../lib/supabase';
import { Tables, Enums } from '../lib/database.types';

/**
 * Promociones y descuentos.
 *
 * Antes de 0032 el descuento era un número libre que ponía esta capa y nadie
 * miraba. Ahora el manual tiene techo por rol y el promocional lo calcula el
 * servidor: `validate_promotion` solo PREVISUALIZA, y el importe que vale es el
 * que vuelve a calcular `create_invoice` al emitir.
 */

export type Promotion = Tables<'promotions'>;
export type PromotionRedemption = Tables<'promotion_redemptions'>;
export type PromotionKind = Enums['promotion_kind'];
export type PromotionScope = Enums['promotion_scope'];
export type VehicleCategory = Enums['vehicle_category'];

/** Lo que devuelve validate_promotion(). */
export interface PromotionPreview {
  valid: boolean;
  reason?: string;
  promotion_id?: string;
  code?: string;
  name?: string;
  discount_cents?: number;
}

/** Una línea del carrito, tal como la necesita la promoción para su alcance. */
export interface PromotionLine {
  service_id?: string | null;
  category?: VehicleCategory | null;
  amount_cents: number;
}

export async function fetchPromotions(): Promise<Promotion[]> {
  const { data, error } = await requireSupabase()
    .from('promotions').select('*')
    .order('is_active', { ascending: false })
    .order('code');
  if (error) throw error;
  return data ?? [];
}

export async function fetchRedemptions(promotionId: string): Promise<PromotionRedemption[]> {
  const { data, error } = await requireSupabase()
    .from('promotion_redemptions').select('*')
    .eq('promotion_id', promotionId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

/**
 * Previsualiza un código en el punto de venta.
 *
 * Nunca decide dinero: si al emitir la promoción ya no aplica —se agotó, cambió
 * el día—, `create_invoice` la rechaza aunque aquí saliera válida.
 */
export async function validatePromotion(input: {
  code: string; subtotalCents: number;
  lines?: PromotionLine[]; customerId?: string | null;
}): Promise<PromotionPreview> {
  const { data, error } = await requireSupabase().rpc('validate_promotion', {
    p_code: input.code,
    p_subtotal: input.subtotalCents,
    p_lines: (input.lines ?? []) as never,
    p_customer_id: input.customerId ?? null
  });
  if (error) throw error;
  return data as unknown as PromotionPreview;
}

export async function upsertPromotion(input: {
  code: string; name: string; kind: PromotionKind; scope: PromotionScope;
  promotionId?: string | null;
  valueBps?: number | null; valueCents?: number | null;
  serviceId?: string | null; vehicleCategory?: VehicleCategory | null;
  startsOn?: string | null; endsOn?: string | null;
  weekdays?: number[] | null; minPurchaseCents?: number;
  maxUses?: number | null; maxUsesPerCustomer?: number | null;
  isActive?: boolean;
}): Promise<Promotion> {
  const { data, error } = await requireSupabase().rpc('upsert_promotion', {
    p_code: input.code,
    p_name: input.name,
    p_kind: input.kind,
    p_scope: input.scope,
    p_promotion_id: input.promotionId ?? null,
    p_value_bps: input.valueBps ?? null,
    p_value_cents: input.valueCents ?? null,
    p_service_id: input.serviceId ?? null,
    p_vehicle_category: input.vehicleCategory ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
    p_weekdays: input.weekdays ?? null,
    p_min_purchase_cents: input.minPurchaseCents ?? 0,
    p_max_uses: input.maxUses ?? null,
    p_max_uses_per_customer: input.maxUsesPerCustomer ?? null,
    p_is_active: input.isActive ?? true
  });
  if (error) throw error;
  return data as Promotion;
}
