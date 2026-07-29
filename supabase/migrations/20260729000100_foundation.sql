-- =============================================================================
-- 0001 · Cimientos: extensiones, esquema privado, enumeraciones y utilidades
-- =============================================================================
-- Traduce los tipos de src/types/index.ts a tipos de PostgreSQL.
--
-- Decisiones que la auditoría marcó como innegociables desde la primera línea
-- (sección 20, corto plazo) y que quedan fijadas aquí:
--
--   * El dinero NUNCA es coma flotante. Todos los importes son BIGINT en la
--     unidad menor (centavos). El modelo anterior usaba `number` de JavaScript
--     y acumulaba deriva imposible de reconciliar contra el conteo físico.
--   * Toda tabla de negocio lleva company_id y queda bajo RLS (ver 0007).
--   * Los identificadores son UUID generados por la base de datos, no cadenas
--     derivadas de Date.now() que colisionan en el mismo milisegundo.
-- =============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists pg_trgm;       -- búsqueda por placa y nombre

-- Esquema privado para funciones auxiliares. No se expone vía PostgREST.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------- Enumeraciones

create type app.user_role as enum (
  'propietario', 'administrador', 'supervisor', 'cajero',
  'recepcionista', 'operario', 'contador', 'superadmin'
);

create type app.vehicle_category as enum (
  'sedan', 'suv', 'jeep', 'pickup', 'van', 'truck', 'motorcycle', 'special'
);

create type app.order_status as enum (
  'pendiente', 'en_espera', 'asignada', 'en_proceso',
  'control_calidad', 'listo', 'entregado', 'cancelado'
);

create type app.payment_status as enum ('pendiente', 'pagado', 'parcial', 'reembolsado');

create type app.payment_method as enum (
  'efectivo', 'tarjeta', 'transferencia', 'pago_movil',
  'membego_beneficio', 'credito', 'cortesia', 'mixto'
);

create type app.benefit_status as enum (
  'validado', 'reservado', 'en_proceso', 'consumido', 'cancelado'
);

create type app.membego_status as enum ('active', 'inactive', 'none');

create type app.bay_type as enum ('prelavado', 'lavado', 'aspirado', 'secado', 'detallado', 'qc');
create type app.bay_status as enum ('disponible', 'ocupada', 'mantenimiento', 'limpieza');

create type app.item_type as enum ('service', 'package', 'product');

create type app.expense_category as enum (
  'quimicos_insumos', 'servicios_publicos', 'mantenimiento_equipos',
  'nomina_extras', 'varios'
);

create type app.cash_session_status as enum ('open', 'closed');
create type app.cash_movement_type as enum ('inflow', 'outflow');
create type app.printer_width as enum ('58mm', '80mm', 'letter');
create type app.fuel_level as enum ('reserva', '1/4', '1/2', '3/4', 'lleno');

-- Tipos de Comprobante Fiscal (DGII, República Dominicana).
-- B01 crédito fiscal · B02 consumidor final · B04 nota de crédito
-- B14 régimen especial · B15 gubernamental
create type app.ncf_type as enum ('B01', 'B02', 'B04', 'B14', 'B15');

-- ---------------------------------------------------------------- Utilidades

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function app.touch_updated_at is
  'Trigger BEFORE UPDATE: mantiene updated_at. Necesario para concurrencia optimista.';
