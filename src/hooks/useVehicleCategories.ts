import { useEffect, useState } from 'react';
import { fetchVehicleCategories } from '../data/adminRepository';
import { VehicleCategory } from '../data/billingRepository';

export interface CategoriaVehiculo {
  id: VehicleCategory;
  label: string;
}

/**
 * Respaldo cuando la empresa aún no tiene categorías cargadas o no hay sesión:
 * las que existían antes de que fueran dinámicas. Evita un selector vacío.
 */
export const CATEGORIAS_POR_DEFECTO: CategoriaVehiculo[] = [
  { id: 'sedan' as VehicleCategory, label: 'Sedán' },
  { id: 'suv' as VehicleCategory, label: 'SUV' },
  { id: 'jeep' as VehicleCategory, label: 'Jeep' },
  { id: 'pickup' as VehicleCategory, label: 'Pickup' },
  { id: 'van' as VehicleCategory, label: 'Van' },
  { id: 'motorcycle' as VehicleCategory, label: 'Moto' }
];

/**
 * Las categorías de vehículo de la empresa, activas y ordenadas.
 *
 * Antes cada pantalla llevaba la lista fija codificada a mano; ahora sale de
 * `vehicle_categories`, que el superadmin gestiona. El `code` es un valor del
 * enum, así que se puede usar donde se esperaba `VehicleCategory`.
 */
export function useVehicleCategories(): CategoriaVehiculo[] {
  const [cats, setCats] = useState<CategoriaVehiculo[]>(CATEGORIAS_POR_DEFECTO);
  useEffect(() => {
    let active = true;
    fetchVehicleCategories()
      .then(rows => {
        if (!active || rows.length === 0) return;
        setCats(rows.map(r => ({ id: r.code as VehicleCategory, label: r.label })));
      })
      .catch(() => { /* se queda con el respaldo por defecto */ });
    return () => { active = false; };
  }, []);
  return cats;
}
