import { getSupabaseClient } from '../lib/supabase';
import { Customer, Vehicle, WorkOrder, Invoice, CashSession, Expense, AuditLog } from '../types';

class SupabaseSyncService {
  /**
   * Sync a new or updated Customer to Supabase
   */
  async syncCustomer(cust: Customer): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      const { error } = await supabase.from('customers').upsert({
        id: cust.id,
        company_id: cust.companyId,
        branch_id: cust.branchId,
        name: cust.name,
        phone: cust.phone || null,
        email: cust.email || null,
        tax_id: cust.taxId || null,
        address: cust.address || null,
        notes: cust.notes || null,
        is_anonymous_guest: cust.isAnonymousGuest || false,
        membego_customer_id: cust.membegoCustomerId || null,
        membego_status: cust.membegoStatus || null,
        membego_tier: cust.membegoTier || null,
        total_visits: cust.totalVisits || 0,
        total_spent: cust.totalSpent || 0,
        last_visit_at: cust.lastVisitAt || null,
        created_at: cust.createdAt
      });

      if (error) {
        console.warn('Supabase sync customer error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Supabase sync customer exception:', err);
      return false;
    }
  }

  /**
   * Sync a WorkOrder to Supabase
   */
  async syncWorkOrder(order: WorkOrder): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      const { error } = await supabase.from('work_orders').upsert({
        id: order.id,
        company_id: order.companyId,
        branch_id: order.branchId,
        order_number: order.orderNumber,
        customer_id: order.customerId || null,
        customer_name: order.customerName,
        customer_phone: order.customerPhone || null,
        vehicle_id: order.vehicleId || null,
        vehicle_plate: order.vehiclePlate,
        vehicle_make_model: order.vehicleMakeModel,
        vehicle_category: order.vehicleCategory,
        vehicle_color: order.vehicleColor,
        status: order.status,
        priority: order.priority,
        bay_id: order.bayId || null,
        bay_name: order.bayName || null,
        assigned_employees: order.assignedEmployeeNames || [],
        items: order.items || [],
        subtotal: order.subtotal,
        discount_total: order.discountTotal,
        membego_benefit_discount: order.membegoBenefitDiscount,
        tax_total: order.taxTotal,
        total: order.total,
        payment_status: order.paymentStatus,
        payment_method: order.paymentMethod || null,
        membego_customer_id: order.membegoCustomerId || null,
        membego_membership_id: order.membegoMembershipId || null,
        membego_benefit_id: order.membegoBenefitId || null,
        membego_redemption_id: order.membegoRedemptionId || null,
        benefit_status: order.benefitStatus || null,
        arrival_time: order.arrivalTime,
        start_time: order.startTime || null,
        finish_time: order.finishTime || null,
        delivery_time: order.deliveryTime || null,
        inspection: order.inspection || null,
        quality_check: order.qualityCheck || null,
        notes: order.notes || null,
        created_by: order.createdBy,
        created_by_name: order.createdByName,
        created_at: order.arrivalTime
      });

      if (error) {
        console.warn('Supabase sync work order error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Supabase sync work order exception:', err);
      return false;
    }
  }

  /**
   * Sync Invoice to Supabase
   */
  async syncInvoice(inv: Invoice): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      const { error } = await supabase.from('invoices').upsert({
        id: inv.id,
        company_id: inv.companyId,
        branch_id: inv.branchId,
        invoice_number: inv.invoiceNumber,
        ncf_fiscal_number: inv.ncfFiscalNumber || null,
        work_order_id: inv.workOrderId || null,
        customer_id: inv.customerId || null,
        customer_name: inv.customerName,
        customer_tax_id: inv.customerTaxId || null,
        vehicle_plate: inv.vehiclePlate || null,
        items: inv.items || [],
        subtotal: inv.subtotal,
        discount: inv.discount,
        tax: inv.tax,
        total: inv.total,
        payments: inv.payments || [],
        change_amount: inv.changeAmount,
        cash_session_id: inv.cashSessionId || null,
        cashier_id: inv.cashierId,
        cashier_name: inv.cashierName,
        is_anulled: inv.isAnulled || false,
        annulled_reason: inv.annulledReason || null,
        annulled_at: inv.annulledAt || null,
        created_at: inv.createdAt
      });

      if (error) {
        console.warn('Supabase sync invoice error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Supabase sync invoice exception:', err);
      return false;
    }
  }

  /**
   * Sync CashSession to Supabase
   */
  async syncCashSession(session: CashSession): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      const { error } = await supabase.from('cash_sessions').upsert({
        id: session.id,
        company_id: session.companyId,
        branch_id: session.branchId,
        cashier_id: session.cashierId,
        cashier_name: session.cashierName,
        opened_at: session.openedAt,
        closed_at: session.closedAt || null,
        initial_amount: session.initialAmount,
        total_cash_sales: session.totalCashSales,
        total_card_sales: session.totalCardSales,
        total_transfer_sales: session.totalTransferSales,
        total_membego_redemptions: session.totalMembegoRedemptions,
        total_inflows: session.totalInflows,
        total_outflows: session.totalOutflows,
        expected_cash: session.expectedCash,
        counted_cash: session.countedCash ?? null,
        cash_difference: session.cashDifference ?? null,
        status: session.status,
        notes: session.notes || null
      });

      if (error) {
        console.warn('Supabase sync cash session error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Supabase sync cash session exception:', err);
      return false;
    }
  }

  /**
   * Sync Expense to Supabase
   */
  async syncExpense(exp: Expense): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      const { error } = await supabase.from('expenses').upsert({
        id: exp.id,
        company_id: exp.companyId,
        branch_id: exp.branchId,
        category: exp.category,
        description: exp.description,
        amount: exp.amount,
        payment_method: exp.paymentMethod,
        supplier_name: exp.supplierName || null,
        invoice_ref: exp.invoiceRef || null,
        expense_date: exp.expenseDate,
        created_by: exp.createdBy,
        created_at: exp.createdAt
      });

      if (error) {
        console.warn('Supabase sync expense error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Supabase sync expense exception:', err);
      return false;
    }
  }

  /**
   * Sync Audit Log to Supabase
   */
  async syncAuditLog(log: AuditLog): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      const { error } = await supabase.from('audit_logs').insert({
        id: log.id,
        company_id: log.companyId,
        branch_id: log.branchId,
        user_id: log.userId,
        user_name: log.userName,
        user_role: log.userRole,
        action: log.action,
        entity: log.entity,
        entity_id: log.entityId || null,
        details: log.details,
        timestamp: log.timestamp
      });

      if (error) {
        console.warn('Supabase sync audit log error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Supabase sync audit log exception:', err);
      return false;
    }
  }

  /**
   * Fetch Work Orders from Supabase
   */
  async fetchWorkOrders(): Promise<WorkOrder[] | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !data) return null;

      return data.map(item => ({
        id: item.id,
        companyId: item.company_id,
        branchId: item.branch_id,
        orderNumber: item.order_number,
        customerId: item.customer_id,
        customerName: item.customer_name,
        customerPhone: item.customer_phone,
        vehicleId: item.vehicle_id,
        vehiclePlate: item.vehicle_plate,
        vehicleMakeModel: item.vehicle_make_model,
        vehicleCategory: item.vehicle_category,
        vehicleColor: item.vehicle_color,
        status: item.status,
        priority: item.priority || 'normal',
        bayId: item.bay_id,
        bayName: item.bay_name,
        assignedEmployeeIds: [],
        assignedEmployeeNames: item.assigned_employees || [],
        items: item.items || [],
        subtotal: item.subtotal || 0,
        discountTotal: item.discount_total || 0,
        membegoBenefitDiscount: item.membego_benefit_discount || 0,
        taxTotal: item.tax_total || 0,
        total: item.total || 0,
        paymentStatus: item.payment_status || 'pendiente',
        paymentMethod: item.payment_method,
        membegoCustomerId: item.membego_customer_id,
        membegoMembershipId: item.membego_membership_id,
        membegoBenefitId: item.membego_benefit_id,
        membegoRedemptionId: item.membego_redemption_id,
        benefitStatus: item.benefit_status,
        arrivalTime: item.arrival_time,
        startTime: item.start_time,
        finishTime: item.finish_time,
        deliveryTime: item.delivery_time,
        inspection: item.inspection,
        qualityCheck: item.quality_check,
        notes: item.notes,
        createdBy: item.created_by,
        createdByName: item.created_by_name
      }));
    } catch (err) {
      console.warn('Failed to fetch work orders from Supabase:', err);
      return null;
    }
  }
}

export const supabaseSyncService = new SupabaseSyncService();
