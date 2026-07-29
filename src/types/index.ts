export type UserRole = 
  | 'propietario'
  | 'administrador'
  | 'supervisor'
  | 'cajero'
  | 'recepcionista'
  | 'operario'
  | 'contador'
  | 'superadmin';

export type VehicleCategory = 
  | 'sedan'
  | 'suv'
  | 'jeep'
  | 'pickup'
  | 'van'
  | 'truck'
  | 'motorcycle'
  | 'special';

export type OrderStatus = 
  | 'pendiente'
  | 'en_espera'
  | 'asignada'
  | 'en_proceso'
  | 'control_calidad'
  | 'listo'
  | 'entregado'
  | 'cancelado';

export type PaymentStatus = 'pendiente' | 'pagado' | 'parcial' | 'reembolsado';

export type PaymentMethodType = 
  | 'efectivo'
  | 'tarjeta'
  | 'transferencia'
  | 'pago_movil'
  | 'membego_beneficio'
  | 'credito'
  | 'cortesia'
  | 'mixto';

export type SyncStatus = 'not_linked' | 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export type BenefitStatus = 'validado' | 'reservado' | 'en_proceso' | 'consumido' | 'cancelado';

export interface Company {
  id: string;
  tradeName: string;
  legalName: string;
  taxId: string;
  logoUrl?: string;
  currency: string; // e.g. "DOP", "USD", "MXN"
  currencySymbol: string;
  timezone: string;
  taxRate: number; // e.g. 18 for 18% ITBIS/IVA
  allowGuestCheckout: boolean;
  thermalPrinterWidth: '58mm' | '80mm' | 'letter';
  headerNote?: string;
  footerNote?: string;
}

export interface Branch {
  id: string;
  companyId: string;
  name: string;
  address: string;
  phone: string;
  isMain: boolean;
  baysCount: number;
}

export interface User {
  id: string;
  companyId: string;
  branchId: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  avatarUrl?: string;
  pinCode?: string;
  isActive: boolean;
  commissionRate?: number; // Base percentage
}

export interface Customer {
  id: string;
  companyId: string;
  branchId: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
  notes?: string;
  isAnonymousGuest?: boolean;
  membegoCustomerId?: string;
  membegoStatus?: 'active' | 'inactive' | 'none';
  membegoTier?: string; // e.g. "Socio VIP Diamond", "Gold Club"
  totalVisits: number;
  totalSpent: number;
  lastVisitAt?: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  companyId: string;
  customerId?: string;
  customerName?: string;
  plate: string;
  make: string;
  model: string;
  year?: number;
  color: string;
  category: VehicleCategory;
  notes?: string;
  lastVisitAt?: string;
  frequentServices?: string[];
}

export interface ServicePriceByVehicle {
  sedan: number;
  suv: number;
  jeep: number;
  pickup: number;
  van: number;
  truck: number;
  motorcycle: number;
  special: number;
}

export interface Service {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string;
  category: string; // e.g. "Lavado Express", "Detallado", "Tratamiento Cera", "Especiales"
  estimatedMinutes: number;
  priceByVehicle: ServicePriceByVehicle;
  commissionPercent: number; // e.g., 10 for 10%
  requiresInspection: boolean;
  includedInMembego: boolean;
  isPopular?: boolean;
  isActive: boolean;
}

export interface ServicePackage {
  id: string;
  companyId: string;
  name: string;
  description: string;
  servicesIncluded: string[]; // Service IDs
  packagePriceByVehicle: ServicePriceByVehicle;
  estimatedMinutes: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  barcode?: string;
  name: string;
  category: string; // "Aromatizantes", "Accesorios", "Químicos Uso Interno", "Bebidas", "Toallas"
  cost: number;
  price: number;
  stock: number;
  minStock: number;
  unit: string; // "Unidad", "Galón", "Litro", "Lata"
  isForSale: boolean;
}

export interface MembegoBenefit {
  id: string;
  membershipId: string;
  membershipName: string; // e.g. "Membresía Ilimitada Premium"
  serviceId?: string;
  serviceName: string;
  discountPercentage: number; // 100 for free service
  usesRemaining: number;
  usesMax: number;
  expiresAt: string;
  restrictions?: string;
  allowedPlates?: string[];
}

export interface VehicleInspection {
  id: string;
  workOrderId: string;
  fuelLevel: 'reserva' | '1/4' | '1/2' | '3/4' | 'lleno';
  scratchesDamagesNote?: string;
  valuableItemsNote?: string;
  exteriorPhotosUrl?: string[];
  inspectedBy: string;
  inspectedAt: string;
  customerSignatureUrl?: string;
}

export interface QualityCheck {
  exteriorClean: boolean;
  windowsStreakless: boolean;
  interiorVacuumed: boolean;
  tiresDressed: boolean;
  aromaApplied: boolean;
  personalItemsVerified: boolean;
  checkedBy?: string;
  checkedAt?: string;
  notes?: string;
}

