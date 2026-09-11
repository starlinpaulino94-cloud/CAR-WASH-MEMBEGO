import { requireSupabase } from '../lib/supabase';
import { fallaDatos } from './errorDatos';
import { FiltrosReporte, limpiarFiltros } from '../lib/filtrosReporte';

export type { FiltrosReporte };
export { limpiarFiltros };

/**
 * Reportes gerenciales.
 *
 * Se separa de adminRepository (que ya pasaba de mil líneas) porque los
 * reportes son un dominio propio: consultan muchas tablas pero no escriben
 * ninguna, y sus RPC comparten forma —un rango, un objeto de filtros, un
 * jsonb de vuelta—. Todo el cálculo vive en el servidor; aquí solo se llama.
 */

export interface KpisVentas {
  ventas_cents: number;
  anulado_cents: number;
  facturas: number;
  anuladas: number;
  descuento_cents: number;
  impuesto_cents: number;
  membego_cents: number;
  ticket_promedio_cents: number;
  clientes: number;
  vehiculos: number;
}

export interface ReporteVentas {
  from: string;
  to: string;
  kpis: KpisVentas;
  servicios_vendidos: number;
  por_servicio: { service_id: string | null; name: string; qty: number; sales_cents: number }[];
  por_producto: { product_id: string | null; name: string; qty: number; sales_cents: number }[];
  por_metodo: { method: string; amount_cents: number }[];
  por_cajero: { profile_id: string; name: string; invoice_count: number; sales_cents: number }[];
  por_dia: { dia: string; sales_cents: number; facturas: number }[];
}

export async function fetchReporteVentas(
  from: string, to: string, filtros: FiltrosReporte = {}
): Promise<ReporteVentas> {
  const { data, error } = await requireSupabase().rpc('sales_report', {
    p_from: from, p_to: to, p_filtros: limpiarFiltros(filtros)
  });
  if (error) throw fallaDatos(error);
  return data as unknown as ReporteVentas;
}

export interface FacturaReporte {
  id: string;
  invoice_number: string;
  ncf: string | null;
  created_at: string;
  customer_name: string;
  vehicle_plate: string;
  total_cents: number;
  is_annulled: boolean;
  cashier_name: string | null;
}

export interface PaginaFacturas {
  total: number;
  rows: FacturaReporte[];
  page: number;
  size: number;
}

/** El drill-down de Ventas: las facturas que forman los números, paginadas. */
export async function fetchFacturasDelReporte(
  from: string, to: string, filtros: FiltrosReporte, page = 0, size = 50
): Promise<PaginaFacturas> {
  const { data, error } = await requireSupabase().rpc('sales_report_invoices', {
    p_from: from, p_to: to, p_filtros: limpiarFiltros(filtros), p_page: page, p_size: size
  });
  if (error) throw fallaDatos(error);
  return data as unknown as PaginaFacturas;
}

export interface RendimientoLavadorDetalle {
  profile_id: string;
  full_name: string;
  lavados: number;
  generado_cents: number;
  ticket_promedio_cents: number;
  comision_cents: number;
  comision_pagada_cents: number;
  comision_pendiente_cents: number;
  costo_bps: number;
  meta_lavados: number | null;
  meta_generado_cents: number | null;
  cumplimiento_lavados_pct: number | null;
  cumplimiento_generado_pct: number | null;
  revisiones: number;
  reprocesos: number;
  reproceso_pct: number | null;
  aprobacion_primera_pct: number | null;
  segundos_promedio: number;
  productividad_dia: number;
}

export async function fetchReporteLavadores(
  from: string, to: string, branchId?: string | null, profileId?: string | null
): Promise<RendimientoLavadorDetalle[]> {
  const { data, error } = await requireSupabase().rpc('washer_report', {
    p_from: from, p_to: to, p_branch_id: branchId ?? null, p_profile_id: profileId ?? null
  });
  if (error) throw fallaDatos(error);
  return ((data as { lavadores?: RendimientoLavadorDetalle[] })?.lavadores) ?? [];
}

