import type { LucideIcon } from 'lucide-react';
import {
  Home, Wrench, ShoppingBag, Receipt, CreditCard, Users, Package,
  Briefcase, BarChart3, Settings
} from 'lucide-react';
import { can, Permission, Profile } from './auth';

/**
 * Configuración CENTRAL de navegación.
 *
 * Única fuente de verdad de la arquitectura de información: qué módulos
 * existen, qué submódulos contiene cada uno, qué vista renderiza cada
 * submódulo y quién puede verlo. Sidebar, breadcrumbs, pestañas, rutas y
 * guardas de permiso leen de aquí — nunca se definen menús en otro archivo.
 *
 * Permisos: igual que en lib/auth, esto decide solo QUÉ SE MUESTRA. La
 * autorización real la aplica RLS en la base de datos.
 */

/** Claves de vista: identifican un componente registrado en App.tsx. */
export type ViewKey =
  | 'dashboard' | 'alerts' | 'orders' | 'kanban' | 'bays' | 'quality' | 'equipment' | 'appointments'
  | 'pos' | 'services' | 'promotions'
  | 'invoices'
  | 'cash' | 'expenses'
  | 'customers' | 'vehicles' | 'claims' | 'receivables' | 'fleets'
  | 'products' | 'inventory-moves' | 'purchases' | 'suppliers'
  | 'team' | 'shifts' | 'attendance' | 'payroll'
  | 'reports' | 'report-sales' | 'report-margin'
  | 'settings-empresa' | 'settings-impresion' | 'settings-membego' | 'branches';

export interface SubModule {
  /** Segmento de la URL, sin acentos: /modulo/<slug> */
  slug: string;
  label: string;
  /** Vista existente que renderiza este submódulo. Ausente si aún no hay función. */
  view?: ViewKey;
  /** Permiso de interfaz; sin él, el submódulo se oculta al rol. */
  permission?: Permission;
  /** Función planificada: se muestra atenuada con estado "En preparación". */
  pronto?: boolean;
  /** Nota para el estado "En preparación" (dónde vive la función hoy, etc.). */
  hint?: string;
  /** Muestra el contador de órdenes activas. */
  queueBadge?: boolean;
}

export interface Module {
  id: string;
  /** Segmento raíz de la URL: /<pathId>/... */
  pathId: string;
  label: string;
  icon: LucideIcon;
  description: string;
  items: SubModule[];
  /** Muestra el contador de órdenes activas en el sidebar. */
  queueBadge?: boolean;
}

export const NAVIGATION: Module[] = [
  {
    id: 'inicio', pathId: 'inicio', label: 'Inicio', icon: Home,
    description: 'Resumen del día y accesos rápidos',
    items: [
      { slug: 'resumen', label: 'Resumen', view: 'dashboard' },
      { slug: 'avisos', label: 'Avisos', view: 'alerts' }
    ]
  },
  {
    id: 'operaciones', pathId: 'operaciones', label: 'Operaciones', icon: Wrench,
    description: 'Órdenes, cola de trabajo y bahías',
    queueBadge: true,
    items: [
      { slug: 'ordenes', label: 'Órdenes', view: 'orders', queueBadge: true },
      { slug: 'agenda', label: 'Agenda', view: 'appointments' },
      { slug: 'cola', label: 'Cola', view: 'kanban' },
      { slug: 'bahias', label: 'Bahías', view: 'bays' },
      { slug: 'calidad', label: 'Calidad', view: 'quality' },
      { slug: 'equipos', label: 'Equipos', view: 'equipment' }
    ]
  },
  {
    id: 'ventas', pathId: 'ventas', label: 'Ventas', icon: ShoppingBag,
    description: 'Punto de venta y catálogo de servicios',
    items: [
      { slug: 'pos', label: 'Punto de venta', view: 'pos' },
      { slug: 'servicios', label: 'Servicios', view: 'services' },
      { slug: 'descuentos', label: 'Descuentos', view: 'promotions' }
    ]
  },
  {
    id: 'facturacion', pathId: 'facturacion', label: 'Facturación', icon: Receipt,
    description: 'Comprobantes emitidos y su ciclo de vida',
    items: [
      { slug: 'facturas', label: 'Facturas', view: 'invoices' },
      { slug: 'notas-credito', label: 'Notas de crédito', pronto: true,
        hint: 'Hoy una factura se anula completa desde Facturas; las notas de crédito parciales están planificadas.' },
      { slug: 'fiscal', label: 'Fiscal', pronto: true,
        hint: 'La emisión con NCF (DGII) quedó pospuesta por decisión operativa; se activará cuando se retome esa fase.' }
    ]
  },
  {
    id: 'caja', pathId: 'caja', label: 'Caja', icon: CreditCard,
    description: 'Sesión de caja, movimientos y gastos',
    items: [
      { slug: 'caja', label: 'Caja actual', view: 'cash' },
      { slug: 'gastos', label: 'Gastos', view: 'expenses' }
    ]
  },
  {
    id: 'clientes', pathId: 'clientes', label: 'Clientes', icon: Users,
    description: 'Directorio, vehículos y fidelización',
    items: [
      { slug: 'directorio', label: 'Clientes', view: 'customers' },
      { slug: 'vehiculos', label: 'Vehículos', view: 'vehicles' },
      { slug: 'reclamos', label: 'Reclamos', view: 'claims' },
      { slug: 'cuentas', label: 'Por cobrar', view: 'receivables',
        permission: 'manageReceivables' },
      { slug: 'flotillas', label: 'Flotillas', view: 'fleets',
        permission: 'manageReceivables' }
    ]
  },
  {
    id: 'inventario', pathId: 'inventario', label: 'Inventario', icon: Package,
    description: 'Productos, insumos y compras',
    items: [
      { slug: 'productos', label: 'Productos', view: 'products' },
      { slug: 'movimientos', label: 'Movimientos', view: 'inventory-moves' },
      { slug: 'compras', label: 'Compras', view: 'purchases' },
      { slug: 'proveedores', label: 'Proveedores', view: 'suppliers' }
    ]
  },
  {
    id: 'personal', pathId: 'personal', label: 'Personal', icon: Briefcase,
    description: 'Empleados, comisiones y turnos',
    items: [
      { slug: 'empleados', label: 'Empleados', view: 'team' },
      { slug: 'horarios', label: 'Horarios', view: 'shifts' },
      { slug: 'asistencia', label: 'Asistencia', view: 'attendance' },
      { slug: 'nomina', label: 'Nómina', view: 'payroll', permission: 'runPayroll' }
    ]
  },
  {
    id: 'reportes', pathId: 'reportes', label: 'Reportes', icon: BarChart3,
    description: 'Analítica y bitácora de auditoría',
    items: [
      { slug: 'ventas', label: 'Ventas', view: 'report-sales', permission: 'viewAuditLog' },
      { slug: 'rentabilidad', label: 'Rentabilidad', view: 'report-margin', permission: 'viewAuditLog' },
      { slug: 'auditoria', label: 'Auditoría', view: 'reports', permission: 'viewAuditLog' }
    ]
  },
  {
    id: 'configuracion', pathId: 'configuracion', label: 'Configuración', icon: Settings,
    description: 'Empresa, impresión e integraciones',
    items: [
      { slug: 'empresa', label: 'Empresa', view: 'settings-empresa' },
      { slug: 'impresion', label: 'Impresión', view: 'settings-impresion' },
      { slug: 'membego', label: 'Membego', view: 'settings-membego', permission: 'manageStaff' },
      { slug: 'sucursales', label: 'Sucursales', view: 'branches' },
      { slug: 'usuarios', label: 'Usuarios y roles', pronto: true,
        hint: 'El alta de empleados vive en Personal → Empleados; la gestión fina de roles llegará aquí.' }
    ]
  }
];

