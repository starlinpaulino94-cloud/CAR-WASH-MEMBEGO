import React, { useState } from 'react';
import { X, QrCode, Search, UserCheck, Car, Sparkles, Check, AlertCircle, ShieldCheck, ArrowRight, RefreshCw, PlusCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { VehicleCategory, Service, MembegoBenefit, Customer } from '../../types';
import { membegoApiService, MembegoVerificationResult } from '../../services/membegoApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const NuevaLlegadaModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const {
    services,
    products,
    vehicles,
    customers,
    addWorkOrder,
    addCustomer,
    addVehicle,
    isMembegoOnline
  } = useApp();

  const [step, setStep] = useState<'identify' | 'vehicle' | 'services' | 'confirm'>('identify');
  
  // Search & Identification state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingMembego, setIsSearchingMembego] = useState(false);
  const [membegoResult, setMembegoResult] = useState<MembegoVerificationResult | null>(null);
  
  // Selected Customer & Vehicle
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isAnonymousGuest, setIsAnonymousGuest] = useState(false);
  
  // Vehicle Details
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('Toyota');
  const [model, setModel] = useState('Corolla');
  const [color, setColor] = useState('Blanco');
  const [category, setCategory] = useState<VehicleCategory>('sedan');
  
  // Selected Services & Benefits
  const [selectedServices, setSelectedServices] = useState<{ service: Service; isBenefitApplied: boolean; benefitId?: string }[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<{ productId: string; name: string; price: number; qty: number }[]>([]);
  const [appliedBenefit, setAppliedBenefit] = useState<MembegoBenefit | null>(null);
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleMembegoSearch = async (queryText?: string) => {
    const q = queryText || searchQuery;
    if (!q) return;

    setIsSearchingMembego(true);
    setMembegoResult(null);

    try {
      const res = await membegoApiService.verifyMembegoCustomer(q);
      setMembegoResult(res);

      if (res.success && res.customer) {
        setSelectedCustomer(res.customer);
        setIsAnonymousGuest(false);

        // Pre-fill vehicle if matching vehicle exists
        const matchedVeh = vehicles.find(v => v.customerId === res.customer?.id || (res.benefits?.[0]?.allowedPlates?.includes(v.plate)));
        if (matchedVeh) {
          setPlate(matchedVeh.plate);
          setMake(matchedVeh.make);
          setModel(matchedVeh.model);
          setColor(matchedVeh.color);
          setCategory(matchedVeh.category);
        } else if (res.benefits?.[0]?.allowedPlates?.[0]) {
          setPlate(res.benefits[0].allowedPlates[0]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingMembego(false);
    }
  };

  const handleGuestContinue = () => {
    setSelectedCustomer(null);
    setIsAnonymousGuest(true);
    setStep('vehicle');
  };

  const toggleServiceSelection = (service: Service) => {
    const exists = selectedServices.find(s => s.service.id === service.id);
    if (exists) {
      setSelectedServices(prev => prev.filter(s => s.service.id !== service.id));
    } else {
      // Check if service matches applied Membego benefit
      const matchesBenefit = appliedBenefit && (appliedBenefit.serviceId === service.id || appliedBenefit.serviceName.includes(service.name));
      setSelectedServices(prev => [
        ...prev,
        {
          service,
          isBenefitApplied: Boolean(matchesBenefit),
          benefitId: matchesBenefit ? appliedBenefit?.id : undefined
        }
      ]);
    }
  };

  const handleApplyBenefit = (benefit: MembegoBenefit) => {
    setAppliedBenefit(benefit);
    // Find matching service in catalog
    const matchingServ = services.find(s => s.id === benefit.serviceId || s.name.toLowerCase().includes(benefit.serviceName.toLowerCase()));
    if (matchingServ) {
      // Auto-select and mark covered
      setSelectedServices(prev => {
        const clean = prev.filter(s => s.service.id !== matchingServ.id);
        return [...clean, { service: matchingServ, isBenefitApplied: true, benefitId: benefit.id }];
      });
    }
  };

  const handleCreateOrder = async () => {
    if (!plate) {
      alert('Por favor ingrese la placa del vehículo');
      return;
    }

    if (selectedServices.length === 0) {
      alert('Por favor seleccione al menos un servicio');
      return;
    }

    // Ensure customer exists or registered if not guest
    let custId = selectedCustomer?.id;
    let custName = selectedCustomer?.name || (isAnonymousGuest ? `Cliente General (${plate})` : 'Cliente Visitante');

    if (!selectedCustomer && !isAnonymousGuest) {
      const newC = addCustomer({
        companyId: 'comp-101',
        branchId: 'branch-1',
        name: `Cliente Placa ${plate}`,
        notes: 'Registrado desde recepción rápida'
      });
      custId = newC.id;
      custName = newC.name;
    }

    // Register vehicle if new
    let vehId = vehicles.find(v => v.plate.toUpperCase() === plate.toUpperCase())?.id;
    if (!vehId) {
      const newV = addVehicle({
        companyId: 'comp-101',
        customerId: custId,
        customerName: custName,
        plate: plate.toUpperCase(),
        make,
        model,
        color,
        category
      });
      vehId = newV.id;
    }

    // Build order items
    const items = selectedServices.map(s => {
      const unitPrice = s.service.priceByVehicle[category] || s.service.priceByVehicle.sedan;
      return {
        id: `item-${Date.now()}-${Math.random()}`,
        itemType: 'service' as const,
        itemId: s.service.id,
        name: `${s.service.name} (${category.toUpperCase()})`,
        quantity: 1,
        unitPrice,
        discount: s.isBenefitApplied ? unitPrice : 0,
        total: s.isBenefitApplied ? 0 : unitPrice,
        isMembegoCovered: s.isBenefitApplied
      };
    });

    // Handle Membego benefit reservation if benefit was used
    let redemptionId: string | undefined;
    if (appliedBenefit && selectedCustomer?.membegoCustomerId) {
      const reserveRes = await membegoApiService.reserveBenefit({
        idempotencyKey: `idemp-reserve-${Date.now()}-${plate}`,
        membegoCustomerId: selectedCustomer.membegoCustomerId,
        benefitId: appliedBenefit.id,
        vehiclePlate: plate,
        branchId: 'branch-1'
      });
      redemptionId = reserveRes.redemptionId;
    }

    addWorkOrder({
      customerId: custId,
      customerName: custName,
      customerPhone: selectedCustomer?.phone,
      vehicleId: vehId,
      vehiclePlate: plate.toUpperCase(),
      vehicleMakeModel: `${make} ${model}`,
      vehicleCategory: category,
      vehicleColor: color,
      status: 'pendiente',
      priority: appliedBenefit ? 'vip_membego' : 'normal',
      assignedEmployeeIds: [],
      assignedEmployeeNames: [],
      items,
      paymentStatus: appliedBenefit ? 'pagado' : 'pendiente',
      paymentMethod: appliedBenefit ? 'membego_beneficio' : undefined,
      membegoCustomerId: selectedCustomer?.membegoCustomerId,
      membegoMembershipId: appliedBenefit?.membershipId,
      membegoBenefitId: appliedBenefit?.id,
      membegoRedemptionId: redemptionId,
      benefitStatus: appliedBenefit ? 'reservado' : undefined,
      notes,
      createdBy: 'usr-3',
      createdByName: 'Ana Beltrán'
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-surface border border-line w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-brand-soft/50 to-surface px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand/30 text-brand rounded-xl border border-brand/30">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-strong flex items-center gap-2">
                Nueva Llegada de Vehículo
              </h2>
              <p className="text-xs text-muted">
                Identificación rápida, verificación Membego y creación de orden
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-strong p-2 rounded-xl hover:bg-surface-2 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between bg-canvas px-8 py-3 border-b border-line text-xs font-semibold">
          <div className={`flex items-center gap-2 ${step === 'identify' ? 'text-brand' : 'text-faint'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step === 'identify' ? 'bg-brand text-on-accent' : 'bg-surface-2'}`}>1</span>
            Identificación
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-faint" />
          <div className={`flex items-center gap-2 ${step === 'vehicle' ? 'text-brand' : 'text-faint'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step === 'vehicle' ? 'bg-brand text-on-accent' : 'bg-surface-2'}`}>2</span>
            Vehículo
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-faint" />
          <div className={`flex items-center gap-2 ${step === 'services' ? 'text-brand' : 'text-faint'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step === 'services' ? 'bg-brand text-on-accent' : 'bg-surface-2'}`}>3</span>
            Servicios & Beneficios
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[65vh]">
          {step === 'identify' && (
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => handleMembegoSearch('mbg-usr-9001')}
                  className="p-4 bg-gradient-to-br from-brand-soft/40 to-surface-2 border border-brand/40 hover:border-brand rounded-xl flex items-center gap-4 text-left transition-all group"
                >
                  <div className="p-3 bg-brand text-on-accent rounded-xl shadow-lg shadow-brand/30 group-hover:scale-105 transition-transform">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-strong flex items-center gap-2">
                      Escanear QR / Simular VIP
                      <span className="text-xs bg-brand/30 text-brand-hi px-1.5 py-0.5 rounded">Membego VIP</span>
                    </div>
                    <div className="text-xs text-muted">Verificar membresía y beneficios de Ramón Peña (Demo)</div>
                  </div>
                </button>

                <button
                  onClick={handleGuestContinue}
                  className="p-4 bg-surface-2/80 hover:bg-surface-2 border border-line-strong rounded-xl flex items-center gap-4 text-left transition-all"
                >
                  <div className="p-3 bg-surface-3 text-body rounded-xl">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-strong">Cliente Visitante / Anónimo</div>
                    <div className="text-xs text-muted">Continuar rápido sin registro de cuenta (Venta exprés)</div>
                  </div>
                </button>
              </div>

              {/* Search Bar */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Buscar por Teléfono, Nombre, Correo o Placa
                </label>
                <div className="relative flex items-center">
                  <Search className="w-5 h-5 absolute left-3.5 text-faint" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleMembegoSearch()}
                    placeholder="Ej: 809-555-0101, A000101, mbg-usr-9001, etc."
                    className="w-full bg-canvas border border-line rounded-xl pl-11 pr-28 py-3 text-sm text-strong placeholder-faint focus:outline-none focus:border-brand"
                  />
                  <button
                    onClick={() => handleMembegoSearch()}
                    disabled={isSearchingMembego}
                    className="absolute right-2 px-4 py-1.5 bg-brand hover:bg-brand text-on-accent font-medium rounded-lg text-xs transition-colors flex items-center gap-1.5"
                  >
                    {isSearchingMembego ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Buscar'}
                  </button>
                </div>
              </div>

              {/* Result Container */}
              {membegoResult && (
                <div className={`p-4 rounded-xl border ${membegoResult.success ? 'bg-brand-soft/30 border-brand/40' : 'bg-danger/30 border-danger/50/40'}`}>
                  {membegoResult.success && membegoResult.customer ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-brand/30 text-brand-hi font-bold flex items-center justify-center border border-brand/40">
                            {membegoResult.customer.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-strong flex items-center gap-2">
                              {membegoResult.customer.name}
                              <span className="text-xs bg-warning/20 text-warning border border-warning/30 px-2 py-0.5 rounded-full font-semibold">
                                {membegoResult.customer.membegoTier || 'Socio Activo'}
                              </span>
                            </div>
                            <div className="text-xs text-muted">Tel: {membegoResult.customer.phone} • Membego ID: {membegoResult.customer.membegoCustomerId}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => setStep('vehicle')}
                          className="px-4 py-2 bg-success hover:bg-success text-on-accent text-xs font-bold rounded-lg shadow-lg shadow-success/30 transition-colors flex items-center gap-1.5"
                        >
                          Confirmar Socio <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Benefits available */}
                      {membegoResult.benefits && membegoResult.benefits.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-brand-soft/40">
                          <div className="text-xs font-bold text-brand-hi flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-success" />
                            Beneficios y Membresías Disponibles:
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {membegoResult.benefits.map(b => (
                              <div key={b.id} className="p-2.5 bg-surface/80 rounded-lg border border-brand/30 text-xs space-y-1">
                                <div className="font-semibold text-strong flex justify-between">
                                  <span>{b.serviceName}</span>
                                  <span className="text-success font-bold">{b.discountPercentage}% OFF</span>
                                </div>
                                <div className="text-xs text-muted">{b.membershipName} • Usos: {b.usesRemaining}/{b.usesMax}</div>
                                <button
                                  onClick={() => {
                                    handleApplyBenefit(b);
                                    setStep('vehicle');
                                  }}
                                  className="w-full mt-1.5 py-1 bg-brand/30 hover:bg-brand text-brand-hi hover:text-on-accent rounded text-xs font-semibold border border-brand/40 transition-colors"
                                >
                                  Usar este beneficio hoy
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-danger text-xs">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 text-danger" />
                      <div>
                        <div className="font-bold">{membegoResult.message}</div>
                        <div className="text-muted mt-0.5">Puede continuar registrando los datos del vehículo como cliente visitante.</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'vehicle' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between bg-canvas p-3 rounded-xl border border-line">
                <div className="flex items-center gap-2 text-xs text-body">
                  <UserCheck className="w-4 h-4 text-brand" />
                  Cliente: <strong className="text-strong">{selectedCustomer ? selectedCustomer.name : 'Cliente Visitante / Anónimo'}</strong>
                </div>
                <button
                  onClick={() => setStep('identify')}
                  className="text-xs text-brand hover:underline"
                >
                  Cambiar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted uppercase">Placa del Vehículo *</label>
                  <input
                    type="text"
                    value={plate}
                    onChange={e => setPlate(e.target.value.toUpperCase())}
                    placeholder="Ej: A000101"
                    className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm font-bold tracking-wider text-strong uppercase focus:outline-none focus:border-brand"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted uppercase">Categoría / Tamaño *</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as VehicleCategory)}
                    className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand"
                  >
                    <option value="sedan">Sedán (Auto Pequeño/Mediano)</option>
                    <option value="suv">SUV / Crossover (4x2 / 4x4)</option>
                    <option value="jeep">Jeep / Todoterreno Grande</option>
                    <option value="pickup">Camioneta / Pickup 4x4</option>
                    <option value="van">Minibús / Van Familiar</option>
                    <option value="motorcycle">Motocicleta / Pasola</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted uppercase">Marca</label>
                  <input
                    type="text"
                    value={make}
                    onChange={e => setMake(e.target.value)}
                    placeholder="Ej: Toyota"
                    className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted uppercase">Modelo</label>
                  <input
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="Ej: Land Cruiser Prado"
                    className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-muted uppercase">Color del Vehículo</label>
                  <input
                    type="text"
                    value={color}
                    onChange={e => setColor(e.target.value)}
                    placeholder="Ej: Blanco Perlado, Negro, Gris Grafito"
                    className="w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-sm text-strong focus:outline-none focus:border-brand"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={() => {
                    if (!plate) {
                      alert('Ingrese la placa del vehículo');
                      return;
                    }
                    setStep('services');
                  }}
                  className="px-6 py-2.5 bg-brand hover:bg-brand text-on-accent font-bold rounded-xl text-xs shadow-lg shadow-brand/30 transition-colors flex items-center gap-2"
                >
                  Continuar a Servicios <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 'services' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs text-muted bg-canvas p-3 rounded-xl border border-line">
                <div>Vehículo: <strong className="text-strong">{plate}</strong> ({make} {model} - {category.toUpperCase()})</div>
                {appliedBenefit && (
                  <div className="bg-success/20 text-success font-bold px-2 py-0.5 rounded border border-success/30 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Beneficio Membego Activo
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted uppercase">Seleccionar Servicios para {category.toUpperCase()}</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {services.map(s => {
                    const price = s.priceByVehicle[category] || s.priceByVehicle.sedan;
                    const isSelected = selectedServices.some(sel => sel.service.id === s.id);
                    const isCovered = selectedServices.find(sel => sel.service.id === s.id)?.isBenefitApplied;

                    return (
                      <div
                        key={s.id}
                        onClick={() => toggleServiceSelection(s)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-brand-soft/50 border-brand text-strong shadow-lg shadow-brand/20'
                            : 'bg-canvas/60 border-line text-body hover:border-line-strong'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="font-bold text-sm flex items-center gap-2">
                            {s.name}
                            {s.isPopular && <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">Popular</span>}
                          </div>
                          <div className="text-right">
                            {isCovered ? (
                              <span className="text-xs font-bold text-success bg-success/20 px-2 py-0.5 rounded">INCLUIDO $0</span>
                            ) : (
                              <span className="text-sm font-bold text-brand-hi">RD$ {price.toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted mt-1 line-clamp-2">{s.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted uppercase">Notas U Observaciones del Lavado</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Ej: Cuidado con la pintura reciente en la puerta izquierda, aromatizante vainilla..."
                  rows={2}
                  className="w-full bg-canvas border border-line rounded-xl p-3 text-xs text-strong focus:outline-none focus:border-brand"
                />
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-line">
                <button
                  onClick={() => setStep('vehicle')}
                  className="px-4 py-2 text-muted hover:text-strong text-xs font-semibold"
                >
                  Atrás
                </button>
                <button
                  onClick={handleCreateOrder}
                  className="px-6 py-3 bg-success hover:bg-success text-on-accent font-bold rounded-xl text-xs shadow-xl shadow-success/30 transition-all flex items-center gap-2"
                >
                  <PlusCircle className="w-4 h-4" /> Crear Orden de Lavado
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
