import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Company,
  Branch,
  User,
  UserRole,
  Customer,
  Vehicle,
  Service,
  Product,
  WorkOrder,
  OrderStatus,
  Bay,
  Invoice,
  CashSession,
  Expense,
  CommissionEntry,
  AuditLog,
  PaymentMethodType,
  WorkOrderItem,
  VehicleCategory
} from '../types';
import {
  initialCompany,
  initialBranches,
  initialUsers,
  initialCustomers,
  initialVehicles,
  initialServices,
  initialProducts,
  initialBays,
  initialWorkOrders,
  initialInvoices,
  initialCashSession,
  initialExpenses,
  initialCommissionEntries,
  initialAuditLogs
} from '../data/initialData';
import { membegoApiService } from '../services/membegoApi';
import { supabaseSyncService } from '../services/supabaseSync';
import { getSupabaseClient } from '../lib/supabase';

interface AppContextType {
  company: Company;
  branches: Branch[];
  currentBranch: Branch;
  setCurrentBranch: (branch: Branch) => void;

  users: User[];
  currentUser: User;
  setCurrentUser: (user: User) => void;
  switchRole: (role: UserRole) => void;

  customers: Customer[];
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'totalVisits' | 'totalSpent'>) => Customer;
  updateCustomer: (customer: Customer) => void;

  vehicles: Vehicle[];
  addVehicle: (vehicle: Omit<Vehicle, 'id'>) => Vehicle;

  services: Service[];
  addService: (service: Omit<Service, 'id'>) => void;
  updateService: (service: Service) => void;

  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (product: Product) => void;

  workOrders: WorkOrder[];
  addWorkOrder: (order: Omit<WorkOrder, 'id' | 'orderNumber' | 'subtotal' | 'discountTotal' | 'taxTotal' | 'total' | 'arrivalTime'> & { items: WorkOrderItem[] }) => WorkOrder;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus, bayId?: string, employeeIds?: string[]) => void;
  assignWashersToOrder: (orderId: string, employeeIds: string[], employeeNames: string[]) => void;

  bays: Bay[];
  updateBayStatus: (bayId: string, status: Bay['status'], currentOrderId?: string) => void;

  cashSession: CashSession | null;
  openCashSession: (initialAmount: number, notes?: string) => void;
  closeCashSession: (countedCash: number, notes?: string) => void;

  invoices: Invoice[];
  createInvoice: (
    workOrderId: string | undefined,
    customerName: string,
    customerTaxId: string | undefined,
    vehiclePlate: string | undefined,
    items: WorkOrderItem[],
    payments: { method: PaymentMethodType; amount: number; reference?: string }[],
    ncfFiscalNumber?: string
  ) => Invoice;
  annulInvoice: (invoiceId: string, reason: string) => void;

  expenses: Expense[];
  addExpense: (expense: Omit<Expense, 'id' | 'createdAt'>) => void;

  commissions: CommissionEntry[];

  auditLogs: AuditLog[];
  addAuditLog: (action: string, entity: string, details: string, entityId?: string) => void;

  // Membego sync state
  isMembegoOnline: boolean;
  toggleMembegoOnline: () => void;

  // Modals & Active View state
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isNuevaLlegadaOpen: boolean;
  setIsNuevaLlegadaOpen: (open: boolean) => void;
  isQrModalOpen: boolean;
  setIsQrModalOpen: (open: boolean) => void;
  isArchModalOpen: boolean;
  setIsArchModalOpen: (open: boolean) => void;
  isSupabaseModalOpen: boolean;
  setIsSupabaseModalOpen: (open: boolean) => void;

  // Authentication State & Actions
  isAuthenticated: boolean;
  loginWithUser: (user: User, pinCode?: string) => { success: boolean; message: string };
  loginWithEmail: (email: string, password?: string) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [company, setCompany] = useState<Company>(() => {
    const saved = localStorage.getItem('membego_cw_company');
    return saved ? JSON.parse(saved) : initialCompany;
  });

  const [branches] = useState<Branch[]>(initialBranches);
  const [currentBranch, setCurrentBranch] = useState<Branch>(initialBranches[0]);

  const [users] = useState<User[]>(initialUsers);
  
  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem('membego_auth_user');
    return saved ? JSON.parse(saved) : initialUsers[0];
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);

  const loginWithUser = (user: User, pinCode?: string): { success: boolean; message: string } => {
    if (user.pinCode && pinCode && user.pinCode !== pinCode) {
      return { success: false, message: 'El PIN ingresado es incorrecto.' };
    }
    setCurrentUser(user);
    setIsAuthenticated(true);
    localStorage.setItem('membego_is_authenticated', 'true');
    localStorage.setItem('membego_auth_user', JSON.stringify(user));
    
    // Log audit event
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      companyId: user.companyId,
      branchId: user.branchId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: 'INICIO_SESION_POS',
      entity: 'Auth',
      details: `Inicio de sesión rápido de personal POS: ${user.name} (${user.role})`,
      timestamp: new Date().toISOString()
    };
    setAuditLogs(prev => [newLog, ...prev]);
    supabaseSyncService.syncAuditLog(newLog);

    return { success: true, message: `¡Bienvenido(a) ${user.name}!` };
  };

  const loginWithEmail = async (email: string, password?: string): Promise<{ success: boolean; message: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    
    // Try Supabase Auth if client is available and password provided
    const supabase = getSupabaseClient();
    if (supabase && password) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (!error && data.user) {
          const matched = users.find(u => u.email.toLowerCase() === cleanEmail) || {
            id: data.user.id,
            companyId: company.id,
            branchId: currentBranch.id,
            name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'Usuario Cloud',
            email: data.user.email || cleanEmail,
            phone: '',
            role: 'administrador' as UserRole,
            isActive: true
          };
          setCurrentUser(matched);
          setIsAuthenticated(true);
          localStorage.setItem('membego_is_authenticated', 'true');
          localStorage.setItem('membego_auth_user', JSON.stringify(matched));

          const newLog: AuditLog = {
            id: `log-${Date.now()}`,
            companyId: matched.companyId,
            branchId: matched.branchId,
            userId: matched.id,
            userName: matched.name,
            userRole: matched.role,
            action: 'INICIO_SESION_SUPABASE',
            entity: 'Auth',
            details: `Autenticación exitosa en Supabase Cloud (${cleanEmail})`,
            timestamp: new Date().toISOString()
          };
          setAuditLogs(prev => [newLog, ...prev]);
          supabaseSyncService.syncAuditLog(newLog);

          return { success: true, message: 'Autenticación con Supabase completada correctamente.' };
        }
      } catch (err) {
        console.warn('Supabase auth exception:', err);
      }
    }

    // Local / PIN Fallback matching
    const matchedUser = users.find(u => u.email.toLowerCase() === cleanEmail);
    if (matchedUser) {
      if (matchedUser.pinCode && password && matchedUser.pinCode !== password) {
        return { success: false, message: 'La contraseña / PIN es incorrecto.' };
      }
      setCurrentUser(matchedUser);
      setIsAuthenticated(true);
      localStorage.setItem('membego_is_authenticated', 'true');
      localStorage.setItem('membego_auth_user', JSON.stringify(matchedUser));

      const newLog: AuditLog = {
        id: `log-${Date.now()}`,
        companyId: matchedUser.companyId,
        branchId: matchedUser.branchId,
        userId: matchedUser.id,
        userName: matchedUser.name,
        userRole: matchedUser.role,
        action: 'INICIO_SESION_LOCAL',
        entity: 'Auth',
        details: `Inicio de sesión por correo local: ${matchedUser.name}`,
        timestamp: new Date().toISOString()
      };
      setAuditLogs(prev => [newLog, ...prev]);
      supabaseSyncService.syncAuditLog(newLog);

      return { success: true, message: `¡Bienvenido(a) ${matchedUser.name}!` };
    }

    return { success: false, message: 'Usuario no encontrado. Verifique las credenciales ingresadas.' };
  };

  const logout = async (): Promise<void> => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Error closing Supabase session:', err);
      }
    }

    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      companyId: currentUser.companyId,
      branchId: currentUser.branchId,
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      action: 'CERRAR_SESION',
      entity: 'Auth',
      details: `Sesión cerrada por ${currentUser.name}`,
      timestamp: new Date().toISOString()
    };
    setAuditLogs(prev => [newLog, ...prev]);
    supabaseSyncService.syncAuditLog(newLog);

    setIsAuthenticated(false);
    localStorage.removeItem('membego_is_authenticated');
    localStorage.removeItem('membego_auth_user');
  };

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('membego_cw_customers');
    return saved ? JSON.parse(saved) : initialCustomers;
  });

  const [vehicles, setVehicles] = useState<Vehicle[]>(() => {
    const saved = localStorage.getItem('membego_cw_vehicles');
    return saved ? JSON.parse(saved) : initialVehicles;
  });

  const [services, setServices] = useState<Service[]>(() => {
    const saved = localStorage.getItem('membego_cw_services');
    return saved ? JSON.parse(saved) : initialServices;
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('membego_cw_products');
    return saved ? JSON.parse(saved) : initialProducts;
  });

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() => {
    const saved = localStorage.getItem('membego_cw_workorders');
    return saved ? JSON.parse(saved) : initialWorkOrders;
  });

  const [bays, setBays] = useState<Bay[]>(() => {
    const saved = localStorage.getItem('membego_cw_bays');
    return saved ? JSON.parse(saved) : initialBays;
  });

  const [cashSession, setCashSession] = useState<CashSession | null>(() => {
    const saved = localStorage.getItem('membego_cw_cashsession');
    return saved ? JSON.parse(saved) : initialCashSession;
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    const saved = localStorage.getItem('membego_cw_invoices');
    return saved ? JSON.parse(saved) : initialInvoices;
  });

  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const saved = localStorage.getItem('membego_cw_expenses');
    return saved ? JSON.parse(saved) : initialExpenses;
  });

  const [commissions, setCommissions] = useState<CommissionEntry[]>(initialCommissionEntries);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(initialAuditLogs);

  const [isMembegoOnline, setIsMembegoOnline] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isNuevaLlegadaOpen, setIsNuevaLlegadaOpen] = useState<boolean>(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState<boolean>(false);
  const [isArchModalOpen, setIsArchModalOpen] = useState<boolean>(false);
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState<boolean>(false);

  // Load initial work orders from Supabase if configured & available
  useEffect(() => {
    (async () => {
      const dbOrders = await supabaseSyncService.fetchWorkOrders();
      if (dbOrders && dbOrders.length > 0) {
        setWorkOrders(dbOrders);
      }
    })();
  }, []);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('membego_cw_workorders', JSON.stringify(workOrders));
  }, [workOrders]);

  useEffect(() => {
    localStorage.setItem('membego_cw_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('membego_cw_vehicles', JSON.stringify(vehicles));
  }, [vehicles]);

  useEffect(() => {
    localStorage.setItem('membego_cw_invoices', JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem('membego_cw_cashsession', JSON.stringify(cashSession));
  }, [cashSession]);

  const switchRole = (role: UserRole) => {
    const found = users.find(u => u.role === role);
    if (found) {
      setCurrentUser(found);
      addAuditLog('CAMBIO_ROL_ACTIVO', 'User', `Modo de vista cambiado a: ${found.name} (${found.role})`);
    }
  };

  const addAuditLog = (action: string, entity: string, details: string, entityId?: string) => {
    const log: AuditLog = {
      id: `audit-${Date.now()}`,
      companyId: company.id,
      branchId: currentBranch.id,
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      action,
      entity,
      entityId,
      details,
      timestamp: new Date().toISOString()
    };
    setAuditLogs(prev => [log, ...prev]);
  };

  const toggleMembegoOnline = () => {
    const next = !isMembegoOnline;
    setIsMembegoOnline(next);
    membegoApiService.setOnlineStatus(next);
    addAuditLog('TOGGLE_MEMBEGO_ONLINE', 'System', `Estado de conexión con Membego cambiado a: ${next ? 'En Línea' : 'Fuera de Línea (Modo Contingencia)'}`);
  };

  const addCustomer = (data: Omit<Customer, 'id' | 'createdAt' | 'totalVisits' | 'totalSpent'>): Customer => {
    const newCust: Customer = {
      ...data,
      id: `cust-${Date.now()}`,
      companyId: company.id,
      branchId: currentBranch.id,
      totalVisits: 0,
      totalSpent: 0,
      createdAt: new Date().toISOString()
    };
    setCustomers(prev => [newCust, ...prev]);
    addAuditLog('CREAR_CLIENTE', 'Customer', `Cliente creado: ${newCust.name} (${newCust.phone || 'Sin tel'})`, newCust.id);
    supabaseSyncService.syncCustomer(newCust);
    return newCust;
  };

  const updateCustomer = (updated: Customer) => {
    setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
    addAuditLog('ACTUALIZAR_CLIENTE', 'Customer', `Cliente actualizado: ${updated.name}`, updated.id);
  };

  const addVehicle = (data: Omit<Vehicle, 'id'>): Vehicle => {
    const newVeh: Vehicle = {
      ...data,
      id: `veh-${Date.now()}`,
      companyId: company.id
    };
    setVehicles(prev => [newVeh, ...prev]);
    addAuditLog('CREAR_VEHICULO', 'Vehicle', `Vehículo registrado: ${newVeh.make} ${newVeh.model} (${newVeh.plate})`, newVeh.id);
    return newVeh;
  };

  const addService = (data: Omit<Service, 'id'>) => {
    const newServ: Service = { ...data, id: `serv-${Date.now()}`, companyId: company.id };
    setServices(prev => [...prev, newServ]);
    addAuditLog('CREAR_SERVICIO', 'Service', `Servicio añadido: ${newServ.name}`);
  };

  const updateService = (updated: Service) => {
    setServices(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const addProduct = (data: Omit<Product, 'id'>) => {
    const newProd: Product = { ...data, id: `prod-${Date.now()}`, companyId: company.id, branchId: currentBranch.id };
    setProducts(prev => [...prev, newProd]);
  };

  const updateProduct = (updated: Product) => {
    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const addWorkOrder = (
    data: Omit<WorkOrder, 'id' | 'orderNumber' | 'subtotal' | 'discountTotal' | 'taxTotal' | 'total' | 'arrivalTime'> & { items: WorkOrderItem[] }
  ): WorkOrder => {
    const now = new Date();
    const orderNum = `CW-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    let subtotal = 0;
    let discountTotal = 0;
    let membegoBenefitDiscount = 0;

    data.items.forEach(item => {
      subtotal += item.unitPrice * item.quantity;
      if (item.isMembegoCovered) {
        membegoBenefitDiscount += item.unitPrice * item.quantity;
      } else {
        discountTotal += item.discount;
      }
    });

    const taxableAmount = Math.max(0, subtotal - discountTotal - membegoBenefitDiscount);
    const taxTotal = Math.round(taxableAmount * (company.taxRate / 100));
    const total = Math.max(0, taxableAmount + taxTotal);

    const newOrder: WorkOrder = {
      ...data,
      id: `order-${Date.now()}`,
      orderNumber: orderNum,
      companyId: company.id,
      branchId: currentBranch.id,
      subtotal,
      discountTotal,
      membegoBenefitDiscount,
      taxTotal,
      total,
      arrivalTime: now.toISOString()
    };

    setWorkOrders(prev => [newOrder, ...prev]);

    // Update customer visits stats if customer attached
    if (data.customerId) {
      setCustomers(prev => prev.map(c => {
        if (c.id === data.customerId) {
          return {
            ...c,
            totalVisits: c.totalVisits + 1,
            lastVisitAt: now.toISOString()
          };
        }
        return c;
      }));
    }

    addAuditLog('NUEVA_LLEGADA_ORDEN', 'WorkOrder', `Nueva orden de servicio creada: ${newOrder.orderNumber} para ${newOrder.vehiclePlate} (${newOrder.customerName})`, newOrder.id);
    supabaseSyncService.syncWorkOrder(newOrder);
    return newOrder;
  };

  const updateOrderStatus = (orderId: string, newStatus: OrderStatus, bayId?: string, employeeIds?: string[]) => {
    setWorkOrders(prev => prev.map(order => {
      if (order.id === orderId) {
        const now = new Date().toISOString();
        const updated: WorkOrder = {
          ...order,
          status: newStatus,
          bayId: bayId || order.bayId,
          assignedEmployeeIds: employeeIds || order.assignedEmployeeIds,
          startTime: newStatus === 'en_proceso' ? (order.startTime || now) : order.startTime,
          finishTime: (newStatus === 'listo' || newStatus === 'control_calidad') ? (order.finishTime || now) : order.finishTime,
          deliveryTime: newStatus === 'entregado' ? now : order.deliveryTime
        };

        // If delivered and had Membego benefit, confirm redemption in background
        if (newStatus === 'entregado' && order.membegoRedemptionId && order.membegoBenefitId) {
          membegoApiService.confirmRedemption(order.membegoRedemptionId, `idemp-confirm-${order.id}`);
        }

        return updated;
      }
      return order;
    }));

    addAuditLog('CAMBIO_ESTADO_ORDEN', 'WorkOrder', `Orden ${orderId} cambió a estado: ${newStatus}`, orderId);
  };

  const assignWashersToOrder = (orderId: string, employeeIds: string[], employeeNames: string[]) => {
    setWorkOrders(prev => prev.map(order => {
      if (order.id === orderId) {
        return {
          ...order,
          assignedEmployeeIds: employeeIds,
          assignedEmployeeNames: employeeNames
        };
      }
      return order;
    }));
  };

  const updateBayStatus = (bayId: string, status: Bay['status'], currentOrderId?: string) => {
    setBays(prev => prev.map(b => {
      if (b.id === bayId) {
        return {
          ...b,
          status,
          currentOrderId: currentOrderId !== undefined ? currentOrderId : b.currentOrderId
        };
      }
      return b;
    }));
  };

  const openCashSession = (initialAmount: number, notes?: string) => {
    const newSession: CashSession = {
      id: `cses-${Date.now()}`,
      companyId: company.id,
      branchId: currentBranch.id,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      openedAt: new Date().toISOString(),
      initialAmount,
      totalCashSales: 0,
      totalCardSales: 0,
      totalTransferSales: 0,
      totalMembegoRedemptions: 0,
      totalInflows: 0,
      totalOutflows: 0,
      expectedCash: initialAmount,
      status: 'open',
      notes
    };
    setCashSession(newSession);
    addAuditLog('APERTURA_CAJA', 'CashSession', `Caja abierta por ${currentUser.name} con fondo de RD$ ${initialAmount.toLocaleString()}`, newSession.id);
  };

  const closeCashSession = (countedCash: number, notes?: string) => {
    if (!cashSession) return;
    const now = new Date().toISOString();
    const diff = countedCash - cashSession.expectedCash;

    const closed: CashSession = {
      ...cashSession,
      closedAt: now,
      countedCash,
      cashDifference: diff,
      status: 'closed',
      notes: notes || cashSession.notes
    };
    setCashSession(closed);
    addAuditLog('CIERRE_CAJA', 'CashSession', `Caja cerrada. Contado: RD$ ${countedCash}. Diferencia: RD$ ${diff}`, closed.id);
  };

  const createInvoice = (
    workOrderId: string | undefined,
    customerName: string,
    customerTaxId: string | undefined,
    vehiclePlate: string | undefined,
    items: WorkOrderItem[],
    payments: { method: PaymentMethodType; amount: number; reference?: string }[],
    ncfFiscalNumber?: string
  ): Invoice => {
    let subtotal = 0;
    let discount = 0;

    items.forEach(i => {
      subtotal += i.unitPrice * i.quantity;
      discount += i.discount;
    });

    const tax = Math.round(Math.max(0, subtotal - discount) * (company.taxRate / 100));
    const total = Math.max(0, subtotal - discount + tax);

    const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
    const changeAmount = Math.max(0, totalPaid - total);

    const invNum = `FAC-${Math.floor(100000 + Math.random() * 900000)}`;

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      companyId: company.id,
      branchId: currentBranch.id,
      invoiceNumber: invNum,
      ncfFiscalNumber,
      workOrderId,
      customerName,
      customerTaxId,
      vehiclePlate,
      items,
      subtotal,
      discount,
      tax,
      total,
      payments,
      changeAmount,
      cashSessionId: cashSession?.id,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      createdAt: new Date().toISOString()
    };

    setInvoices(prev => [newInvoice, ...prev]);

    // Update Cash Session state
    if (cashSession && cashSession.status === 'open') {
      let cashAdd = 0;
      let cardAdd = 0;
      let transferAdd = 0;
      let membegoAdd = 0;

      payments.forEach(p => {
        if (p.method === 'efectivo') cashAdd += p.amount - changeAmount;
        if (p.method === 'tarjeta') cardAdd += p.amount;
        if (p.method === 'transferencia') transferAdd += p.amount;
        if (p.method === 'membego_beneficio') membegoAdd += p.amount;
      });

      setCashSession(prev => prev ? {
        ...prev,
        totalCashSales: prev.totalCashSales + cashAdd,
        totalCardSales: prev.totalCardSales + cardAdd,
        totalTransferSales: prev.totalTransferSales + transferAdd,
        totalMembegoRedemptions: prev.totalMembegoRedemptions + membegoAdd,
        expectedCash: prev.expectedCash + cashAdd
      } : null);
    }

    // Mark Work Order as paid if workOrderId exists
    if (workOrderId) {
      setWorkOrders(prev => prev.map(o => {
        if (o.id === workOrderId) {
          return {
            ...o,
            paymentStatus: 'pagado',
            paymentMethod: payments[0]?.method || 'efectivo'
          };
        }
        return o;
      }));
    }

    // Deduct products stock
    items.forEach(item => {
      if (item.itemType === 'product') {
        setProducts(prev => prev.map(p => {
          if (p.id === item.itemId) {
            return { ...p, stock: Math.max(0, p.stock - item.quantity) };
          }
          return p;
        }));
      }
    });

    addAuditLog('EMITIR_FACTURA', 'Invoice', `Factura ${newInvoice.invoiceNumber} por RD$ ${total.toLocaleString()} (${customerName})`, newInvoice.id);
    supabaseSyncService.syncInvoice(newInvoice);

    return newInvoice;
  };

  const annulInvoice = (invoiceId: string, reason: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id === invoiceId) {
        return {
          ...inv,
          isAnulled: true,
          annulledReason: reason,
          annulledAt: new Date().toISOString()
        };
      }
      return inv;
    }));
    addAuditLog('ANULAR_FACTURA', 'Invoice', `Factura ${invoiceId} anulada por ${currentUser.name}. Motivo: ${reason}`, invoiceId);
  };

  const addExpense = (data: Omit<Expense, 'id' | 'createdAt'>) => {
    const newExp: Expense = {
      ...data,
      id: `exp-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    setExpenses(prev => [newExp, ...prev]);

    // If paid in cash, update cash session outflow
    if (data.paymentMethod === 'efectivo' && cashSession && cashSession.status === 'open') {
      setCashSession(prev => prev ? {
        ...prev,
        totalOutflows: prev.totalOutflows + data.amount,
        expectedCash: Math.max(0, prev.expectedCash - data.amount)
      } : null);
    }

    addAuditLog('REGISTRAR_GASTO', 'Expense', `Gasto registrado: RD$ ${data.amount} (${data.description})`);
  };

  return (
    <AppContext.Provider
      value={{
        company,
        branches,
        currentBranch,
        setCurrentBranch,
        users,
        currentUser,
        setCurrentUser,
        switchRole,
        customers,
        addCustomer,
        updateCustomer,
        vehicles,
        addVehicle,
        services,
        addService,
        updateService,
        products,
        addProduct,
        updateProduct,
        workOrders,
        addWorkOrder,
        updateOrderStatus,
        assignWashersToOrder,
        bays,
        updateBayStatus,
        cashSession,
        openCashSession,
        closeCashSession,
        invoices,
        createInvoice,
        annulInvoice,
        expenses,
        addExpense,
        commissions,
        auditLogs,
        addAuditLog,
        isMembegoOnline,
        toggleMembegoOnline,
        activeTab,
        setActiveTab,
        isNuevaLlegadaOpen,
        setIsNuevaLlegadaOpen,
        isQrModalOpen,
        setIsQrModalOpen,
        isArchModalOpen,
        setIsArchModalOpen,
        isSupabaseModalOpen,
        setIsSupabaseModalOpen,
        isAuthenticated,
        loginWithUser,
        loginWithEmail,
        logout
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
