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
  claim_kind: "dano_vehiculo" | "objeto_perdido" | "servicio_deficiente" | "cobro" | "demora" | "otro";
  claim_status: "abierto" | "en_revision" | "resuelto" | "rechazado";
  appointment_status: "pendiente" | "confirmada" | "en_curso" | "convertida" | "cancelada" | "ausente";
  equipment_status: "operativo" | "mantenimiento" | "fuera_servicio" | "retirado";
  maintenance_kind: "preventivo" | "correctivo";
  maintenance_status: "abierta" | "completada" | "cancelada";
  qc_result: "aprobado" | "rechazado";
  inspection_stage: "recepcion" | "entrega";
  damage_kind: "rayon" | "abolladura" | "rotura" | "faltante" | "mancha" | "oxido" | "otro";
  damage_severity: "leve" | "moderado" | "grave";
  inventory_movement_kind: "entrada" | "compra" | "venta" | "devolucion" | "consumo" | "ajuste" | "merma" | "transferencia";
  item_type: "service" | "package" | "product";
  membego_status: "active" | "inactive" | "none";
  customer_origin: "carwash" | "membego";
  ncf_type: "B01" | "B02" | "B04" | "B14" | "B15";
  order_status: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
  payment_method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
  payment_status: "pendiente" | "pagado" | "parcial" | "reembolsado";
  payroll_type: "mensual" | "por_hora" | "solo_comision";
  payroll_status: "borrador" | "aprobada" | "pagada";
  branch_scope: "sucursal" | "todas";
  promotion_kind: "porcentaje" | "importe";
  promotion_scope: "total" | "servicio" | "categoria";
  notification_kind: "orden_lista" | "recordatorio_cita" | "stock_bajo" | "cuenta_vencida" | "mantenimiento_pendiente" | "caja_sin_cerrar" | "otro";
  notification_audience: "cliente" | "interno";
  notification_channel: "whatsapp" | "sms" | "email" | "app";
  notification_status: "pendiente" | "enviado" | "descartado" | "fallido";
  printer_width: "58mm" | "80mm" | "letter";
  user_role: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin";
  vehicle_category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
};

