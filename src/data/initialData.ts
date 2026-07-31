import {
  Company,
  Branch,
  User,
  Customer,
  Vehicle,
  Service,
  Product,
  WorkOrder,
  Bay,
  Invoice,
  CashSession,
  Expense,
  CommissionEntry,
  AuditLog
} from '../types';

export const initialCompany: Company = {
  id: 'comp-101',
  tradeName: 'Membego Car Wash Santo Domingo',
  legalName: 'Membego Auto Care Operations SRL',
  taxId: '131-88942-1',
  currency: 'DOP',
  currencySymbol: 'RD$',
  timezone: 'America/Santo_Domingo',
  taxRate: 18, // 18% ITBIS
  allowGuestCheckout: true,
  thermalPrinterWidth: '80mm',
  headerNote: '¡Gracias por confiar en Membego Car Wash! Servicio rápido y profesional.',
  footerNote: 'Conserve este ticket para garantía. Reclamaciones dentro de las primeras 24 hrs.'
};

export const initialBranches: Branch[] = [
  {
    id: 'branch-1',
    companyId: 'comp-101',
    name: 'Sucursal Central - Av. Winston Churchill',
    address: 'Av. Winston Churchill #102, Piantini, Santo Domingo',
    phone: '809-555-0199',
    isMain: true,
    baysCount: 6
  },
  {
    id: 'branch-2',
    companyId: 'comp-101',
    name: 'Sucursal Santiago - Av. Juan Pablo Duarte',
    address: 'Av. Juan Pablo Duarte #45, Santiago de los Caballeros',
    phone: '809-555-0288',
    isMain: false,
    baysCount: 4
  }
];

export const initialUsers: User[] = [
  {
    id: 'usr-1',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Carlos Mendoza (Propietario)',
    email: 'carlos@membegocarwash.com',
    phone: '809-555-0111',
    role: 'propietario',
    isActive: true
  },
  {
    id: 'usr-2',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Roberto Gómez (Administrador)',
    email: 'roberto@membegocarwash.com',
    phone: '809-555-0112',
    role: 'administrador',
    isActive: true
  },
  {
    id: 'usr-3',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Ana Beltrán (Cajera POS)',
    email: 'ana@membegocarwash.com',
    phone: '809-555-0113',
    role: 'cajero',
    pinCode: '1234',
    isActive: true
  },
  {
    id: 'usr-4',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Marcos Peralta (Recepcionista)',
    email: 'marcos@membegocarwash.com',
    phone: '809-555-0114',
    role: 'recepcionista',
    isActive: true
  },
  {
    id: 'usr-5',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Juan José "El Flaco" (Lavador / Operario)',
    email: 'juan@membegocarwash.com',
    phone: '809-555-0115',
    role: 'operario',
    commissionRate: 12,
    isActive: true
  },
  {
    id: 'usr-6',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Dioris Batista (Lavador / Detallador)',
    email: 'dioris@membegocarwash.com',
    phone: '809-555-0116',
    role: 'operario',
    commissionRate: 15,
    isActive: true
  }
];

export const initialCustomers: Customer[] = [
  {
    id: 'cust-1',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Ramón Peña (Demo)',
    phone: '809-555-0101',
    email: 'socio.diamond@example.com',
    taxId: '000-11111-1',
    notes: 'Cliente VIP Membego Diamond. Exigente con el secado de los cristales.',
    membegoCustomerId: 'mbg-usr-9001',
    membegoStatus: 'active',
    membegoTier: 'Socio VIP Diamond',
    totalVisits: 28,
    totalSpent: 34500,
    lastVisitAt: '2026-07-28T10:15:00Z',
    createdAt: '2025-11-10T08:00:00Z'
  },
  {
    id: 'cust-2',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Marisol Guzmán (Demo)',
    phone: '829-555-0102',
    email: 'socio.gold@example.com',
    notes: 'Membresía Ilimitada Membego Gold.',
    membegoCustomerId: 'mbg-usr-9022',
    membegoStatus: 'active',
    membegoTier: 'Gold Unlimited Club',
    totalVisits: 14,
    totalSpent: 18200,
    lastVisitAt: '2026-07-27T16:30:00Z',
    createdAt: '2026-01-15T12:00:00Z'
  },
  {
    id: 'cust-3',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Inversiones Veloz SRL',
    phone: '809-555-0103',
    taxId: '000-22222-2',
    notes: 'Flotilla de la empresa. Factura fiscal obligatoria con RNC.',
    membegoStatus: 'none',
    totalVisits: 45,
    totalSpent: 92000,
    lastVisitAt: '2026-07-26T11:00:00Z',
    createdAt: '2025-08-01T10:00:00Z'
  },
  {
    id: 'cust-4',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Cliente General / Visitante',
    isAnonymousGuest: true,
    membegoStatus: 'none',
    totalVisits: 120,
    totalSpent: 96000,
    createdAt: '2025-01-01T00:00:00Z'
  }
];

