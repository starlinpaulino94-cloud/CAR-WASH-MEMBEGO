import React, { useState } from 'react';
import {
  ShoppingBag,
  Car,
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  Building,
  ShieldCheck,
  CheckCircle2,
  Printer,
  Sparkles
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Service, Product, VehicleCategory, PaymentMethodType, WorkOrderItem, Invoice } from '../../types';
import { TicketPreviewModal } from '../modals/TicketPreviewModal';

export const PosView: React.FC = () => {
  const {
    services,
    products,
    company,
    currentUser,
    cashSession,
    createInvoice,
    addWorkOrder
  } = useApp();

  const [category, setCategory] = useState<VehicleCategory>('sedan');
  const [activeTabType, setActiveTabType] = useState<'services' | 'products'>('services');

  // Cart & Customer details
  const [customerName, setCustomerName] = useState('Cliente General POS');
  const [vehiclePlate, setVehiclePlate] = useState('A712994');
  const [customerTaxId, setCustomerTaxId] = useState('');

  const [cartItems, setCartItems] = useState<WorkOrderItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('efectivo');
  const [cashTendered, setCashTendered] = useState<number>(1000);
  const [transferRef, setTransferRef] = useState<string>('');

  // Ticket Preview Modal State
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);

  const handleAddServiceToCart = (service: Service) => {
    const price = service.priceByVehicle[category] || service.priceByVehicle.sedan;
    const existing = cartItems.find(i => i.itemId === service.id);

    if (existing) {
      setCartItems(cartItems.map(i => i.itemId === service.id ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * price } : i));
    } else {
      const newItem: WorkOrderItem = {
        id: `pos-${Date.now()}-${Math.random()}`,
        itemType: 'service',
        itemId: service.id,
        name: `${service.name} (${category.toUpperCase()})`,
        quantity: 1,
        unitPrice: price,
        discount: 0,
        total: price
      };
      setCartItems([...cartItems, newItem]);
    }
  };

  const handleAddProductToCart = (prod: Product) => {
    const existing = cartItems.find(i => i.itemId === prod.id);
    if (existing) {
      setCartItems(cartItems.map(i => i.itemId === prod.id ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * prod.price } : i));
    } else {
      const newItem: WorkOrderItem = {
        id: `pos-${Date.now()}-${Math.random()}`,
        itemType: 'product',
        itemId: prod.id,
        name: prod.name,
        quantity: 1,
        unitPrice: prod.price,
        discount: 0,
        total: prod.price
      };
      setCartItems([...cartItems, newItem]);
    }
  };

  const updateItemQty = (id: string, delta: number) => {
    setCartItems(cartItems.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty, total: newQty * item.unitPrice - item.discount };
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setCartItems(cartItems.filter(i => i.id !== id));
  };

  const subtotal = cartItems.reduce((acc, i) => acc + (i.unitPrice * i.quantity), 0);
  const totalDiscount = cartItems.reduce((acc, i) => acc + i.discount, 0);
  const tax = Math.round(Math.max(0, subtotal - totalDiscount) * (company.taxRate / 100));
  const total = Math.max(0, subtotal - totalDiscount + tax);
  const change = paymentMethod === 'efectivo' ? Math.max(0, cashTendered - total) : 0;

  const handleCheckout = () => {
    if (cartItems.length === 0) {
      alert('El carrito está vacío');
      return;
    }

    if (!cashSession || cashSession.status !== 'open') {
      alert('Debe abrir la caja antes de registrar ventas');
      return;
    }

    const created = createInvoice(
      undefined,
      customerName,
      customerTaxId || undefined,
      vehiclePlate || undefined,
      cartItems,
      [
        {
          method: paymentMethod,
          amount: paymentMethod === 'efectivo' ? cashTendered : total,
          reference: transferRef
        }
      ]
    );

    setLastInvoice(created);
    setIsTicketModalOpen(true);
    setCartItems([]);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-indigo-400" /> Punto de Venta Tactil (POS)
          </h2>
          <p className="text-xs text-slate-400">Facturación rápida de servicios, paquetes y productos en caja</p>
        </div>
        <div className="text-xs bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-slate-300">
          Cajero: <strong className="text-white">{currentUser.name}</strong>
        </div>
      </div>

      {/* POS Grid & Cart Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Catalog Area */}
        <div className="lg:col-span-7 space-y-5">
          {/* Category Bar */}
          <div className="space-y-2">
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">
              1. Seleccionar Categoría de Vehículo
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { id: 'sedan', label: 'Sedán' },
                { id: 'suv', label: 'SUV' },
                { id: 'jeep', label: 'Jeep 4x4' },
                { id: 'pickup', label: 'Pickup' },
                { id: 'van', label: 'Van' },
                { id: 'motorcycle', label: 'Moto' }
              ].map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id as VehicleCategory)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                    category === cat.id
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Type Toggle: Services vs Products */}
          <div className="flex border-b border-slate-800 gap-4 text-xs font-bold">
            <button
              onClick={() => setActiveTabType('services')}
              className={`pb-2 border-b-2 transition-colors ${
                activeTabType === 'services' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500'
              }`}
            >
              Catálogo de Servicios
            </button>
            <button
              onClick={() => setActiveTabType('products')}
              className={`pb-2 border-b-2 transition-colors ${
                activeTabType === 'products' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500'
              }`}
            >
              Productos e Insumos
            </button>
          </div>

          {/* Catalog items grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {activeTabType === 'services' ? (
              services.map(s => {
                const price = s.priceByVehicle[category] || s.priceByVehicle.sedan;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleAddServiceToCart(s)}
                    className="p-3.5 bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-xl cursor-pointer transition-all space-y-1.5"
                  >
                    <div className="flex justify-between font-bold text-xs text-white">
                      <span>{s.name}</span>
                      <span className="text-indigo-400 font-extrabold">{company.currencySymbol} {price.toLocaleString()}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{s.description}</p>
                  </div>
                );
              })
            ) : (
              products.map(p => (
                <div
                  key={p.id}
                  onClick={() => handleAddProductToCart(p)}
                  className="p-3.5 bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-xl cursor-pointer transition-all space-y-1.5"
                >
                  <div className="flex justify-between font-bold text-xs text-white">
                    <span>{p.name}</span>
                    <span className="text-indigo-400 font-extrabold">{company.currencySymbol} {p.price.toLocaleString()}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Stock disponible: {p.stock} {p.unit}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Checkout & Cart Area */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">Resumen de Venta / Carrito</h3>
              <span className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded font-bold">
                {cartItems.length} ítems
              </span>
            </div>

            {/* Customer Inputs */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase">Cliente</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase">Placa</label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={e => setVehiclePlate(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white uppercase font-bold"
                />
              </div>
            </div>

            {/* Cart Items List */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {cartItems.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500 italic">El carrito está vacío</div>
              ) : (
                cartItems.map(item => (
                  <div key={item.id} className="p-2.5 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
                    <div className="space-y-0.5 max-w-[170px]">
                      <div className="font-bold text-white truncate">{item.name}</div>
                      <div className="text-[10px] text-slate-400">{company.currencySymbol} {item.unitPrice.toLocaleString()} c/u</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg">
                        <button onClick={() => updateItemQty(item.id, -1)} className="p-1 text-slate-400 hover:text-white"><Minus className="w-3 h-3" /></button>
                        <span className="px-2 font-bold text-white text-xs">{item.quantity}</span>
                        <button onClick={() => updateItemQty(item.id, 1)} className="p-1 text-slate-400 hover:text-white"><Plus className="w-3 h-3" /></button>
                      </div>
                      <span className="font-bold text-indigo-300 w-16 text-right">{company.currencySymbol} {item.total.toLocaleString()}</span>
                      <button onClick={() => removeItem(item.id)} className="text-slate-500 hover:text-rose-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Payment & Totals Footer */}
          <div className="space-y-4 pt-4 border-t border-slate-800">
            {/* Totals */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-400"><span>Subtotal:</span><span>{company.currencySymbol} {subtotal.toLocaleString()}</span></div>
              <div className="flex justify-between text-slate-400"><span>ITBIS ({company.taxRate}%):</span><span>{company.currencySymbol} {tax.toLocaleString()}</span></div>
              <div className="flex justify-between font-black text-base text-white border-t border-slate-800 pt-1.5">
                <span>TOTAL A PAGAR:</span>
                <span className="text-indigo-400">{company.currencySymbol} {total.toLocaleString()}</span>
              </div>
            </div>

            {/* Payment Method Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Método de Pago</label>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                {[
                  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
                  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
                  { id: 'transferencia', label: 'Transfer', icon: Building }
                ].map(m => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id as PaymentMethodType)}
                      className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                        paymentMethod === m.id
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {paymentMethod === 'efectivo' && (
                <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                  <span className="text-slate-400">Recibido:</span>
                  <input
                    type="number"
                    value={cashTendered}
                    onChange={e => setCashTendered(Number(e.target.value))}
                    className="w-24 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-right font-bold text-white"
                  />
                  <span className="text-slate-400 font-bold">Cambio: <strong className="text-emerald-400">{company.currencySymbol} {change.toLocaleString()}</strong></span>
                </div>
              )}
            </div>

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={cartItems.length === 0}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-black text-sm rounded-xl shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" /> Cobrar e Imprimir Factura
            </button>
          </div>
        </div>
      </div>

      {/* Ticket Preview Modal */}
      <TicketPreviewModal
        invoice={lastInvoice}
        company={company}
        isOpen={isTicketModalOpen}
        onClose={() => setIsTicketModalOpen(false)}
      />
    </div>
  );
};
