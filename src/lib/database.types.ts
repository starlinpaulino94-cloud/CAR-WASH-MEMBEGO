// GENERADO AUTOMÁTICAMENTE — no editar a mano.
// Regenerar contra el proyecto alojado:
//   npm run db:types

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type Enums = {
  bay_status: "disponible" | "ocupada" | "mantenimiento" | "limpieza";
  bay_type: "prelavado" | "lavado" | "aspirado" | "secado" | "detallado" | "qc";
  benefit_status: "validado" | "reservado" | "en_proceso" | "consumido" | "cancelado";
  cash_movement_type: "inflow" | "outflow";
  cash_session_status: "open" | "closed";
  expense_category: "quimicos_insumos" | "servicios_publicos" | "mantenimiento_equipos" | "nomina_extras" | "varios";
  fuel_level: "reserva" | "1/4" | "1/2" | "3/4" | "lleno";
  item_type: "service" | "package" | "product";
  membego_status: "active" | "inactive" | "none";
  ncf_type: "B01" | "B02" | "B04" | "B14" | "B15";
  order_status: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
  payment_method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
  payment_status: "pendiente" | "pagado" | "parcial" | "reembolsado";
  printer_width: "58mm" | "80mm" | "letter";
  user_role: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin";
  vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
};

export interface Database {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          id: number;
          company_id: string;
          branch_id: string | null;
          actor_id: string | null;
          actor_name: string;
          actor_role: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin" | null;
          action: string;
          entity: string;
          entity_id: string | null;
          details: string;
          metadata: Json;
          ip_address: string | null;
          user_agent: string | null;
          occurred_at: string;
        };
        Insert: {
          id?: number;
          company_id: string;
          branch_id?: string | null;
          actor_id?: string | null;
          actor_name?: string;
          actor_role?: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin" | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          details?: string;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          occurred_at?: string;
        };
        Update: {
          id?: number;
          company_id?: string;
          branch_id?: string | null;
          actor_id?: string | null;
          actor_name?: string;
          actor_role?: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin" | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          details?: string;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      bays: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          name: string;
          type: "prelavado" | "lavado" | "aspirado" | "secado" | "detallado" | "qc";
          status: "disponible" | "ocupada" | "mantenimiento" | "limpieza";
          current_work_order_id: string | null;
          assigned_profile_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id: string;
          name: string;
          type?: "prelavado" | "lavado" | "aspirado" | "secado" | "detallado" | "qc";
          status?: "disponible" | "ocupada" | "mantenimiento" | "limpieza";
          current_work_order_id?: string | null;
          assigned_profile_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string;
          name?: string;
          type?: "prelavado" | "lavado" | "aspirado" | "secado" | "detallado" | "qc";
          status?: "disponible" | "ocupada" | "mantenimiento" | "limpieza";
          current_work_order_id?: string | null;
          assigned_profile_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bays_assigned_profile_id_fkey";
            columns: ["assigned_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bays_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "bays_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bays_work_order_same_company";
            columns: ["company_id", "current_work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      branches: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          address: string | null;
          phone: string | null;
          is_main: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          address?: string | null;
          phone?: string | null;
          is_main?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          name?: string;
          address?: string | null;
          phone?: string | null;
          is_main?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branches_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_movements: {
        Row: {
          id: string;
          company_id: string;
          cash_session_id: string;
          type: "inflow" | "outflow";
          method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          amount_cents: number;
          reason: string;
          invoice_id: string | null;
          expense_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          cash_session_id: string;
          type: "inflow" | "outflow";
          method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          amount_cents: number;
          reason: string;
          invoice_id?: string | null;
          expense_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          cash_session_id?: string;
          type?: "inflow" | "outflow";
          method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          amount_cents?: number;
          reason?: string;
          invoice_id?: string | null;
          expense_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_movements_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_movements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_movements_expense_same_company";
            columns: ["company_id", "expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "cash_movements_invoice_same_company";
            columns: ["company_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "cash_movements_session_same_company";
            columns: ["company_id", "cash_session_id"];
            isOneToOne: false;
            referencedRelation: "cash_sessions";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      cash_sessions: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          cashier_id: string;
          opened_at: string;
          closed_at: string | null;
          initial_amount_cents: number;
          total_cash_sales_cents: number;
          total_card_sales_cents: number;
          total_transfer_sales_cents: number;
          total_membego_cents: number;
          total_inflows_cents: number;
          total_outflows_cents: number;
          expected_cash_cents: number;
          counted_cash_cents: number | null;
          difference_cents: number | null;
          status: "open" | "closed";
          opening_notes: string | null;
          closing_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id: string;
          cashier_id: string;
          opened_at?: string;
          closed_at?: string | null;
          initial_amount_cents: number;
          total_cash_sales_cents?: number;
          total_card_sales_cents?: number;
          total_transfer_sales_cents?: number;
          total_membego_cents?: number;
          total_inflows_cents?: number;
          total_outflows_cents?: number;
          expected_cash_cents?: number;
          counted_cash_cents?: number | null;
          difference_cents?: number | null;
          status?: "open" | "closed";
          opening_notes?: string | null;
          closing_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string;
          cashier_id?: string;
          opened_at?: string;
          closed_at?: string | null;
          initial_amount_cents?: number;
          total_cash_sales_cents?: number;
          total_card_sales_cents?: number;
          total_transfer_sales_cents?: number;
          total_membego_cents?: number;
          total_inflows_cents?: number;
          total_outflows_cents?: number;
          expected_cash_cents?: number;
          counted_cash_cents?: number | null;
          difference_cents?: number | null;
          status?: "open" | "closed";
          opening_notes?: string | null;
          closing_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_sessions_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: true;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "cash_sessions_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_sessions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      commissions: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          profile_id: string;
          work_order_id: string;
          work_order_item_id: string | null;
          service_name: string;
          base_cents: number;
          commission_bps: number;
          amount_cents: number;
          earned_on: string;
          is_paid: boolean;
          paid_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id: string;
          profile_id: string;
          work_order_id: string;
          work_order_item_id?: string | null;
          service_name: string;
          base_cents: number;
          commission_bps: number;
          amount_cents: number;
          earned_on?: string;
          is_paid?: boolean;
          paid_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string;
          profile_id?: string;
          work_order_id?: string;
          work_order_item_id?: string | null;
          service_name?: string;
          base_cents?: number;
          commission_bps?: number;
          amount_cents?: number;
          earned_on?: string;
          is_paid?: boolean;
          paid_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "commissions_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "commissions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commissions_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commissions_work_order_item_id_fkey";
            columns: ["work_order_item_id"];
            isOneToOne: false;
            referencedRelation: "work_order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commissions_work_order_same_company";
            columns: ["company_id", "work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      companies: {
        Row: {
          id: string;
          trade_name: string;
          legal_name: string;
          tax_id: string;
          logo_url: string | null;
          currency: string;
          currency_symbol: string;
          timezone: string;
          tax_rate_bps: number;
          allow_guest_checkout: boolean;
          thermal_printer_width: "58mm" | "80mm" | "letter";
          header_note: string | null;
          footer_note: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trade_name: string;
          legal_name: string;
          tax_id: string;
          logo_url?: string | null;
          currency?: string;
          currency_symbol?: string;
          timezone?: string;
          tax_rate_bps?: number;
          allow_guest_checkout?: boolean;
          thermal_printer_width?: "58mm" | "80mm" | "letter";
          header_note?: string | null;
          footer_note?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          trade_name?: string;
          legal_name?: string;
          tax_id?: string;
          logo_url?: string | null;
          currency?: string;
          currency_symbol?: string;
          timezone?: string;
          tax_rate_bps?: number;
          allow_guest_checkout?: boolean;
          thermal_printer_width?: "58mm" | "80mm" | "letter";
          header_note?: string | null;
          footer_note?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          name: string;
          phone: string | null;
          email: string | null;
          tax_id: string | null;
          address: string | null;
          notes: string | null;
          is_anonymous_guest: boolean;
          membego_customer_id: string | null;
          membego_status: "active" | "inactive" | "none";
          membego_tier: string | null;
          total_visits: number;
          total_spent_cents: number;
          last_visit_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id?: string | null;
          name: string;
          phone?: string | null;
          email?: string | null;
          tax_id?: string | null;
          address?: string | null;
          notes?: string | null;
          is_anonymous_guest?: boolean;
          membego_customer_id?: string | null;
          membego_status?: "active" | "inactive" | "none";
          membego_tier?: string | null;
          total_visits?: number;
          total_spent_cents?: number;
          last_visit_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string | null;
          name?: string;
          phone?: string | null;
          email?: string | null;
          tax_id?: string | null;
          address?: string | null;
          notes?: string | null;
          is_anonymous_guest?: boolean;
          membego_customer_id?: string | null;
          membego_status?: "active" | "inactive" | "none";
          membego_tier?: string | null;
          total_visits?: number;
          total_spent_cents?: number;
          last_visit_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      document_counters: {
        Row: {
          company_id: string;
          scope: string;
          period: string;
          next_value: number;
        };
        Insert: {
          company_id: string;
          scope: string;
          period?: string;
          next_value?: number;
        };
        Update: {
          company_id?: string;
          scope?: string;
          period?: string;
          next_value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_counters_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          category: "quimicos_insumos" | "servicios_publicos" | "mantenimiento_equipos" | "nomina_extras" | "varios";
          description: string;
          amount_cents: number;
          payment_method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          supplier_name: string | null;
          invoice_ref: string | null;
          cash_session_id: string | null;
          expense_date: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          client_request_id: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id: string;
          category?: "quimicos_insumos" | "servicios_publicos" | "mantenimiento_equipos" | "nomina_extras" | "varios";
          description: string;
          amount_cents: number;
          payment_method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          supplier_name?: string | null;
          invoice_ref?: string | null;
          cash_session_id?: string | null;
          expense_date?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          client_request_id?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string;
          category?: "quimicos_insumos" | "servicios_publicos" | "mantenimiento_equipos" | "nomina_extras" | "varios";
          description?: string;
          amount_cents?: number;
          payment_method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          supplier_name?: string | null;
          invoice_ref?: string | null;
          cash_session_id?: string | null;
          expense_date?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          client_request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "expenses_cash_session_same_company";
            columns: ["company_id", "cash_session_id"];
            isOneToOne: false;
            referencedRelation: "cash_sessions";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "expenses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_items: {
        Row: {
          id: string;
          invoice_id: string;
          item_type: "service" | "package" | "product";
          service_id: string | null;
          product_id: string | null;
          name: string;
          quantity: number;
          unit_price_cents: number;
          discount_cents: number;
          is_membego_covered: boolean;
          created_at: string;
          company_id: string;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          item_type: "service" | "package" | "product";
          service_id?: string | null;
          product_id?: string | null;
          name: string;
          quantity: number;
          unit_price_cents: number;
          discount_cents?: number;
          is_membego_covered?: boolean;
          created_at?: string;
          company_id: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          item_type?: "service" | "package" | "product";
          service_id?: string | null;
          product_id?: string | null;
          name?: string;
          quantity?: number;
          unit_price_cents?: number;
          discount_cents?: number;
          is_membego_covered?: boolean;
          created_at?: string;
          company_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_same_company";
            columns: ["invoice_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoice_items_product_same_company";
            columns: ["product_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoice_items_service_same_company";
            columns: ["service_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      invoices: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          invoice_number: string;
          ncf: string | null;
          ncf_type: "B01" | "B02" | "B04" | "B14" | "B15" | null;
          work_order_id: string | null;
          customer_id: string | null;
          customer_name: string;
          customer_tax_id: string | null;
          vehicle_plate: string | null;
          subtotal_cents: number;
          discount_cents: number;
          tax_cents: number;
          total_cents: number;
          change_cents: number;
          cash_session_id: string | null;
          cashier_id: string;
          is_annulled: boolean;
          annulled_reason: string | null;
          annulled_at: string | null;
          annulled_by: string | null;
          credit_note_id: string | null;
          created_at: string;
          updated_at: string;
          client_request_id: string | null;
          credits_invoice_id: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id: string;
          invoice_number: string;
          ncf?: string | null;
          ncf_type?: "B01" | "B02" | "B04" | "B14" | "B15" | null;
          work_order_id?: string | null;
          customer_id?: string | null;
          customer_name: string;
          customer_tax_id?: string | null;
          vehicle_plate?: string | null;
          subtotal_cents?: number;
          discount_cents?: number;
          tax_cents?: number;
          total_cents?: number;
          change_cents?: number;
          cash_session_id?: string | null;
          cashier_id: string;
          is_annulled?: boolean;
          annulled_reason?: string | null;
          annulled_at?: string | null;
          annulled_by?: string | null;
          credit_note_id?: string | null;
          created_at?: string;
          updated_at?: string;
          client_request_id?: string | null;
          credits_invoice_id?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string;
          invoice_number?: string;
          ncf?: string | null;
          ncf_type?: "B01" | "B02" | "B04" | "B14" | "B15" | null;
          work_order_id?: string | null;
          customer_id?: string | null;
          customer_name?: string;
          customer_tax_id?: string | null;
          vehicle_plate?: string | null;
          subtotal_cents?: number;
          discount_cents?: number;
          tax_cents?: number;
          total_cents?: number;
          change_cents?: number;
          cash_session_id?: string | null;
          cashier_id?: string;
          is_annulled?: boolean;
          annulled_reason?: string | null;
          annulled_at?: string | null;
          annulled_by?: string | null;
          credit_note_id?: string | null;
          created_at?: string;
          updated_at?: string;
          client_request_id?: string | null;
          credits_invoice_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_annulled_by_fkey";
            columns: ["annulled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoices_cash_session_same_company";
            columns: ["company_id", "cash_session_id"];
            isOneToOne: false;
            referencedRelation: "cash_sessions";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoices_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_credit_note_same_company";
            columns: ["company_id", "credit_note_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoices_credits_same_company";
            columns: ["company_id", "credits_invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoices_customer_same_company";
            columns: ["company_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "invoices_work_order_same_company";
            columns: ["company_id", "work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      membego_sync_logs: {
        Row: {
          id: number;
          company_id: string;
          branch_id: string | null;
          action: string;
          idempotency_key: string | null;
          status: string;
          request_payload: Json;
          response_payload: Json;
          error_message: string | null;
          actor_id: string | null;
          occurred_at: string;
        };
        Insert: {
          id?: number;
          company_id: string;
          branch_id?: string | null;
          action: string;
          idempotency_key?: string | null;
          status: string;
          request_payload?: Json;
          response_payload?: Json;
          error_message?: string | null;
          actor_id?: string | null;
          occurred_at?: string;
        };
        Update: {
          id?: number;
          company_id?: string;
          branch_id?: string | null;
          action?: string;
          idempotency_key?: string | null;
          status?: string;
          request_payload?: Json;
          response_payload?: Json;
          error_message?: string | null;
          actor_id?: string | null;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membego_sync_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membego_sync_logs_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membego_sync_logs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ncf_sequences: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          ncf_type: "B01" | "B02" | "B04" | "B14" | "B15";
          series: string;
          range_start: number;
          range_end: number;
          next_value: number;
          authorized_until: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id?: string | null;
          ncf_type: "B01" | "B02" | "B04" | "B14" | "B15";
          series?: string;
          range_start: number;
          range_end: number;
          next_value: number;
          authorized_until: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string | null;
          ncf_type?: "B01" | "B02" | "B04" | "B14" | "B15";
          series?: string;
          range_start?: number;
          range_end?: number;
          next_value?: number;
          authorized_until?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ncf_sequences_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ncf_sequences_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          code: string;
          barcode: string | null;
          name: string;
          category: string;
          cost_cents: number;
          price_cents: number;
          stock: number;
          min_stock: number;
          unit: string;
          is_for_sale: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id?: string | null;
          code: string;
          barcode?: string | null;
          name: string;
          category?: string;
          cost_cents?: number;
          price_cents?: number;
          stock?: number;
          min_stock?: number;
          unit?: string;
          is_for_sale?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string | null;
          code?: string;
          barcode?: string | null;
          name?: string;
          category?: string;
          cost_cents?: number;
          price_cents?: number;
          stock?: number;
          min_stock?: number;
          unit?: string;
          is_for_sale?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "products_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          company_id: string | null;
          branch_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          role: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin" | null;
          avatar_url: string | null;
          cash_pin_hash: string | null;
          commission_bps: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          company_id?: string | null;
          branch_id?: string | null;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          role?: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin" | null;
          avatar_url?: string | null;
          cash_pin_hash?: string | null;
          commission_bps?: number | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          branch_id?: string | null;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          role?: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin" | null;
          avatar_url?: string | null;
          cash_pin_hash?: string | null;
          commission_bps?: number | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      service_prices: {
        Row: {
          service_id: string;
          vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          price_cents: number;
        };
        Insert: {
          service_id: string;
          vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          price_cents: number;
        };
        Update: {
          service_id?: string;
          vehicle_category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_prices_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          name: string;
          description: string;
          category: string;
          estimated_minutes: number;
          commission_bps: number;
          requires_inspection: boolean;
          included_in_membego: boolean;
          is_popular: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          code: string;
          name: string;
          description?: string;
          category?: string;
          estimated_minutes?: number;
          commission_bps?: number;
          requires_inspection?: boolean;
          included_in_membego?: boolean;
          is_popular?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          code?: string;
          name?: string;
          description?: string;
          category?: string;
          estimated_minutes?: number;
          commission_bps?: number;
          requires_inspection?: boolean;
          included_in_membego?: boolean;
          is_popular?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          id: string;
          company_id: string;
          customer_id: string | null;
          plate: string;
          make: string;
          model: string;
          year: number | null;
          color: string;
          category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          notes: string | null;
          last_visit_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          customer_id?: string | null;
          plate: string;
          make?: string;
          model?: string;
          year?: number | null;
          color?: string;
          category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          notes?: string | null;
          last_visit_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          customer_id?: string | null;
          plate?: string;
          make?: string;
          model?: string;
          year?: number | null;
          color?: string;
          category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          notes?: string | null;
          last_visit_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_customer_same_company";
            columns: ["company_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      work_order_assignees: {
        Row: {
          work_order_id: string;
          profile_id: string;
          company_id: string;
          assigned_at: string;
        };
        Insert: {
          work_order_id: string;
          profile_id: string;
          company_id: string;
          assigned_at?: string;
        };
        Update: {
          work_order_id?: string;
          profile_id?: string;
          company_id?: string;
          assigned_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_assignees_order_same_company";
            columns: ["work_order_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_order_assignees_profile_same_company";
            columns: ["profile_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      work_order_items: {
        Row: {
          id: string;
          work_order_id: string;
          item_type: "service" | "package" | "product";
          service_id: string | null;
          product_id: string | null;
          name: string;
          quantity: number;
          unit_price_cents: number;
          discount_cents: number;
          is_membego_covered: boolean;
          assigned_profile_id: string | null;
          created_at: string;
          company_id: string;
        };
        Insert: {
          id?: string;
          work_order_id: string;
          item_type: "service" | "package" | "product";
          service_id?: string | null;
          product_id?: string | null;
          name: string;
          quantity?: number;
          unit_price_cents: number;
          discount_cents?: number;
          is_membego_covered?: boolean;
          assigned_profile_id?: string | null;
          created_at?: string;
          company_id: string;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          item_type?: "service" | "package" | "product";
          service_id?: string | null;
          product_id?: string | null;
          name?: string;
          quantity?: number;
          unit_price_cents?: number;
          discount_cents?: number;
          is_membego_covered?: boolean;
          assigned_profile_id?: string | null;
          created_at?: string;
          company_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_items_assigned_profile_id_fkey";
            columns: ["assigned_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_items_order_same_company";
            columns: ["work_order_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_order_items_product_same_company";
            columns: ["product_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_order_items_service_same_company";
            columns: ["service_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      work_orders: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          order_number: string;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          vehicle_id: string | null;
          vehicle_plate: string;
          vehicle_make_model: string;
          vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          vehicle_color: string;
          status: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
          priority: string;
          bay_id: string | null;
          subtotal_cents: number;
          discount_cents: number;
          membego_benefit_cents: number;
          tax_cents: number;
          total_cents: number;
          payment_status: "pendiente" | "pagado" | "parcial" | "reembolsado";
          payment_method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto" | null;
          membego_customer_id: string | null;
          membego_membership_id: string | null;
          membego_benefit_id: string | null;
          membego_redemption_id: string | null;
          benefit_status: "validado" | "reservado" | "en_proceso" | "consumido" | "cancelado" | null;
          arrival_at: string;
          started_at: string | null;
          finished_at: string | null;
          delivered_at: string | null;
          estimated_ready_at: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          client_request_id: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id: string;
          order_number: string;
          customer_id?: string | null;
          customer_name: string;
          customer_phone?: string | null;
          vehicle_id?: string | null;
          vehicle_plate: string;
          vehicle_make_model?: string;
          vehicle_category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          vehicle_color?: string;
          status?: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
          priority?: string;
          bay_id?: string | null;
          subtotal_cents?: number;
          discount_cents?: number;
          membego_benefit_cents?: number;
          tax_cents?: number;
          total_cents?: number;
          payment_status?: "pendiente" | "pagado" | "parcial" | "reembolsado";
          payment_method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto" | null;
          membego_customer_id?: string | null;
          membego_membership_id?: string | null;
          membego_benefit_id?: string | null;
          membego_redemption_id?: string | null;
          benefit_status?: "validado" | "reservado" | "en_proceso" | "consumido" | "cancelado" | null;
          arrival_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          delivered_at?: string | null;
          estimated_ready_at?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          client_request_id?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string;
          branch_id?: string;
          order_number?: string;
          customer_id?: string | null;
          customer_name?: string;
          customer_phone?: string | null;
          vehicle_id?: string | null;
          vehicle_plate?: string;
          vehicle_make_model?: string;
          vehicle_category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          vehicle_color?: string;
          status?: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
          priority?: string;
          bay_id?: string | null;
          subtotal_cents?: number;
          discount_cents?: number;
          membego_benefit_cents?: number;
          tax_cents?: number;
          total_cents?: number;
          payment_status?: "pendiente" | "pagado" | "parcial" | "reembolsado";
          payment_method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto" | null;
          membego_customer_id?: string | null;
          membego_membership_id?: string | null;
          membego_benefit_id?: string | null;
          membego_redemption_id?: string | null;
          benefit_status?: "validado" | "reservado" | "en_proceso" | "consumido" | "cancelado" | null;
          arrival_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          delivered_at?: string | null;
          estimated_ready_at?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          client_request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_bay_same_company";
            columns: ["company_id", "bay_id"];
            isOneToOne: false;
            referencedRelation: "bays";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_orders_branch_same_company";
            columns: ["company_id", "branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_orders_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_customer_same_company";
            columns: ["company_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_orders_vehicle_same_company";
            columns: ["company_id", "vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      advance_work_order: {
        Args: {
          p_order_id: string;
          p_new_status: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
          p_bay_id?: string;
          p_assignees?: string[];
        };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      annul_invoice: {
        Args: {
          p_invoice_id: string;
          p_reason: string;
          p_client_request_id: string;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      create_expense: {
        Args: {
          p_branch_id: string;
          p_client_request_id: string;
          p_description: string;
          p_amount_cents: number;
          p_category?: "quimicos_insumos" | "servicios_publicos" | "mantenimiento_equipos" | "nomina_extras" | "varios";
          p_payment_method?: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
          p_supplier_name?: string;
          p_invoice_ref?: string;
          p_expense_date?: string;
          p_cash_session_id?: string;
        };
        Returns: Database['public']['Tables']['expenses']['Row'];
      };
      create_invoice: {
        Args: {
          p_branch_id: string;
          p_client_request_id: string;
          p_items: Json;
          p_payments: Json;
          p_vehicle_category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          p_work_order_id?: string;
          p_customer_id?: string;
          p_customer_name?: string;
          p_customer_tax_id?: string;
          p_vehicle_plate?: string;
          p_ncf_type?: "B01" | "B02" | "B04" | "B14" | "B15";
          p_cash_session_id?: string;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      create_work_order: {
        Args: {
          p_branch_id: string;
          p_client_request_id: string;
          p_vehicle_plate: string;
          p_vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          p_items: Json;
          p_customer_name?: string;
          p_customer_id?: string;
          p_customer_phone?: string;
          p_vehicle_make?: string;
          p_vehicle_model?: string;
          p_vehicle_color?: string;
          p_priority?: string;
          p_notes?: string;
        };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      dashboard_metrics: {
        Args: {
          p_branch_id: string;
          p_from: string;
          p_to: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      bay_status: "disponible" | "ocupada" | "mantenimiento" | "limpieza";
      bay_type: "prelavado" | "lavado" | "aspirado" | "secado" | "detallado" | "qc";
      benefit_status: "validado" | "reservado" | "en_proceso" | "consumido" | "cancelado";
      cash_movement_type: "inflow" | "outflow";
      cash_session_status: "open" | "closed";
      expense_category: "quimicos_insumos" | "servicios_publicos" | "mantenimiento_equipos" | "nomina_extras" | "varios";
      fuel_level: "reserva" | "1/4" | "1/2" | "3/4" | "lleno";
      item_type: "service" | "package" | "product";
      membego_status: "active" | "inactive" | "none";
      ncf_type: "B01" | "B02" | "B04" | "B14" | "B15";
      order_status: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
      payment_method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
      payment_status: "pendiente" | "pagado" | "parcial" | "reembolsado";
      printer_width: "58mm" | "80mm" | "letter";
      user_role: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin";
      vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