export const initialVehicles: Vehicle[] = [
  {
    id: 'veh-1',
    companyId: 'comp-101',
    customerId: 'cust-1',
    customerName: 'Ramón Peña (Demo)',
    plate: 'A000101',
    make: 'Toyota',
    model: 'Land Cruiser Prado',
    year: 2024,
    color: 'Blanco Perlado',
    category: 'suv',
    notes: 'Protección cerámico en pintura. Usar paños limpios de microfibra suavizada.',
    frequentServices: ['serv-2', 'serv-4']
  },
  {
    id: 'veh-2',
    companyId: 'comp-101',
    customerId: 'cust-2',
    customerName: 'Marisol Guzmán (Demo)',
    plate: 'G412098',
    make: 'Honda',
    model: 'Civic Turbo',
    year: 2023,
    color: 'Gris Grafito',
    category: 'sedan',
    frequentServices: ['serv-1']
  },
  {
    id: 'veh-3',
    companyId: 'comp-101',
    customerId: 'cust-3',
    customerName: 'Inversiones Veloz SRL',
    plate: 'L388102',
    make: 'Isuzu',
    model: 'D-Max 4x4',
    year: 2022,
    color: 'Blanco',
    category: 'pickup',
    notes: 'Suele llegar con fango de obra.'
  },
  {
    id: 'veh-4',
    companyId: 'comp-101',
    customerId: 'cust-4',
    customerName: 'Cliente General',
    plate: 'A712994',
    make: 'Hyundai',
    model: 'Tucson',
    year: 2021,
    color: 'Azul Marino',
    category: 'suv'
  }
];