export interface Database {
  public: {
    Tables: {
      memberships: {
        Row: {
          id: string;
          company_id: string;
          customer_id: string;
          membego_membership_id: string;
          plan_name: string;
          tier: string | null;
          status: "active" | "paused" | "cancelled" | "expired";
          is_paid: boolean;
          valid_from: string | null;
          valid_until: string | null;
          raw: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          customer_id: string;
          membego_membership_id: string;
          plan_name?: string;
          tier?: string | null;
          status?: "active" | "paused" | "cancelled" | "expired";
          is_paid?: boolean;
          valid_from?: string | null;
          valid_until?: string | null;
          raw?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "active" | "paused" | "cancelled" | "expired";
          plan_name?: string;
          tier?: string | null;
          is_paid?: boolean;
          valid_from?: string | null;
          valid_until?: string | null;
          raw?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_promotions: {
        Row: {
          id: string;
          company_id: string;
          customer_id: string;
          membego_promotion_id: string;
          code: string | null;
          title: string;
          kind: "free" | "paid";
          status: "available" | "redeemed" | "expired" | "cancelled";
          value_cents: number;
          acquired_at: string;
          redeemed_at: string | null;
          expires_at: string | null;
          raw: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          customer_id: string;
          membego_promotion_id: string;
          code?: string | null;
          title?: string;
          kind?: "free" | "paid";
          status?: "available" | "redeemed" | "expired" | "cancelled";
          value_cents?: number;
          acquired_at?: string;
          redeemed_at?: string | null;
          expires_at?: string | null;
          raw?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          title?: string;
          kind?: "free" | "paid";
          status?: "available" | "redeemed" | "expired" | "cancelled";
          value_cents?: number;
          redeemed_at?: string | null;
          expires_at?: string | null;
          raw?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      membego_empresa_perfil: {
        Row: {
          company_id: string;
          membego_company_id: string;
          nombre: string | null;
          slug: string | null;
          logo_url: string | null;
          moneda: string | null;
          zona_horaria: string | null;
          idioma: string | null;
          raw: Json;
          synced_at: string;
        };
        Insert: {
          company_id: string;
          membego_company_id: string;
          nombre?: string | null;
          slug?: string | null;
          logo_url?: string | null;
          moneda?: string | null;
          zona_horaria?: string | null;
          idioma?: string | null;
          raw?: Json;
          synced_at?: string;
        };
        Update: {
          nombre?: string | null;
          slug?: string | null;
          logo_url?: string | null;
          moneda?: string | null;
          zona_horaria?: string | null;
          idioma?: string | null;
          raw?: Json;
          synced_at?: string;
        };
        Relationships: [];
      };
      membego_sucursales: {
        Row: {
          company_id: string;
          membego_branch_id: string;
          nombre: string;
          direccion: string | null;
          activa: boolean;
          raw: Json;
          synced_at: string;
        };
        Insert: {
          company_id: string;
          membego_branch_id: string;
          nombre?: string;
          direccion?: string | null;
          activa?: boolean;
          raw?: Json;
          synced_at?: string;
        };
        Update: {
          nombre?: string;
          direccion?: string | null;
          activa?: boolean;
          raw?: Json;
          synced_at?: string;
        };
        Relationships: [];
      };
      vehicle_categories: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          label: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          code: string;
          label: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          label?: string;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      membego_promociones: {
        Row: {
          company_id: string;
          membego_promotion_id: string;
          titulo: string;
          descripcion: string;
          imagen_url: string | null;
          activo: boolean;
          vigencia_desde: string | null;
          vigencia_hasta: string | null;
          raw: Json;
          synced_at: string;
        };
        Insert: {
          company_id: string;
          membego_promotion_id: string;
          titulo?: string;
          descripcion?: string;
          imagen_url?: string | null;
          activo?: boolean;
          vigencia_desde?: string | null;
          vigencia_hasta?: string | null;
          raw?: Json;
          synced_at?: string;
        };
        Update: {
          titulo?: string;
          descripcion?: string;
          imagen_url?: string | null;
          activo?: boolean;
          vigencia_desde?: string | null;
          vigencia_hasta?: string | null;
          raw?: Json;
          synced_at?: string;
        };
        Relationships: [];
      };
      membego_citas: {
        Row: {
          company_id: string;
          membego_appointment_id: string;
          membego_customer_id: string | null;
          membego_branch_id: string | null;
          membego_vehicle_id: string | null;
          inicio: string | null;
          duracion_min: number;
          servicio: string | null;
          estado: string;
          raw: Json;
          synced_at: string;
        };
        Insert: {
          company_id: string;
          membego_appointment_id: string;
          membego_customer_id?: string | null;
          membego_branch_id?: string | null;
          membego_vehicle_id?: string | null;
          inicio?: string | null;
          duracion_min?: number;
          servicio?: string | null;
          estado?: string;
          raw?: Json;
          synced_at?: string;
        };
        Update: {
          inicio?: string | null;
          duracion_min?: number;
          servicio?: string | null;
          estado?: string;
          raw?: Json;
          synced_at?: string;
        };
        Relationships: [];
      };
      membego_membresias: {
        Row: {
          company_id: string;
          membego_membership_id: string;
          membego_customer_id: string | null;
          plan_nombre: string;
          estado: string;
          vigente_hasta: string | null;
          raw: Json;
          synced_at: string;
        };
        Insert: {
          company_id: string;
          membego_membership_id: string;
          membego_customer_id?: string | null;
          plan_nombre?: string;
          estado?: string;
          vigente_hasta?: string | null;
          raw?: Json;
          synced_at?: string;
        };
        Update: {
          plan_nombre?: string;
          estado?: string;
          vigente_hasta?: string | null;
          raw?: Json;
          synced_at?: string;
        };
        Relationships: [];
      };
      membego_company_links: {
        Row: {
          company_id: string;
          membego_company_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          membego_company_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          membego_company_id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
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
          // Partida de nómina que la pagó (0030). NULL = todavía sin pagar.
          payroll_item_id: string | null;
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
          prices_include_tax: boolean;
          // Techo del descuento manual (0032). 10000 = 100 %, sin límite.
          max_manual_discount_bps: number;
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
          prices_include_tax?: boolean;
          max_manual_discount_bps?: number;
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
          prices_include_tax?: boolean;
          max_manual_discount_bps?: number;
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
      vehicle_category_levels: {
        Row: {
          company_id: string;
          category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          // Sin fila = sin nivel configurado. NO es 1: con 1 por defecto, todas
          // las categorías cabrían en el plan más barato de Membego.
          level: number;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          category: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          level: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          category?: "sedan" | "suv" | "jeep" | "pickup" | "van" | "truck" | "motorcycle" | "special";
          level?: number;
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
          // Procedencia (0037). NO está en Insert ni en Update: la decide un
          // disparador con los datos de la fila y después no se puede cambiar.
          origin: "carwash" | "membego";
          total_visits: number;
          total_spent_cents: number;
          last_visit_at: string | null;
          // Crédito (0028). El cupo NO se edita por UPDATE: solo con
          // set_customer_credit(); un trigger rechaza cualquier otra vía.
          credit_enabled: boolean;
          credit_limit_cents: number;
          credit_terms_days: number;
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
          // Unidades ya acreditadas por notas parciales (0034).
          credited_quantity: number;
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
          // Acumulado de notas de crédito parciales (0034).
          credited_cents: number;
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
      inventory_movements: {
        Row: {
          id: number;
          company_id: string;
          branch_id: string | null;
          product_id: string;
          kind: Database['public']['Enums']['inventory_movement_kind'];
          qty_change: number;
          qty_before: number;
          qty_after: number;
          reason: string | null;
          invoice_id: string | null;
          work_order_id: string | null;
          purchase_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_same_company";
            columns: ["product_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      vehicle_inspections: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          work_order_id: string;
          stage: Database['public']['Enums']['inspection_stage'];
          fuel_level: Database['public']['Enums']['fuel_level'] | null;
          mileage: number | null;
          valuables: string | null;
          notes: string | null;
          terms_accepted: boolean;
          signature: string | null;
          signed_by: string | null;
          signed_at: string | null;
          photo_urls: string[];
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id?: string | null;
          work_order_id: string;
          stage?: Database['public']['Enums']['inspection_stage'];
          fuel_level?: Database['public']['Enums']['fuel_level'] | null;
          mileage?: number | null;
          valuables?: string | null;
          notes?: string | null;
        };
        Update: {
          fuel_level?: Database['public']['Enums']['fuel_level'] | null;
          mileage?: number | null;
          valuables?: string | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inspections_order_same_company";
            columns: ["work_order_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      inspection_damages: {
        Row: {
          id: string;
          company_id: string;
          inspection_id: string;
          zone: string;
          kind: Database['public']['Enums']['damage_kind'];
          severity: Database['public']['Enums']['damage_severity'];
          note: string | null;
          pos_x: number | null;
          pos_y: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          inspection_id: string;
          zone: string;
          kind?: Database['public']['Enums']['damage_kind'];
          severity?: Database['public']['Enums']['damage_severity'];
          note?: string | null;
          pos_x?: number | null;
          pos_y?: number | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "damages_inspection_same_company";
            columns: ["inspection_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_inspections";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      claims: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          work_order_id: string | null;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          kind: Database['public']['Enums']['claim_kind'];
          status: Database['public']['Enums']['claim_status'];
          description: string;
          assignee_id: string | null;
          responsible_id: string | null;
          resolution: string | null;
          cost_cents: number;
          root_cause: string | null;
          resolved_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: { assignee_id?: string | null };
        Relationships: [];
      };
      claim_events: {
        Row: {
          id: number;
          company_id: string;
          claim_id: string;
          note: string;
          status_from: Database['public']['Enums']['claim_status'] | null;
          status_to: Database['public']['Enums']['claim_status'] | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          kind: Database['public']['Enums']['notification_kind'];
          audience: Database['public']['Enums']['notification_audience'];
          channel: Database['public']['Enums']['notification_channel'];
          status: Database['public']['Enums']['notification_status'];
          title: string;
          body: string;
          customer_id: string | null;
          work_order_id: string | null;
          appointment_id: string | null;
          recipient_phone: string | null;
          recipient_email: string | null;
          dedupe_key: string;
          scheduled_for: string;
          sent_at: string | null;
          sent_by: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      promotions: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          name: string;
          kind: Database['public']['Enums']['promotion_kind'];
          scope: Database['public']['Enums']['promotion_scope'];
          value_bps: number | null;
          value_cents: number | null;
          service_id: string | null;
          vehicle_category: Database['public']['Enums']['vehicle_category'] | null;
          starts_on: string;
          ends_on: string | null;
          weekdays: number[] | null;
          min_purchase_cents: number;
          max_uses: number | null;
          max_uses_per_customer: number | null;
          uses_count: number;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      promotion_redemptions: {
        Row: {
          id: string;
          company_id: string;
          promotion_id: string;
          invoice_id: string;
          customer_id: string | null;
          discount_cents: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "redemptions_promotion_same_company";
            columns: ["promotion_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "promotions";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      work_shifts: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          profile_id: string;
          starts_at: string;
          ends_at: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          profile_id: string;
          shift_id: string | null;
          checked_in_at: string;
          checked_out_at: string | null;
          worked_minutes: number | null;
          late_minutes: number;
          notes: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payroll_advances: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          profile_id: string;
          amount_cents: number;
          reason: string | null;
          cash_session_id: string | null;
          payroll_item_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payroll_periods: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          period_from: string;
          period_to: string;
          status: Database['public']['Enums']['payroll_status'];
          gross_cents: number;
          deductions_cents: number;
          net_cents: number;
          notes: string | null;
          approved_by: string | null;
          approved_at: string | null;
          paid_by: string | null;
          paid_at: string | null;
          payment_method: Database['public']['Enums']['payment_method'] | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payroll_items: {
        Row: {
          id: string;
          company_id: string;
          period_id: string;
          profile_id: string;
          payroll_type: Database['public']['Enums']['payroll_type'];
          base_cents: number;
          worked_minutes: number;
          commissions_cents: number;
          bonus_cents: number;
          advances_cents: number;
          deductions_cents: number;
          net_cents: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "payroll_items_period_same_company";
            columns: ["period_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "payroll_periods";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      fleets: {
        Row: {
          id: string;
          company_id: string;
          customer_id: string;
          name: string;
          code: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          contact_email: string | null;
          po_reference: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "fleets_customer_same_company";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      fleet_rates: {
        Row: {
          id: string;
          company_id: string;
          fleet_id: string;
          service_id: string;
          vehicle_category: Database['public']['Enums']['vehicle_category'] | null;
          price_cents: number;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      receivables: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          customer_id: string;
          invoice_id: string;
          work_order_id: string | null;
          issued_on: string;
          due_on: string;
          total_cents: number;
          paid_cents: number;
          status: "pendiente" | "pagada" | "anulada";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "receivables_customer_same_company";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "receivables_invoice_same_company";
            columns: ["invoice_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "invoices";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      receivable_payments: {
        Row: {
          id: string;
          company_id: string;
          receivable_id: string;
          amount_cents: number;
          payment_method: Database['public']['Enums']['payment_method'];
          reference: string | null;
          notes: string | null;
          cash_session_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          vehicle_id: string | null;
          vehicle_plate: string;
          vehicle_category: Database['public']['Enums']['vehicle_category'];
          service_id: string | null;
          service_name: string;
          scheduled_at: string;
          duration_minutes: number;
          status: Database['public']['Enums']['appointment_status'];
          notes: string | null;
          cancel_reason: string | null;
          work_order_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: {
          status?: Database['public']['Enums']['appointment_status'];
          cancel_reason?: string | null;
          scheduled_at?: string;
          duration_minutes?: number;
          notes?: string | null;
        };
        Relationships: [];
      };
      equipment: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          bay_id: string | null;
          code: string;
          name: string;
          category: string;
          brand: string | null;
          model: string | null;
          serial_number: string | null;
          purchase_date: string | null;
          purchase_cents: number;
          warranty_until: string | null;
          status: Database['public']['Enums']['equipment_status'];
          service_every_days: number | null;
          next_service_at: string | null;
          last_service_at: string | null;
          maintenance_cents: number;
          downtime_minutes: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          branch_id?: string | null;
          bay_id?: string | null;
          code: string;
          name: string;
          category?: string;
          brand?: string | null;
          model?: string | null;
          serial_number?: string | null;
          purchase_date?: string | null;
          purchase_cents?: number;
          warranty_until?: string | null;
          service_every_days?: number | null;
          next_service_at?: string | null;
          notes?: string | null;
        };
        Update: {
          name?: string;
          category?: string;
          brand?: string | null;
          model?: string | null;
          serial_number?: string | null;
          warranty_until?: string | null;
          status?: Database['public']['Enums']['equipment_status'];
          service_every_days?: number | null;
          next_service_at?: string | null;
          notes?: string | null;
          bay_id?: string | null;
        };
        Relationships: [];
      };
      maintenance_orders: {
        Row: {
          id: string;
          company_id: string;
          equipment_id: string;
          kind: Database['public']['Enums']['maintenance_kind'];
          status: Database['public']['Enums']['maintenance_status'];
          description: string;
          started_at: string;
          finished_at: string | null;
          cost_cents: number;
          parts: string | null;
          supplier_id: string | null;
          resolution: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "maintenance_equipment_same_company";
            columns: ["equipment_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "equipment";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      qc_checklist_items: {
        Row: {
          id: string;
          company_id: string;
          service_id: string | null;
          label: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          service_id?: string | null;
          label: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          label?: string;
          sort_order?: number;
          is_active?: boolean;
          service_id?: string | null;
        };
        Relationships: [];
      };
      qc_reviews: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          work_order_id: string;
          attempt: number;
          result: Database['public']['Enums']['qc_result'];
          reject_reason: string | null;
          washer_id: string | null;
          reviewer_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      qc_review_results: {
        Row: {
          id: string;
          company_id: string;
          review_id: string;
          item_id: string | null;
          label: string;
          passed: boolean;
          note: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      service_recipes: {
        Row: {
          id: string;
          company_id: string;
          service_id: string;
          product_id: string;
          vehicle_category: Database['public']['Enums']['vehicle_category'] | null;
          quantity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          service_id: string;
          product_id: string;
          vehicle_category?: Database['public']['Enums']['vehicle_category'] | null;
          quantity: number;
        };
        Update: {
          vehicle_category?: Database['public']['Enums']['vehicle_category'] | null;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_recipes_product_same_company";
            columns: ["product_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      service_consumptions: {
        Row: {
          id: number;
          company_id: string;
          work_order_id: string;
          service_id: string | null;
          product_id: string;
          quantity: number;
          cost_cents: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "service_consumptions_product_same_company";
            columns: ["product_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      suppliers: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          tax_id: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          tax_id?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          notes?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          tax_id?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          notes?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      purchases: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          supplier_id: string;
          invoice_ref: string | null;
          purchase_date: string;
          is_credit: boolean;
          due_date: string | null;
          payment_method: Database['public']['Enums']['payment_method'];
          subtotal_cents: number;
          tax_cents: number;
          total_cents: number;
          paid_cents: number;
          status: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "purchases_supplier_same_company";
            columns: ["supplier_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      purchase_items: {
        Row: {
          id: string;
          purchase_id: string;
          company_id: string;
          product_id: string;
          quantity: number;
          unit_cost_cents: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "purchase_items_purchase_same_company";
            columns: ["purchase_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "purchase_items_product_same_company";
            columns: ["product_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      supplier_payments: {
        Row: {
          id: string;
          company_id: string;
          purchase_id: string;
          amount_cents: number;
          payment_method: Database['public']['Enums']['payment_method'];
          reference: string | null;
          notes: string | null;
          cash_session_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "supplier_payments_purchase_same_company";
            columns: ["purchase_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id", "company_id"];
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
          stock_frac: number;
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
          // Datos de pago (0030). Protegidos por un guardia: solo los cambia
          // set_employee_pay(), por eso no aparecen en Update.
          payroll_type: Database['public']['Enums']['payroll_type'];
          base_salary_cents: number;
          hourly_rate_cents: number;
          // Alcance de sucursal (0031). Junto con branch_id decide qué ve. Lo
          // cambia solo set_employee_branch(), nunca sobre uno mismo.
          branch_scope: Database['public']['Enums']['branch_scope'];
          promotion_kind: "porcentaje" | "importe";
          promotion_scope: "total" | "servicio" | "categoria";
          notification_kind: "orden_lista" | "recordatorio_cita" | "stock_bajo" | "cuenta_vencida" | "mantenimiento_pendiente" | "caja_sin_cerrar" | "otro";
          notification_audience: "cliente" | "interno";
          notification_channel: "whatsapp" | "sms" | "email" | "app";
          notification_status: "pendiente" | "enviado" | "descartado" | "fallido";
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
          is_active?: boolean;
          // branch_id y branch_scope NO están aquí a propósito: desde 0031 solo
          // los cambia set_employee_branch(); un UPDATE directo lo rechaza.
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
          // Flotilla (0029). Se mueve solo con assign_vehicle_to_fleet().
          fleet_id: string | null;
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
          // Flotilla (0029). Se sella al crear la orden; la factura consolidada
          // marca cuál la cobró, para que nadie la cobre dos veces.
          fleet_id: string | null;
          consolidated_invoice_id: string | null;
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
      create_vehicle_category: {
        Args: {
          p_label: string;
          p_code?: string;
          p_sort_order?: number;
        };
        Returns: Database['public']['Tables']['vehicle_categories']['Row'];
      };
      update_vehicle_category: {
        Args: {
          p_id: string;
          p_label?: string;
          p_sort_order?: number;
          p_is_active?: boolean;
        };
        Returns: Database['public']['Tables']['vehicle_categories']['Row'];
      };
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
          // Código promocional (0032). El importe lo recalcula el servidor.
          p_promotion_code?: string | null;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      set_vehicle_category_levels: {
        Args: { p_niveles: Json };
        Returns: Database['public']['Tables']['vehicle_category_levels']['Row'][];
      };
      record_membego_redemption: {
        Args: {
          p_invoice_id: string;
          p_visit_id: string | null;
          p_membership_id: string | null;
          p_covered_cents?: number;
          p_error?: string | null;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      record_membego_reversal: {
        Args: { p_invoice_id: string };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      /** Migración 0041. Cancela con motivo obligatorio; rechaza las facturadas. */
      cancel_work_order: {
        Args: { p_order_id: string; p_reason: string };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      edit_work_order: {
        Args: {
          p_order_id: string;
          p_items: Json;
          p_customer_name?: string | null;
          p_customer_phone?: string | null;
          p_vehicle_make?: string | null;
          p_vehicle_model?: string | null;
          p_vehicle_color?: string | null;
          p_vehicle_category?: Database['public']['Enums']['vehicle_category'] | null;
          p_priority?: string | null;
          p_notes?: string | null;
        };
        Returns: Database['public']['Tables']['work_orders']['Row'];
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
      fiscal_status: {
        Args: Record<string, never>;
        Returns: Json;
      };
      create_employee: {
        Args: {
          p_email: string;
          p_password: string;
          p_full_name: string;
          p_role: "propietario" | "administrador" | "supervisor" | "cajero" | "recepcionista" | "operario" | "contador" | "superadmin";
          p_branch_id?: string;
          p_phone?: string;
          p_commission_bps?: number;
        };
        Returns: Database['public']['Tables']['profiles']['Row'];
      };
      adjust_stock: {
        Args: { p_product_id: string; p_new_qty: number; p_reason: string };
        Returns: Database['public']['Tables']['products']['Row'];
      };
      register_purchase: {
        Args: {
          p_supplier_id: string;
          p_items: Json;
          p_is_credit?: boolean;
          p_due_date?: string | null;
          p_payment_method?: Database['public']['Enums']['payment_method'];
          p_invoice_ref?: string | null;
          p_tax_cents?: number;
          p_notes?: string | null;
          p_cash_session_id?: string | null;
        };
        Returns: Database['public']['Tables']['purchases']['Row'];
      };
      open_claim: {
        Args: {
          p_customer_name: string;
          p_kind: Database['public']['Enums']['claim_kind'];
          p_description: string;
          p_work_order_id?: string | null;
          p_customer_id?: string | null;
          p_customer_phone?: string | null;
        };
        Returns: Database['public']['Tables']['claims']['Row'];
      };
      add_claim_note: {
        Args: {
          p_claim_id: string;
          p_note: string;
          p_status?: Database['public']['Enums']['claim_status'] | null;
        };
        Returns: Database['public']['Tables']['claims']['Row'];
      };
      resolve_claim: {
        Args: {
          p_claim_id: string;
          p_status: Database['public']['Enums']['claim_status'];
          p_resolution: string;
          p_cost_cents?: number;
          p_root_cause?: string | null;
          p_responsible_id?: string | null;
        };
        Returns: Database['public']['Tables']['claims']['Row'];
      };
      set_customer_credit: {
        Args: {
          p_customer_id: string;
          p_enabled: boolean;
          p_limit_cents?: number;
          p_terms_days?: number;
        };
        Returns: Database['public']['Tables']['customers']['Row'];
      };
      customer_credit_status: {
        Args: { p_customer_id: string };
        Returns: Json;
      };
      collect_receivable: {
        Args: {
          p_receivable_id: string;
          p_amount_cents: number;
          p_payment_method?: Database['public']['Enums']['payment_method'];
          p_reference?: string | null;
          p_cash_session_id?: string | null;
        };
        Returns: Database['public']['Tables']['receivables']['Row'];
      };
      receivables_aging: {
        Args: { p_as_of?: string };
        Returns: Json;
      };
      credit_note_invoice: {
        Args: {
          p_invoice_id: string;
          p_lines: Json;
          p_reason: string;
          p_client_request_id: string;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      reset_employee_password: {
        Args: { p_profile_id: string; p_password: string };
        Returns: void;
      };
      // 0035: importación masiva. p_apply=false hace el trabajo y lo revierte,
      // devolviendo el informe de lo que habría pasado.
      import_batch: {
        Args: { p_entity: string; p_rows: Json; p_apply: boolean };
        Returns: Json;
      };
      customer_origin_summary: {
        Args: { p_from?: string | null; p_to?: string | null };
        Returns: Json;
      };
      refresh_alerts: {
        Args: Record<string, never>;
        Returns: Json;
      };
      mark_notification: {
        Args: {
          p_notification_id: string;
          p_status: Database['public']['Enums']['notification_status'];
          p_error?: string | null;
        };
        Returns: Database['public']['Tables']['notifications']['Row'];
      };
      upsert_promotion: {
        Args: {
          p_code: string;
          p_name: string;
          p_kind: Database['public']['Enums']['promotion_kind'];
          p_scope?: Database['public']['Enums']['promotion_scope'];
          p_promotion_id?: string | null;
          p_value_bps?: number | null;
          p_value_cents?: number | null;
          p_service_id?: string | null;
          p_vehicle_category?: Database['public']['Enums']['vehicle_category'] | null;
          p_starts_on?: string | null;
          p_ends_on?: string | null;
          p_weekdays?: number[] | null;
          p_min_purchase_cents?: number;
          p_max_uses?: number | null;
          p_max_uses_per_customer?: number | null;
          p_is_active?: boolean;
        };
        Returns: Database['public']['Tables']['promotions']['Row'];
      };
      validate_promotion: {
        Args: {
          p_code: string;
          p_subtotal: number;
          p_lines?: Json;
          p_customer_id?: string | null;
        };
        Returns: Json;
      };
      upsert_branch: {
        Args: {
          p_name: string;
          p_branch_id?: string | null;
          p_address?: string | null;
          p_phone?: string | null;
          p_is_main?: boolean;
          p_is_active?: boolean;
        };
        Returns: Database['public']['Tables']['branches']['Row'];
      };
      set_employee_branch: {
        Args: {
          p_profile_id: string;
          p_branch_id: string | null;
          p_scope?: Database['public']['Enums']['branch_scope'];
        };
        Returns: Database['public']['Tables']['profiles']['Row'];
      };
      set_employee_pay: {
        Args: {
          p_profile_id: string;
          p_payroll_type: Database['public']['Enums']['payroll_type'];
          p_base_salary_cents?: number;
          p_hourly_rate_cents?: number;
          p_commission_bps?: number | null;
        };
        Returns: Database['public']['Tables']['profiles']['Row'];
      };
      schedule_shift: {
        Args: {
          p_profile_id: string;
          p_starts_at: string;
          p_ends_at: string;
          p_branch_id?: string | null;
          p_notes?: string | null;
          p_shift_id?: string | null;
        };
        Returns: Database['public']['Tables']['work_shifts']['Row'];
      };
      delete_shift: {
        Args: { p_shift_id: string };
        Returns: void;
      };
      clock_in: {
        Args: { p_profile_id?: string | null; p_notes?: string | null };
        Returns: Database['public']['Tables']['attendance_records']['Row'];
      };
      clock_out: {
        Args: { p_profile_id?: string | null; p_notes?: string | null };
        Returns: Database['public']['Tables']['attendance_records']['Row'];
      };
      register_payroll_advance: {
        Args: {
          p_profile_id: string;
          p_amount_cents: number;
          p_reason?: string | null;
          p_cash_session_id?: string | null;
        };
        Returns: Database['public']['Tables']['payroll_advances']['Row'];
      };
      open_payroll_period: {
        Args: {
          p_from: string;
          p_to: string;
          p_branch_id?: string | null;
          p_notes?: string | null;
        };
        Returns: Database['public']['Tables']['payroll_periods']['Row'];
      };
      adjust_payroll_item: {
        Args: {
          p_item_id: string;
          p_bonus_cents?: number;
          p_deductions_cents?: number;
          p_notes?: string | null;
        };
        Returns: Database['public']['Tables']['payroll_items']['Row'];
      };
      approve_payroll: {
        Args: { p_period_id: string };
        Returns: Database['public']['Tables']['payroll_periods']['Row'];
      };
      pay_payroll: {
        Args: {
          p_period_id: string;
          p_payment_method?: Database['public']['Enums']['payment_method'];
          p_cash_session_id?: string | null;
        };
        Returns: Database['public']['Tables']['payroll_periods']['Row'];
      };
      delete_payroll_period: {
        Args: { p_period_id: string };
        Returns: void;
      };
      upsert_fleet: {
        Args: {
          p_customer_id: string;
          p_name: string;
          p_fleet_id?: string | null;
          p_code?: string | null;
          p_contact_name?: string | null;
          p_contact_phone?: string | null;
          p_contact_email?: string | null;
          p_po_reference?: string | null;
          p_notes?: string | null;
          p_is_active?: boolean;
        };
        Returns: Database['public']['Tables']['fleets']['Row'];
      };
      assign_vehicle_to_fleet: {
        Args: { p_vehicle_id: string; p_fleet_id: string | null };
        Returns: Database['public']['Tables']['vehicles']['Row'];
      };
      set_fleet_rate: {
        Args: {
          p_fleet_id: string;
          p_service_id: string;
          p_price_cents: number;
          p_vehicle_category?: Database['public']['Enums']['vehicle_category'] | null;
        };
        Returns: Database['public']['Tables']['fleet_rates']['Row'];
      };
      delete_fleet_rate: {
        Args: { p_rate_id: string };
        Returns: void;
      };
      invoice_fleet_period: {
        Args: {
          p_fleet_id: string;
          p_from: string;
          p_to: string;
          p_client_request_id: string;
          p_ncf_type?: Database['public']['Enums']['ncf_type'] | null;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      fleet_statement: {
        Args: { p_fleet_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      book_appointment: {
        Args: {
          p_branch_id: string;
          p_customer_name: string;
          p_scheduled_at: string;
          p_service_id?: string | null;
          p_vehicle_plate?: string;
          p_vehicle_category?: Database['public']['Enums']['vehicle_category'];
          p_customer_id?: string | null;
          p_customer_phone?: string | null;
          p_duration_minutes?: number | null;
          p_notes?: string | null;
        };
        Returns: Database['public']['Tables']['appointments']['Row'];
      };
      convert_appointment: {
        Args: { p_appointment_id: string; p_client_request_id: string };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      appointment_availability: {
        Args: { p_branch_id: string; p_start: string; p_minutes?: number };
        Returns: Json;
      };
      open_maintenance: {
        Args: {
          p_equipment_id: string;
          p_kind: Database['public']['Enums']['maintenance_kind'];
          p_description: string;
          p_supplier_id?: string | null;
        };
        Returns: Database['public']['Tables']['maintenance_orders']['Row'];
      };
      complete_maintenance: {
        Args: {
          p_maintenance_id: string;
          p_cost_cents?: number;
          p_resolution?: string | null;
          p_parts?: string | null;
        };
        Returns: Database['public']['Tables']['maintenance_orders']['Row'];
      };
      submit_qc_review: {
        Args: {
          p_order_id: string;
          p_result: Database['public']['Enums']['qc_result'];
          p_results?: Json;
          p_reject_reason?: string | null;
          p_washer_id?: string | null;
          p_notes?: string | null;
        };
        Returns: Database['public']['Tables']['qc_reviews']['Row'];
      };
      qc_rework_index: {
        Args: { p_from: string; p_to: string };
        Returns: Json;
      };
      sign_inspection: {
        Args: { p_inspection_id: string; p_signature: string; p_signed_by: string };
        Returns: Database['public']['Tables']['vehicle_inspections']['Row'];
      };
      management_report: {
        Args: { p_from: string; p_to: string; p_branch_id?: string | null };
        Returns: Json;
      };
      service_recipe_cost: {
        Args: {
          p_service_id: string;
          p_vehicle_category?: Database['public']['Enums']['vehicle_category'] | null;
        };
        Returns: number;
      };
      pay_supplier: {
        Args: {
          p_purchase_id: string;
          p_amount_cents: number;
          p_payment_method?: Database['public']['Enums']['payment_method'];
          p_reference?: string | null;
          p_cash_session_id?: string | null;
        };
        Returns: Database['public']['Tables']['purchases']['Row'];
      };
      membego_link_company: {
        Args: { p_membego_company_id: string };
        Returns: undefined;
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
      claim_kind: "dano_vehiculo" | "objeto_perdido" | "servicio_deficiente" | "cobro" | "demora" | "otro";
      claim_status: "abierto" | "en_revision" | "resuelto" | "rechazado";
      appointment_status: "pendiente" | "confirmada" | "en_curso" | "convertida" | "cancelada" | "ausente";
      equipment_status: "operativo" | "mantenimiento" | "fuera_servicio" | "retirado";
      maintenance_kind: "preventivo" | "correctivo";
      maintenance_status: "abierta" | "completada" | "cancelada";
      qc_result: "aprobado" | "rechazado";
      inspection_stage: "recepcion" | "entrega";
      damage_kind: "rayon" | "abolladura" | "rotura" | "faltante" | "mancha" | "oxido" | "otro";
      damage_severity: "leve" | "moderado" | "grave";
      inventory_movement_kind: "entrada" | "compra" | "venta" | "devolucion" | "consumo" | "ajuste" | "merma" | "transferencia";
      item_type: "service" | "package" | "product";
      membego_status: "active" | "inactive" | "none";
      customer_origin: "carwash" | "membego";
      ncf_type: "B01" | "B02" | "B04" | "B14" | "B15";
      order_status: "pendiente" | "en_espera" | "asignada" | "en_proceso" | "control_calidad" | "listo" | "entregado" | "cancelado";
      payment_method: "efectivo" | "tarjeta" | "transferencia" | "pago_movil" | "membego_beneficio" | "credito" | "cortesia" | "mixto";
      payment_status: "pendiente" | "pagado" | "parcial" | "reembolsado";
      payroll_type: "mensual" | "por_hora" | "solo_comision";
      payroll_status: "borrador" | "aprobada" | "pagada";
      branch_scope: "sucursal" | "todas";
      promotion_kind: "porcentaje" | "importe";
      promotion_scope: "total" | "servicio" | "categoria";
      notification_kind: "orden_lista" | "recordatorio_cita" | "stock_bajo" | "cuenta_vencida" | "mantenimiento_pendiente" | "caja_sin_cerrar" | "otro";
      notification_audience: "cliente" | "interno";
      notification_channel: "whatsapp" | "sms" | "email" | "app";
      notification_status: "pendiente" | "enviado" | "descartado" | "fallido";
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