export interface OrdenLavador {
  order_id: string;
  order_number: string;
  delivered_at: string;
  vehicle_plate: string;
  vehicle_make_model: string;
  servicios: string | null;
  servicios_cents: number;
  parte_cents: number;
  comision_cents: number;
  compartida: boolean;
  otros_lavadores: string | null;
  calidad: string | null;
}

export async function fetchOrdenesDelLavador(
  from: string, to: string, profileId: string, page = 0, size = 50
): Promise<{ total: number; rows: OrdenLavador[]; page: number; size: number }> {
  const { data, error } = await requireSupabase().rpc('washer_report_orders', {
    p_from: from, p_to: to, p_profile_id: profileId, p_page: page, p_size: size
  });
  if (error) throw fallaDatos(error);
  return data as unknown as { total: number; rows: OrdenLavador[]; page: number; size: number };
}

export interface ReporteRentabilidad {
  from: string;
  to: string;
  branch_id: string | null;
  ventas_cents: number;
  descuentos_cents: number;
  notas_credito_cents: number;
  ingreso_neto_cents: number;
  insumos_cents: number;
  comisiones_cents: number;
  margen_contribucion_cents: number;
  gastos_cents: number;
  nomina_cents: number;
  resultado_operativo_cents: number;
  margen_por_servicio: {
    service_id: string | null; name: string; sales_cents: number; qty: number;
    consumption_cents: number; commission_cents: number; margin_cents: number; margin_pct: number | null;
  }[];
}

export async function fetchReporteRentabilidad(
  from: string, to: string, branchId?: string | null
): Promise<ReporteRentabilidad> {
  const { data, error } = await requireSupabase().rpc('profit_report', {
    p_from: from, p_to: to, p_branch_id: branchId ?? null
  });
  if (error) throw fallaDatos(error);
  return data as unknown as ReporteRentabilidad;
}

// ─────────────────────────────────────────── Kardex trazable y panel de compras

export interface FiltrosKardex {
  from?: string | null;
  to?: string | null;
  productId?: string | null;
  category?: string | null;
  kind?: string | null;
  branchId?: string | null;
  userId?: string | null;
  search?: string | null;
}

export interface MovimientoKardex {
  id: number;
  kind: string;
  qty_change: number;
  qty_before: number;
  qty_after: number;
  reason: string | null;
  created_at: string;
  product_name: string;
  product_code: string;
  product_unit: string;
  valor_cents: number;
  /** 'factura' | 'compra' | 'orden' | null — para saber qué vista abrir. */
  doc_tipo: string | null;
  doc_id: string | null;
  doc_ref: string | null;
  responsable: string | null;
}

export async function fetchKardexPage(
  filtros: FiltrosKardex, page = 0, size = 25
): Promise<{ total: number; rows: MovimientoKardex[]; page: number; size: number }> {
  const { data, error } = await requireSupabase().rpc('kardex_page', {
    p_from: filtros.from ?? undefined,
    p_to: filtros.to ?? undefined,
    p_product_id: filtros.productId ?? undefined,
    p_category: filtros.category ?? undefined,
    p_kind: filtros.kind ?? undefined,
    p_branch_id: filtros.branchId ?? undefined,
    p_user_id: filtros.userId ?? undefined,
    p_search: filtros.search ?? undefined,
    p_page: page, p_size: size
  });
  if (error) throw fallaDatos(error);
  return data as unknown as { total: number; rows: MovimientoKardex[]; page: number; size: number };
}

export interface ResumenCompras {
  compras_cents: number;
  compras_count: number;
  pagado_cents: number;
  pendiente_cents: number;
  vencido_cents: number;
  proveedores_con_saldo: number;
}

export async function fetchResumenCompras(
  from?: string | null, to?: string | null, supplierId?: string | null
): Promise<ResumenCompras> {
  const { data, error } = await requireSupabase().rpc('purchases_summary', {
    p_from: from ?? undefined, p_to: to ?? undefined, p_supplier_id: supplierId ?? undefined
  });
  if (error) throw fallaDatos(error);
  return data as unknown as ResumenCompras;
}
