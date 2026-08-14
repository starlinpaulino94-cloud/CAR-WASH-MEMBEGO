import { requireSupabase } from '../lib/supabase';
import { Enums } from '../lib/database.types';

/**
 * Reconocer al cliente que ya existe.
 *
 * Vive aparte porque lo usan dos mostradores distintos —el de recepción, al
 * llegar el vehículo, y el de la caja, al cobrar— y en ambos resuelve el mismo
 * problema: si el cliente que ya está en el directorio no se puede elegir, se
 * escribe otra vez y nace un duplicado. Con él se parten en dos sus visitas, su
 * cupo de crédito y su histórico de facturas, y después no hay forma de volver
 * a juntarlos.
 */

/** Ficha resumida, con lo justo para reconocer a alguien en el mostrador. */
export interface CustomerMatch {
  id: string;
  name: string;
  phone: string | null;
  origin: Enums['customer_origin'];
  membego_status: 'active' | 'inactive' | 'none';
  total_visits: number;
  credit_enabled: boolean;
}

// No se trae la fila entera: el mostrador solo necesita saber a quién está
// mirando. Traer columnas que no se pintan es tráfico y es exponer datos del
// cliente sin motivo.
const CAMPOS = 'id, name, phone, origin, membego_status, total_visits, credit_enabled';

/**
 * Busca clientes ya registrados por nombre o teléfono.
 *
 * Se exigen dos caracteres porque con uno el resultado es «media empresa» y no
 * ayuda a nadie. El orden es por última visita: quien vino ayer es mucho más
 * probable que sea el que está delante del mostrador que uno de hace dos años.
 * RLS acota a la empresa; aquí no hace falta filtrar por `company_id`.
 */
export async function searchCustomers(term: string, limit = 8): Promise<CustomerMatch[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const escaped = t.replace(/[%,()]/g, '');

  const { data, error } = await requireSupabase()
    .from('customers')
    .select(CAMPOS)
    .or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`)
    .order('last_visit_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CustomerMatch[];
}

/** La misma ficha, cuando ya se sabe de quién se trata. */
export async function fetchCustomerById(id: string): Promise<CustomerMatch | null> {
  const { data, error } = await requireSupabase()
    .from('customers').select(CAMPOS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as CustomerMatch | null) ?? null;
}

export interface VehicleMatch {
  id: string;
  plate: string;
  make: string;
  model: string;
  color: string;
  category: Enums['vehicle_category'];
  /** Dueño registrado, si el vehículo ya tiene uno. */
  customer: CustomerMatch | null;
}

/** La placa se guarda normalizada; hay que buscar con la misma forma. */
export const normalizePlate = (plate: string) =>
  plate.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Busca el vehículo por placa, con su dueño si lo tiene.
 *
 * La placa es única por empresa, así que un acierto es el mismo carro físico
 * que ya vino antes. Se hacen dos consultas en vez de un `embed`: hay dos
 * claves foráneas hacia `customers` desde `vehicles` y pedirle a PostgREST que
 * adivine cuál es la del enlace es frágil.
 */
export async function lookupVehicleByPlate(plate: string): Promise<VehicleMatch | null> {
  const p = normalizePlate(plate);
  if (p.length < 4) return null;

  const supabase = requireSupabase();
  const { data: v, error } = await supabase
    .from('vehicles')
    .select('id, plate, make, model, color, category, customer_id')
    .eq('plate', p)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!v) return null;

  let customer: CustomerMatch | null = null;
  if (v.customer_id) customer = await fetchCustomerById(v.customer_id);

  return {
    id: v.id, plate: v.plate, make: v.make, model: v.model, color: v.color,
    category: v.category, customer
  };
}