export interface WorkOrderItem {
  id: string;
  itemType: 'service' | 'package' | 'product';
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  isMembegoCovered?: boolean;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
}

export interface WorkOrder {
  id: string;
  companyId: string;
  branchId: string;
  orderNumber: string; // e.g. "CW-2026-1042"
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  vehicleId?: string;
  vehiclePlate: string;
  vehicleMakeModel: string;
  vehicleCategory: VehicleCategory;
  vehicleColor: string;
  
  status: OrderStatus;
  priority: 'normal' | 'alta' | 'vip_membego';
  bayId?: string;
  bayName?: string;
  assignedEmployeeIds: string[];
  assignedEmployeeNames: string[];

  // Financials
  items: WorkOrderItem[];
  subtotal: number;
  discountTotal: number;
  membegoBenefitDiscount: number;
  taxTotal: number;
  total: number;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethodType;

  // Membego tracking
  membegoCustomerId?: string;
  membegoMembershipId?: string;
  membegoBenefitId?: string;
  membegoRedemptionId?: string;
  benefitStatus?: BenefitStatus;

  // Timestamps
  arrivalTime: string;
  startTime?: string;
  finishTime?: string;
  deliveryTime?: string;
  estimatedCompletionTime?: string;

  inspection?: VehicleInspection;
  qualityCheck?: QualityCheck;

  notes?: string;
  createdBy: string;
  createdByName: string;
}

export interface Bay {
  id: string;
  companyId: string;
  branchId: string;
  name: string; // e.g. "Bahía 1 - Prelavado", "Bahía 2 - Aspirado Interno"
  type: 'prelavado' | 'lavado' | 'aspirado' | 'secado' | 'detallado' | 'qc';
  status: 'disponible' | 'ocupada' | 'mantenimiento' | 'limpieza';
  currentOrderId?: string;
  currentVehiclePlate?: string;
  assignedEmployeeName?: string;
}

export interface PaymentBreakdown {
  method: PaymentMethodType;
  amount: number;
  reference?: string; // bank transaction reference, ticket ref, etc.
}

export interface Invoice {
  id: string;
  companyId: string;
  branchId: string;
  invoiceNumber: string; // e.g. "FAC-00892"
  ncfFiscalNumber?: string; // e.g. "B0100001234"
  workOrderId?: string;
  customerId?: string;
  customerName: string;
  customerTaxId?: string;
  vehiclePlate?: string;

  items: WorkOrderItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;

  payments: PaymentBreakdown[];
  changeAmount: number;
  
  cashSessionId?: string;
  cashierId: string;
  cashierName: string;

  isAnulled?: boolean;
  annulledReason?: string;
  annulledAt?: string;

  createdAt: string;
}

export interface CashSession {
  id: string;
  companyId: string;
  branchId: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string;
  initialAmount: number;
  
  // Computed / Counted at close
  totalCashSales: number;
  totalCardSales: number;
  totalTransferSales: number;
  totalMembegoRedemptions: number;
  totalInflows: number;
  totalOutflows: number;
  
  expectedCash: number;
  countedCash?: number;
  cashDifference?: number; // countedCash - expectedCash

  status: 'open' | 'closed';
  notes?: string;
}

export interface CashMovement {
  id: string;
  companyId: string;
  branchId: string;
  cashSessionId: string;
  type: 'inflow' | 'outflow';
  amount: number;
  reason: string; // e.g. "Compra jabón de emergencia", "Cambio inicial", "Retiro para depósito"
  createdBy: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  companyId: string;
  branchId: string;
  category: 'quimicos_insumos' | 'servicios_publicos' | 'mantenimiento_equipos' | 'nomina_extras' | 'varios';
  description: string;
  amount: number;
  paymentMethod: PaymentMethodType;
  supplierName?: string;
  invoiceRef?: string;
  expenseDate: string;
  createdBy: string;
  createdAt: string;
}

export interface CommissionEntry {
  id: string;
  companyId: string;
  branchId: string;
  employeeId: string;
  employeeName: string;
  workOrderId: string;
  serviceName: string;
  servicePrice: number;
  commissionPercent: number;
  commissionAmount: number;
  date: string;
  isPaid: boolean;
}

export interface MembegoSyncLog {
  id: string;
  action: 'validate_qr' | 'reserve_benefit' | 'confirm_redemption' | 'cancel_redemption' | 'sync_customer';
  idempotencyKey: string;
  status: 'success' | 'failed' | 'retry_pending';
  requestPayload: any;
  responsePayload: any;
  timestamp: string;
  errorMessage?: string;
}

export interface AuditLog {
  id: string;
  companyId: string;
  branchId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string; // e.g. "ANULAR_FACTURA", "CAMBIAR_PRECIO", "APERTURA_CAJA", "CONSUMIR_BENEFICIO"
  entity: string;
  entityId?: string;
  details: string;
  timestamp: string;
  ipAddress?: string;
}