export const initialServices: Service[] = [
  {
    id: 'serv-1',
    companyId: 'comp-101',
    code: 'LAV-EXPRESS',
    name: 'Lavado Espuma Express & Secado',
    description: 'Champú neutro con cañón de espuma, enjuague a alta presión, secado manual con microfibra y brillo de gomas.',
    category: 'Lavados Rápido',
    estimatedMinutes: 25,
    priceByVehicle: {
      sedan: 400,
      suv: 500,
      jeep: 550,
      pickup: 600,
      van: 700,
      truck: 1200,
      motorcycle: 250,
      special: 800
    },
    commissionPercent: 10,
    requiresInspection: false,
    includedInMembego: true,
    isPopular: true,
    isActive: true
  },
  {
    id: 'serv-2',
    companyId: 'comp-101',
    code: 'LAV-COMPLETO',
    name: 'Lavado Completo Premium + Aspirado Profundo',
    description: 'Lavado exterior con espumado cerámico, aspirado minucioso de alfombras y asientos, limpieza de tableros, aroma interior y acondicionador de gomas.',
    category: 'Lavados Premium',
    estimatedMinutes: 45,
    priceByVehicle: {
      sedan: 700,
      suv: 850,
      jeep: 950,
      pickup: 1000,
      van: 1200,
      truck: 1800,
      motorcycle: 400,
      special: 1400
    },
    commissionPercent: 12,
    requiresInspection: true,
    includedInMembego: true,
    isPopular: true,
    isActive: true
  },
  {
    id: 'serv-3',
    companyId: 'comp-101',
    code: 'DET-INTERIOR',
    name: 'Detallado Interior Profundo & Desinfección Vapor',
    description: 'Champú e inyección-extracción de tapicería/cuero, desinfección a vapor de ductos de A/C, eliminación de manchas y olores.',
    category: 'Detallado Profesional',
    estimatedMinutes: 120,
    priceByVehicle: {
      sedan: 2800,
      suv: 3500,
      jeep: 3800,
      pickup: 4000,
      van: 4800,
      truck: 6000,
      motorcycle: 1200,
      special: 5000
    },
    commissionPercent: 15,
    requiresInspection: true,
    includedInMembego: false,
    isActive: true
  },
  {
    id: 'serv-4',
    companyId: 'comp-101',
    code: 'CERA-CERAMIC',
    name: 'Lavado Motor & Encerado Cerámico Expres',
    description: 'Desengrasado seguro de motor con protector dieléctrico, más aplicación de sellador cerámico repelente al agua y polvo.',
    category: 'Protección Exterior',
    estimatedMinutes: 60,
    priceByVehicle: {
      sedan: 1500,
      suv: 1800,
      jeep: 2000,
      pickup: 2200,
      van: 2500,
      truck: 3200,
      motorcycle: 800,
      special: 2800
    },
    commissionPercent: 12,
    requiresInspection: true,
    includedInMembego: true,
    isActive: true
  },
  {
    id: 'serv-5',
    companyId: 'comp-101',
    code: 'PUL-CRISTAL',
    name: 'Pulido de Cristales & Restauración de Luces',
    description: 'Eliminación de gotas de lluvia ácida en cristales y pulido óptico de faros delanteros con sellador UV.',
    category: 'Especiales',
    estimatedMinutes: 50,
    priceByVehicle: {
      sedan: 1200,
      suv: 1400,
      jeep: 1500,
      pickup: 1500,
      van: 1800,
      truck: 2000,
      motorcycle: 600,
      special: 2000
    },
    commissionPercent: 12,
    requiresInspection: false,
    includedInMembego: false,
    isActive: true
  }
];

export const initialProducts: Product[] = [
  {
    id: 'prod-1',
    companyId: 'comp-101',
    branchId: 'branch-1',
    code: 'ARO-MEMBEGO',
    barcode: '74600100201',
    name: 'Aromatizante Premium Membego Scent (Carro Nuevo)',
    category: 'Aromatizantes',
    cost: 80,
    price: 250,
    stock: 48,
    minStock: 10,
    unit: 'Unidad',
    isForSale: true
  },
  {
    id: 'prod-2',
    companyId: 'comp-101',
    branchId: 'branch-1',
    code: 'PAÑO-MICRO',
    barcode: '74600100202',
    name: 'Toalla Microfibra 40x40 Extra Suave (Venta)',
    category: 'Accesorios',
    cost: 60,
    price: 180,
    stock: 35,
    minStock: 15,
    unit: 'Unidad',
    isForSale: true
  },
  {
    id: 'prod-3',
    companyId: 'comp-101',
    branchId: 'branch-1',
    code: 'SILICONA-GOMA',
    barcode: '74600100203',
    name: 'Brillo de Gomas Meguiars Endurance 16oz',
    category: 'Accesorios',
    cost: 450,
    price: 950,
    stock: 12,
    minStock: 5,
    unit: 'Unidad',
    isForSale: true
  },
  {
    id: 'prod-4',
    companyId: 'comp-101',
    branchId: 'branch-1',
    code: 'INS-JABON-GAL',
    name: 'Champú de Lavado Neutro Concentrado 5 Galones',
    category: 'Químicos Uso Interno',
    cost: 2200,
    price: 0,
    stock: 4,
    minStock: 2,
    unit: 'Galón',
    isForSale: false
  }
];

