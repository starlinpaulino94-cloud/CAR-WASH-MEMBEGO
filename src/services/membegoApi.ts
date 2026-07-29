import { Customer, MembegoBenefit, MembegoSyncLog } from '../types';

export interface MembegoVerificationResult {
  success: boolean;
  online: boolean;
  customer?: Customer;
  benefits?: MembegoBenefit[];
  message: string;
  errorCode?: string;
}

export interface RedemptionRequest {
  idempotencyKey: string;
  membegoCustomerId: string;
  benefitId: string;
  vehiclePlate: string;
  branchId: string;
  workOrderId?: string;
}

class MembegoApiService {
  private isApiOnline: boolean = true;
  private syncLogs: MembegoSyncLog[] = [];
  private processedIdempotencyKeys: Set<string> = new Set();

  // Mock Membego Cloud Database
  private membegoDatabase = {
    'mbg-usr-9001': {
      customer: {
        id: 'cust-1',
        companyId: 'comp-101',
        branchId: 'branch-1',
        name: 'Starlin El Tanque',
        phone: '809-771-4400',
        email: 'starlin.eltanquemotors@gmail.com',
        membegoCustomerId: 'mbg-usr-9001',
        membegoStatus: 'active' as const,
        membegoTier: 'Socio VIP Diamond',
        totalVisits: 28,
        totalSpent: 34500,
        createdAt: '2025-11-10T08:00:00Z'
      },
      benefits: [
        {
          id: 'ben-01-diamond',
          membershipId: 'mbg-mem-99',
          membershipName: 'Membresía Diamond Ilimitada',
          serviceId: 'serv-2',
          serviceName: 'Lavado Completo Premium + Aspirado',
          discountPercentage: 100,
          usesRemaining: 8,
          usesMax: 10,
          expiresAt: '2026-12-31T23:59:59Z',
          allowedPlates: ['A982134'],
          restrictions: 'Válido para 1 lavado por día en vehículo registrado A982134.'
        },
        {
          id: 'ben-02-ceramic',
          membershipId: 'mbg-mem-99',
          membershipName: 'Membresía Diamond Ilimitada',
          serviceId: 'serv-4',
          serviceName: 'Encerado Cerámico Exprés',
          discountPercentage: 50,
          usesRemaining: 2,
          usesMax: 2,
          expiresAt: '2026-12-31T23:59:59Z',
          restrictions: '50% de descuento en encerado mensual.'
        }
      ]
    },
    'mbg-usr-9022': {
      customer: {
        id: 'cust-2',
        companyId: 'comp-101',
        branchId: 'branch-1',
        name: 'Laura Fernández',
        phone: '829-450-2211',
        email: 'laura.fernandez@gmail.com',
        membegoCustomerId: 'mbg-usr-9022',
        membegoStatus: 'active' as const,
        membegoTier: 'Gold Unlimited Club',
        totalVisits: 14,
        totalSpent: 18200,
        createdAt: '2026-01-15T12:00:00Z'
      },
      benefits: [
        {
          id: 'ben-02-gold',
          membershipId: 'mbg-mem-102',
          membershipName: 'Gold Unlimited Club',
          serviceId: 'serv-1',
          serviceName: 'Lavado Espuma Express & Secado',
          discountPercentage: 100,
          usesRemaining: 4,
          usesMax: 4,
          expiresAt: '2026-08-15T23:59:59Z',
          allowedPlates: ['G412098'],
          restrictions: 'Válido en vehículo G412098.'
        }
      ]
    }
  };

  public setOnlineStatus(online: boolean) {
    this.isApiOnline = online;
  }

  public getOnlineStatus(): boolean {
    return this.isApiOnline;
  }

  public getSyncLogs(): MembegoSyncLog[] {
    return [...this.syncLogs];
  }

