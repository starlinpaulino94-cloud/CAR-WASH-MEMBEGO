import { createClient, SupabaseClient } from '@supabase/supabase-js';

// LocalStorage Keys for custom runtime credentials if user provides them in UI
const STORAGE_KEY_URL = 'carwash_supabase_url';
const STORAGE_KEY_ANON_KEY = 'carwash_supabase_anon_key';

let supabaseClient: SupabaseClient | null = null;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConfigured: boolean;
}

export function getSupabaseConfig(): SupabaseConfig {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const localUrl = localStorage.getItem(STORAGE_KEY_URL) || '';
  const localKey = localStorage.getItem(STORAGE_KEY_ANON_KEY) || '';

  const url = localUrl || envUrl;
  const anonKey = localKey || envKey;

  const isConfigured = Boolean(url && anonKey && url !== 'https://your-project.supabase.co' && !url.includes('your-project'));

  return {
    url,
    anonKey,
    isConfigured
  };
}

export function setSupabaseConfig(url: string, anonKey: string): void {
  localStorage.setItem(STORAGE_KEY_URL, url.trim());
  localStorage.setItem(STORAGE_KEY_ANON_KEY, anonKey.trim());
  supabaseClient = null; // reset client to re-initialize
}

export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_ANON_KEY);
  supabaseClient = null;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const config = getSupabaseConfig();
  if (!config.isConfigured || !config.url || !config.anonKey) {
    return null;
  }

  try {
    supabaseClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
    return supabaseClient;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

export interface SupabaseTestResult {
  connected: boolean;
  message: string;
  tablesStatus?: { [tableName: string]: boolean };
  errorDetails?: string;
}

export async function testSupabaseConnection(): Promise<SupabaseTestResult> {
  const client = getSupabaseClient();
  const config = getSupabaseConfig();

  if (!config.isConfigured) {
    return {
      connected: false,
      message: 'Las credenciales de Supabase (URL y Anon Key) no se han configurado.'
    };
  }

  if (!client) {
    return {
      connected: false,
      message: 'No se pudo crear el cliente de Supabase. Verifique que la URL tenga formato válido (https://...).'
    };
  }

  try {
    // Attempt a lightweight query
    const { data, error } = await client.from('work_orders').select('id').limit(1);

    if (error) {
      if (error.code === 'PGRST301' || error.message?.includes('JWT') || error.message?.includes('apiKey')) {
        return {
          connected: false,
          message: 'Error de autenticación con Supabase: La Anon Key proporcionada es inválida.',
          errorDetails: error.message
        };
      }
      if (error.code === '42P01' || error.message?.includes('relation "public.work_orders" does not exist')) {
        return {
          connected: true,
          message: 'Conectado a Supabase exitosamente. Nota: Las tablas aún no están creadas en tu base de datos (Ejecuta el script SQL suministrado).',
          tablesStatus: { work_orders: false }
        };
      }
      return {
        connected: false,
        message: `Error al consultar Supabase: ${error.message}`,
        errorDetails: JSON.stringify(error)
      };
    }

    return {
      connected: true,
      message: 'Conexión exitosa a Supabase y tablas encontradas.',
      tablesStatus: { work_orders: true }
    };
  } catch (err: any) {
    return {
      connected: false,
      message: `Error de red o conexión al servidor de Supabase: ${err.message || String(err)}`,
      errorDetails: String(err)
    };
  }
}

export const SUPABASE_SQL_SCHEMA_SCRIPT = `-- SCRIPT SQL DE ESTRUCTURA COMPLETA PARA SUPABASE
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase

-- 1. Tabla de Clientes
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  address TEXT,
  notes TEXT,
  is_anonymous_guest BOOLEAN DEFAULT FALSE,
  membego_customer_id TEXT,
  membego_status TEXT,
  membego_tier TEXT,
  total_visits INT DEFAULT 0,
  total_spent NUMERIC DEFAULT 0,
  last_visit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Vehículos
CREATE TABLE IF NOT EXISTS public.vehicles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  customer_id TEXT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  plate TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INT,
  color TEXT NOT NULL,
  category TEXT NOT NULL,
  notes TEXT,
  last_visit_at TIMESTAMPTZ
);

-- 3. Tabla de Órdenes de Servicio (Work Orders)
CREATE TABLE IF NOT EXISTS public.work_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  vehicle_id TEXT,
  vehicle_plate TEXT NOT NULL,
  vehicle_make_model TEXT NOT NULL,
  vehicle_category TEXT NOT NULL,
  vehicle_color TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  bay_id TEXT,
  bay_name TEXT,
  assigned_employees JSONB DEFAULT '[]'::jsonb,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  membego_benefit_discount NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pendiente',
  payment_method TEXT,
  membego_customer_id TEXT,
  membego_membership_id TEXT,
  membego_benefit_id TEXT,
  membego_redemption_id TEXT,
  benefit_status TEXT,
  arrival_time TIMESTAMPTZ DEFAULT NOW(),
  start_time TIMESTAMPTZ,
  finish_time TIMESTAMPTZ,
  delivery_time TIMESTAMPTZ,
  inspection JSONB,
  quality_check JSONB,
  notes TEXT,
  created_by TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla de Facturas
CREATE TABLE IF NOT EXISTS public.invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  ncf_fiscal_number TEXT,
  work_order_id TEXT,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_tax_id TEXT,
  vehicle_plate TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  payments JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_amount NUMERIC NOT NULL DEFAULT 0,
  cash_session_id TEXT,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT NOT NULL,
  is_anulled BOOLEAN DEFAULT FALSE,
  annulled_reason TEXT,
  annulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabla de Sesiones de Caja
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  initial_amount NUMERIC NOT NULL DEFAULT 0,
  total_cash_sales NUMERIC DEFAULT 0,
  total_card_sales NUMERIC DEFAULT 0,
  total_transfer_sales NUMERIC DEFAULT 0,
  total_membego_redemptions NUMERIC DEFAULT 0,
  total_inflows NUMERIC DEFAULT 0,
  total_outflows NUMERIC DEFAULT 0,
  expected_cash NUMERIC DEFAULT 0,
  counted_cash NUMERIC,
  cash_difference NUMERIC,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT
);

-- 6. Tabla de Gastos
CREATE TABLE IF NOT EXISTS public.expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  supplier_name TEXT,
  invoice_ref TEXT,
  expense_date TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabla de Logs de Auditoría
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security) opcional o políticas permisivas
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso público anónimo (para lectura/escritura con Anon Key)
CREATE POLICY "Acceso público lectura/escritura en customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso público lectura/escritura en vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso público lectura/escritura en work_orders" ON public.work_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso público lectura/escritura en invoices" ON public.invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso público lectura/escritura en cash_sessions" ON public.cash_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso público lectura/escritura en expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso público lectura/escritura en audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
`;