export const initialBays: Bay[] = [
  {
    id: 'bay-1',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Bahía 1 - Espumado & Alta Presión',
    type: 'prelavado',
    status: 'ocupada',
    currentOrderId: 'order-1002',
    currentVehiclePlate: 'A000101',
    assignedEmployeeName: 'Juan José "El Flaco"'
  },
  {
    id: 'bay-2',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Bahía 2 - Espumado Exterior',
    type: 'lavado',
    status: 'ocupada',
    currentOrderId: 'order-1003',
    currentVehiclePlate: 'G412098',
    assignedEmployeeName: 'Dioris Batista'
  },
  {
    id: 'bay-3',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Bahía 3 - Aspirado Interior Profundo',
    type: 'aspirado',
    status: 'disponible'
  },
  {
    id: 'bay-4',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Bahía 4 - Secado & Brillo Cristales',
    type: 'secado',
    status: 'disponible'
  },
  {
    id: 'bay-5',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Bahía 5 - Detallado & Encerado',
    type: 'detallado',
    status: 'mantenimiento'
  },
  {
    id: 'bay-6',
    companyId: 'comp-101',
    branchId: 'branch-1',
    name: 'Bahía 6 - Control de Calidad & Entrega',
    type: 'qc',
    status: 'disponible'
  }
];