  /**
   * GET /v1/customers/search or QR Scan decode
   */
  public async verifyMembegoCustomer(qrOrQuery: string): Promise<MembegoVerificationResult> {
    const timestamp = new Date().toISOString();

    if (!this.isApiOnline) {
      this.recordLog({
        id: `log-${Date.now()}`,
        action: 'validate_qr',
        idempotencyKey: `idemp-check-${Date.now()}`,
        status: 'failed',
        requestPayload: { query: qrOrQuery },
        responsePayload: null,
        timestamp,
        errorMessage: 'Conexión con api.membego.com no disponible (Modo Contingencia Local).'
      });

      return {
        success: false,
        online: false,
        message: 'No fue posible conectar con api.membego.com. Puede continuar en Modo Contingencia Local sin detener la operación.'
      };
    }

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Match query against mock DB
    const cleanQuery = qrOrQuery.trim().toLowerCase();
    
    let matchedEntry = Object.values(this.membegoDatabase).find(entry => {
      const c = entry.customer;
      return (
        c.membegoCustomerId.toLowerCase() === cleanQuery ||
        c.phone.replace(/[^0-9]/g, '').includes(cleanQuery.replace(/[^0-9]/g, '')) ||
        c.email.toLowerCase().includes(cleanQuery) ||
        c.name.toLowerCase().includes(cleanQuery) ||
        cleanQuery.includes(c.membegoCustomerId.toLowerCase())
      );
    });

    // Default fallback mock if user enters a custom query
    if (!matchedEntry && (cleanQuery.includes('starlin') || cleanQuery.includes('9001') || cleanQuery.includes('prado') || cleanQuery.includes('a982134'))) {
      matchedEntry = this.membegoDatabase['mbg-usr-9001'];
    }

    if (!matchedEntry) {
      this.recordLog({
        id: `log-${Date.now()}`,
        action: 'validate_qr',
        idempotencyKey: `idemp-check-${Date.now()}`,
        status: 'failed',
        requestPayload: { query: qrOrQuery },
        responsePayload: { count: 0 },
        timestamp,
        errorMessage: 'Cliente no encontrado en el directorio central de Membego.'
      });

      return {
        success: false,
        online: true,
        message: 'No se encontró un socio de Membego activo con esos datos.'
      };
    }

    this.recordLog({
      id: `log-${Date.now()}`,
      action: 'validate_qr',
      idempotencyKey: `idemp-check-${Date.now()}`,
      status: 'success',
      requestPayload: { query: qrOrQuery },
      responsePayload: { customerId: matchedEntry.customer.membegoCustomerId, benefitsCount: matchedEntry.benefits.length },
      timestamp
    });

    return {
      success: true,
      online: true,
      customer: matchedEntry.customer as unknown as Customer,
      benefits: matchedEntry.benefits as MembegoBenefit[],
      message: `Socio verificado: ${matchedEntry.customer.name} (${matchedEntry.customer.membegoTier})`
    };
  }

  /**
   * POST /v1/redemptions/reserve
   */
  public async reserveBenefit(req: RedemptionRequest): Promise<{ success: boolean; redemptionId?: string; message: string }> {
    if (!this.isApiOnline) {
      return {
        success: false,
        message: 'Servidor Membego fuera de línea. La orden se guardó con reserva pendiente de sincronización.'
      };
    }

    if (this.processedIdempotencyKeys.has(req.idempotencyKey)) {
      return {
        success: true,
        redemptionId: `rdm-cached-${req.idempotencyKey.slice(0, 8)}`,
        message: 'Solicitud ya procesada anteriormente (Idempotencia verificada).'
      };
    }

    this.processedIdempotencyKeys.add(req.idempotencyKey);
    const redemptionId = `rdm-${Math.floor(100000 + Math.random() * 900000)}`;

    this.recordLog({
      id: `log-${Date.now()}`,
      action: 'reserve_benefit',
      idempotencyKey: req.idempotencyKey,
      status: 'success',
      requestPayload: req,
      responsePayload: { redemptionId, status: 'reserved' },
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      redemptionId,
      message: 'Beneficio reservado exitosamente en Membego Cloud.'
    };
  }

  /**
   * POST /v1/redemptions/confirm
   */
  public async confirmRedemption(redemptionId: string, idempotencyKey: string): Promise<{ success: boolean; message: string }> {
    if (!this.isApiOnline) {
      return {
        success: false,
        message: 'Modo Offline: La confirmación de beneficio se enviará al reconectar.'
      };
    }

    this.recordLog({
      id: `log-${Date.now()}`,
      action: 'confirm_redemption',
      idempotencyKey,
      status: 'success',
      requestPayload: { redemptionId },
      responsePayload: { status: 'confirmed', consumedAt: new Date().toISOString() },
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Beneficio consumido y descontado oficialmente en Membego Core.'
    };
  }

  /**
   * POST /v1/redemptions/cancel
   */
  public async cancelRedemption(redemptionId: string, idempotencyKey: string, reason: string): Promise<{ success: boolean; message: string }> {
    this.recordLog({
      id: `log-${Date.now()}`,
      action: 'cancel_redemption',
      idempotencyKey,
      status: 'success',
      requestPayload: { redemptionId, reason },
      responsePayload: { status: 'cancelled', restoredAt: new Date().toISOString() },
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Reserva de beneficio liberada y devuelta al saldo del cliente.'
    };
  }

  private recordLog(log: MembegoSyncLog) {
    this.syncLogs.unshift(log);
    if (this.syncLogs.length > 50) {
      this.syncLogs.pop();
    }
  }
}

export const membegoApiService = new MembegoApiService();