// ---------------------------------------------------------------- Rutas

export const DEFAULT_PATH = '/inicio/resumen';

export function pathFor(mod: Module, sub: SubModule): string {
  return `/${mod.pathId}/${sub.slug}`;
}

/** Resuelve una ruta a su módulo/submódulo. Devuelve null si no existe. */
export function resolvePath(path: string): { mod: Module; sub: SubModule } | null {
  const [modSeg, subSeg] = path.replace(/^\/+|\/+$/g, '').split('/');
  const mod = NAVIGATION.find(m => m.pathId === modSeg);
  if (!mod) return null;
  const sub = subSeg ? mod.items.find(s => s.slug === subSeg) : undefined;
  return { mod, sub: sub ?? mod.items[0] };
}

/**
 * ¿Puede este perfil ver el submódulo? Sin sesión real (modo demostración)
 * se muestra todo, como hasta ahora: la ocultación por rol aplica solo cuando
 * hay un perfil con rol conocido.
 */
export function canSee(profile: Profile | null, sub: SubModule): boolean {
  if (!sub.permission) return true;
  if (!profile) return true; // demo
  return can(profile, sub.permission);
}

/** Submódulos visibles de un módulo para un perfil. */
export function visibleItems(profile: Profile | null, mod: Module): SubModule[] {
  return mod.items.filter(s => canSee(profile, s));
}

/** Módulos con al menos un submódulo visible Y funcional para el perfil. */
export function visibleModules(profile: Profile | null): Module[] {
  return NAVIGATION.filter(m => visibleItems(profile, m).some(s => s.view));
}

/** Primer submódulo funcional visible (destino al entrar a un módulo). */
export function firstAvailable(profile: Profile | null, mod: Module): SubModule | null {
  return visibleItems(profile, mod).find(s => s.view) ?? null;
}

// ------------------------------------------- Compatibilidad con tabs legados

/** Tab ids de la navegación anterior → ruta nueva. Mantiene funcionando los
 *  accesos rápidos y cualquier referencia guardada. */
export const LEGACY_TABS: Record<string, string> = {
  dashboard: '/inicio/resumen',
  orders: '/operaciones/ordenes',
  kanban: '/operaciones/cola',
  bays: '/operaciones/bahias',
  pos: '/ventas/pos',
  services: '/ventas/servicios',
  invoices: '/facturacion/facturas',
  cash: '/caja/caja',
  expenses: '/caja/gastos',
  customers: '/clientes/directorio',
  vehicles: '/clientes/vehiculos',
  membego: '/clientes/directorio',
  products: '/inventario/productos',
  team: '/personal/empleados',
  reports: '/reportes/auditoria',
  settings: '/configuracion/empresa'
};