export const initialWorkOrders: WorkOrder[] = [
  {
    id: 'order-1001',
    companyId: 'comp-101',
    branchId: 'branch-1',
    orderNumber: 'CW-2026-0081',
    customerId: 'cust-3',
    customerName: 'Inversiones Veloz SRL',
    customerPhone: '809-555-0103',
    vehicleId: 'veh-3',
    vehiclePlate: 'L388102',
    vehicleMakeModel: 'Isuzu D-Max 4x4',
    vehicleCategory: 'pickup',
    vehicleColor: 'Blanco',
    status: 'entregado',
    priority: 'normal',
    bayId: 'bay-6',
    bayName: 'Bahía 6 - Control de Calidad & Entrega',
    assignedEmployeeIds: ['usr-5'],
    assignedEmployeeNames: ['Juan José "El Flaco"'],
    items: [
      {
        id: 'item-1',
        itemType: 'service',
        itemId: 'serv-2',
        name: 'Lavado Completo Premium + Aspirado Profundo (Pickup)',
        quantity: 1,
        unitPrice: 1000,
        discount: 0,
        total: 1000
      }
    ],
    subtotal: 1000,
    discountTotal: 0,
    membegoBenefitDiscount: 0,
    taxTotal: 180,
    total: 1180,
    paymentStatus: 'pagado',
    paymentMethod: 'transferencia',
    arrivalTime: '2026-07-28T09:10:00Z',
    startTime: '2026-07-28T09:15:00Z',
    finishTime: '2026-07-28T10:00:00Z',
    deliveryTime: '2026-07-28T10:10:00Z',
    createdBy: 'usr-4',
    createdByName: 'Marcos Peralta'
  },
  {
    id: 'order-1002',
    companyId: 'comp-101',
    branchId: 'branch-1',
    orderNumber: 'CW-2026-0082',
    customerId: 'cust-1',
    customerName: 'Ramón Peña (Demo)',
    customerPhone: '809-555-0101',
    vehicleId: 'veh-1',
    vehiclePlate: 'A000101',
    vehicleMakeModel: 'Toyota Land Cruiser Prado',
    vehicleCategory: 'suv',
    vehicleColor: 'Blanco Perlado',
    status: 'en_proceso',
    priority: 'vip_membego',
    bayId: 'bay-1',
    bayName: 'Bahía 1 - Espumado & Alta Presión',
    assignedEmployeeIds: ['usr-5'],
    assignedEmployeeNames: ['Juan José "El Flaco"'],
    items: [
      {
        id: 'item-2',
        itemType: 'service',
        itemId: 'serv-2',
        name: 'Lavado Completo Premium + Aspirado Profundo (SUV)',
        quantity: 1,
        unitPrice: 850,
        discount: 850,
        total: 0,
        isMembegoCovered: true
      },
      {
        id: 'item-3',
        itemType: 'product',
        itemId: 'prod-1',
        name: 'Aromatizante Premium Membego Scent',
        quantity: 1,
        unitPrice: 250,
        discount: 0,
        total: 250
      }
    ],
    subtotal: 1100,
    discountTotal: 850,
    membegoBenefitDiscount: 850,
    taxTotal: 45,
    total: 295,
    paymentStatus: 'pagado',
    paymentMethod: 'membego_beneficio',
    membegoCustomerId: 'mbg-usr-9001',
    membegoMembershipId: 'mbg-mem-99',
    membegoBenefitId: 'ben-01-diamond',
    membegoRedemptionId: 'rdm-771029',
    benefitStatus: 'reservado',
    arrivalTime: '2026-07-28T14:15:00Z',
    startTime: '2026-07-28T14:20:00Z',
    estimatedCompletionTime: '2026-07-28T15:05:00Z',
    inspection: {
      id: 'insp-1',
      workOrderId: 'order-1002',
      fuelLevel: '3/4',
      scratchesDamagesNote: 'Pequeño rayón preexistente en parachoques trasero derecho.',
      valuableItemsNote: 'Lentes de sol en consola central verificados.',
      inspectedBy: 'Marcos Peralta',
      inspectedAt: '2026-07-28T14:16:00Z'
    },
    notes: 'Aplicar cuido especial en secado sin frotar con fuerza.',
    createdBy: 'usr-4',
    createdByName: 'Marcos Peralta'
  },
  {
    id: 'order-1003',
    companyId: 'comp-101',
    branchId: 'branch-1',
    orderNumber: 'CW-2026-0083',
    customerId: 'cust-2',
    customerName: 'Marisol Guzmán (Demo)',
    customerPhone: '829-555-0102',
    vehicleId: 'veh-2',
    vehiclePlate: 'G412098',
    vehicleMakeModel: 'Honda Civic Turbo',
    vehicleCategory: 'sedan',
    vehicleColor: 'Gris Grafito',
    status: 'en_espera',
    priority: 'vip_membego',
    bayId: 'bay-2',
    bayName: 'Bahía 2 - Espumado Exterior',
    assignedEmployeeIds: ['usr-6'],
    assignedEmployeeNames: ['Dioris Batista'],
    items: [
      {
        id: 'item-4',
        itemType: 'service',
        itemId: 'serv-1',
        name: 'Lavado Espuma Express & Secado (Sedán)',
        quantity: 1,
        unitPrice: 400,
        discount: 400,
        total: 0,
        isMembegoCovered: true
      }
    ],
    subtotal: 400,
    discountTotal: 400,
    membegoBenefitDiscount: 400,
    taxTotal: 0,
    total: 0,
    paymentStatus: 'pagado',
    paymentMethod: 'membego_beneficio',
    membegoCustomerId: 'mbg-usr-9022',
    membegoMembershipId: 'mbg-mem-102',
    membegoBenefitId: 'ben-02-gold',
    membegoRedemptionId: 'rdm-771030',
    benefitStatus: 'reservado',
    arrivalTime: '2026-07-28T14:40:00Z',
    createdBy: 'usr-4',
    createdByName: 'Marcos Peralta'
  },
  {
    id: 'order-1004',
    companyId: 'comp-101',
    branchId: 'branch-1',
    orderNumber: 'CW-2026-0084',
    customerId: 'cust-4',
    customerName: 'Cliente Visitante (Anónimo)',
    vehicleId: 'veh-4',
    vehiclePlate: 'A712994',
    vehicleMakeModel: 'Hyundai Tucson',
    vehicleCategory: 'suv',
    vehicleColor: 'Azul Marino',
    status: 'pendiente',
    priority: 'normal',
    assignedEmployeeIds: [],
    assignedEmployeeNames: [],
    items: [
      {
        id: 'item-5',
        itemType: 'service',
        itemId: 'serv-1',
        name: 'Lavado Espuma Express & Secado (SUV)',
        quantity: 1,
        unitPrice: 500,
        discount: 0,
        total: 500
      }
    ],
    subtotal: 500,
    discountTotal: 0,
    membegoBenefitDiscount: 0,
    taxTotal: 90,
    total: 590,
    paymentStatus: 'pendiente',
    arrivalTime: '2026-07-28T14:55:00Z',
    createdBy: 'usr-3',
    createdByName: 'Ana Beltrán'
  }
];

export const initialInvoices: Invoice[] = [
  {
    id: 'inv-8801',
    companyId: 'comp-101',
    branchId: 'branch-1',
    invoiceNumber: 'FAC-001042',
    ncfFiscalNumber: 'B0100008819',
    workOrderId: 'order-1001',
    customerId: 'cust-3',
    customerName: 'Inversiones Veloz SRL',
    customerTaxId: '000-22222-2',
    vehiclePlate: 'L388102',
    items: [
      {
        id: 'item-1',
        itemType: 'service',
        itemId: 'serv-2',
        name: 'Lavado Completo Premium + Aspirado Profundo (Pickup)',
        quantity: 1,
        unitPrice: 1000,
        discount: 0,
        total: 1000
      }
    ],
    subtotal: 1000,
    discount: 0,
    tax: 180,
    total: 1180,
    payments: [
      {
        method: 'transferencia',
        amount: 1180,
        reference: 'BANRESERVAS-891023'
      }
    ],
    changeAmount: 0,
    cashSessionId: 'cses-2026-0728',
    cashierId: 'usr-3',
    cashierName: 'Ana Beltrán',
    createdAt: '2026-07-28T10:10:00Z'
  }
];

export const initialCashSession: CashSession = {
  id: 'cses-2026-0728',
  companyId: 'comp-101',
  branchId: 'branch-1',
  cashierId: 'usr-3',
  cashierName: 'Ana Beltrán (Cajera POS)',
  openedAt: '2026-07-28T07:30:00Z',
  initialAmount: 3000,
  totalCashSales: 4500,
  totalCardSales: 6200,
  totalTransferSales: 1180,
  totalMembegoRedemptions: 1250,
  totalInflows: 0,
  totalOutflows: 200,
  expectedCash: 7300, // 3000 initial + 4500 cash - 200 outflow
  status: 'open',
  notes: 'Caja operando normalmente. Cambio de RD$3,000 verificado.'
};

export const initialExpenses: Expense[] = [
  {
    id: 'exp-01',
    companyId: 'comp-101',
    branchId: 'branch-1',
    category: 'quimicos_insumos',
    description: 'Compra de garrafón de limpia vidrios concentrado',
    amount: 850,
    paymentMethod: 'efectivo',
    supplierName: 'Distribuidora AutoQuimica SRL',
    expenseDate: '2026-07-28T11:00:00Z',
    createdBy: 'usr-2',
    createdAt: '2026-07-28T11:05:00Z'
  }
];

export const initialCommissionEntries: CommissionEntry[] = [
  {
    id: 'com-1',
    companyId: 'comp-101',
    branchId: 'branch-1',
    employeeId: 'usr-5',
    employeeName: 'Juan José "El Flaco"',
    workOrderId: 'order-1001',
    serviceName: 'Lavado Completo Premium',
    servicePrice: 1000,
    commissionPercent: 12,
    commissionAmount: 120,
    date: '2026-07-28T10:00:00Z',
    isPaid: false
  }
];

export const initialAuditLogs: AuditLog[] = [
  {
    id: 'audit-1',
    companyId: 'comp-101',
    branchId: 'branch-1',
    userId: 'usr-3',
    userName: 'Ana Beltrán',
    userRole: 'cajero',
    action: 'APERTURA_CAJA',
    entity: 'CashSession',
    entityId: 'cses-2026-0728',
    details: 'Apertura de caja con fondo inicial de RD$ 3,000.00',
    timestamp: '2026-07-28T07:30:00Z'
  },
  {
    id: 'audit-2',
    companyId: 'comp-101',
    branchId: 'branch-1',
    userId: 'usr-4',
    userName: 'Marcos Peralta',
    userRole: 'recepcionista',
    action: 'VALIDAR_BENEFICIO_MEMBEGO',
    entity: 'MembegoBenefit',
    entityId: 'ben-01-diamond',
    details: 'Membresía validada e IdempotencyKey registrada para Ramón Peña (Demo) (Toyota Prado A000101)',
    timestamp: '2026-07-28T14:15:00Z'
  }
];
