import React, { useState } from 'react';
import { X, BookOpen, Layers, GitBranch, Database, Shield, Cpu, AlertTriangle, CheckCircle, FileText, Server } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const PhaseArchitectureReportModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeSection, setActiveSection] = useState<'resumen' | 'arquitectura' | 'modulos' | 'flujos' | 'modelo' | 'roles' | 'api' | 'fases' | 'riesgos'>('resumen');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-800/90 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg border border-indigo-500/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Entregable Fase 0: Descubrimiento & Arquitectura Operacional
              </h2>
              <p className="text-xs text-slate-400">
                Membego Car Wash Operations • Documento técnico y estratégico completo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex items-center gap-1 bg-slate-950 px-6 py-2 border-b border-slate-800 overflow-x-auto">
          {[
            { id: 'resumen', label: '1. Resumen Ejecutivo', icon: FileText },
            { id: 'arquitectura', label: '2. Arquitectura', icon: Server },
            { id: 'modulos', label: '3. Mapa de Módulos', icon: Layers },
            { id: 'flujos', label: '4. Flujos de Usuario', icon: GitBranch },
            { id: 'modelo', label: '5. Modelo de Datos', icon: Database },
            { id: 'roles', label: '6. Roles & Permisos', icon: Shield },
            { id: 'api', label: '7. Contratos API', icon: Cpu },
            { id: 'fases', label: '8. Plan de Fases', icon: CheckCircle },
            { id: 'riesgos', label: '9. Matriz de Riesgos', icon: AlertTriangle }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as any)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-300 leading-relaxed flex-1">
          {activeSection === 'resumen' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">1. Resumen Ejecutivo</h3>
              <p>
                <strong>Membego Car Wash Operations</strong> es un sistema SaaS especializado diseñado para controlar la operación diaria de establecimientos de lavado de vehículos pequeños y medianos. El sistema opera como un producto independiente de alta velocidad, pero cuenta con conectividad nativa opcional hacia el núcleo de <strong>Membego</strong> (<code className="text-indigo-400 bg-slate-800 px-1.5 py-0.5 rounded">api.membego.com</code>) para la validación y consumo de membresías, promociones y beneficios.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-4">
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
                  <div className="text-indigo-400 font-bold mb-1">⚡ Ultra Veloz</div>
                  <p className="text-xs text-slate-400">Creación de órdenes en menos de 10 segundos con soporte para clientes visitantes, anónimos y ventas directas sin vehículo.</p>
                </div>
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
                  <div className="text-emerald-400 font-bold mb-1">🔌 Resiliencia Offline</div>
                  <p className="text-xs text-slate-400">Si la API de Membego se interrumpe, el POS, la caja y la cola operan sin detenerse en Modo Contingencia.</p>
                </div>
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
                  <div className="text-amber-400 font-bold mb-1">🔒 Cero Duplicados</div>
                  <p className="text-xs text-slate-400">Garantía de idempotencia en redenciones de beneficios con registros inalterables de auditoría.</p>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'arquitectura' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">2. Arquitectura del Sistema</h3>
              <p>
                Diseño decoupled basado en micro-servicios lógicos y arquitectura multicapa limpia:
              </p>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs text-slate-300">
                <div className="text-indigo-400 font-bold">[CAPA FRONTEND] React + Vite + Tailwind CSS + Web Workers</div>
                <div className="pl-4 border-l-2 border-indigo-500 space-y-1">
                  <div>• Layouts optimizados para pantallas táctiles (POS, Recepción, Tablero Kanban)</div>
                  <div>• Soporte nativo para impresión térmica de 58mm y 80mm vía Web Print API</div>
                  <div>• Cache local reactivo con sincronización diferida (Offline First)</div>
                </div>

                <div className="text-emerald-400 font-bold">[CAPA SERVIDOR API POS] Express + Node.js (Port 3000)</div>
                <div className="pl-4 border-l-2 border-emerald-500 space-y-1">
                  <div>• Rest API endpoints para órdenes, bahías, caja, inventario y comisiones</div>
                  <div>• Motor de idempotencia con UUID v4 (IdempotencyKey header)</div>
                  <div>• Middleware de aislamiento multi-tenant por <code className="text-slate-200">companyId</code> y <code className="text-slate-200">branchId</code></div>
                </div>

                <div className="text-sky-400 font-bold">[INTEGRACIÓN CORE MEMBEGO] api.membego.com</div>
                <div className="pl-4 border-l-2 border-sky-500 space-y-1">
                  <div>• Handshake vía OAuth 2.0 / API Keys firmadas</div>
                  <div>• Webhook Listener para actualización en tiempo real de membresías</div>
                  <div>• Queue de reintentos con Exponential Backoff para contingencias</div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'modulos' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">3. Mapa de Módulos del Sistema</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <div className="font-bold text-indigo-300 mb-1">Módulo 1: Recepción & Nueva Llegada</div>
                  <ul className="list-disc list-inside text-xs text-slate-400 space-y-1">
                    <li>Escáner de QR Membego y búsqueda inteligente</li>
                    <li>Registro rápido de vehículo y categoría de precio</li>
                    <li>Soporte de Cliente Visitante Anónimo sin fricción</li>
                  </ul>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <div className="font-bold text-emerald-300 mb-1">Módulo 2: Fila Operacional & Kanban</div>
                  <ul className="list-disc list-inside text-xs text-slate-400 space-y-1">
                    <li>Tablero visual por etapas (Llegada → Espumado → Secado → QC → Listo)</li>
                    <li>Asignación interactiva de bahías y lavadores</li>
                    <li>Alertas visuales por exceso de tiempo de espera</li>
                  </ul>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <div className="font-bold text-amber-300 mb-1">Módulo 3: Punto de Venta (POS) & Caja</div>
                  <ul className="list-disc list-inside text-xs text-slate-400 space-y-1">
                    <li>Venta rápida de servicios, productos e insumos</li>
                    <li>Soporte de pagos combinados (Efectivo + Tarjeta + Beneficio Membego)</li>
                    <li>Apertura, arqueo y cierre ciego de caja con cálculo de descuadres</li>
                  </ul>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <div className="font-bold text-sky-300 mb-1">Módulo 4: Membego Hub & API Sync</div>
                  <ul className="list-disc list-inside text-xs text-slate-400 space-y-1">
                    <li>Redención reservada / confirmada de beneficios</li>
                    <li>Logs detallados de sincronización con correlación ID</li>
                    <li>Simulador de estado de red y contingencia offline</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'flujos' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">4. Flujos Principales de Usuario</h3>
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <div className="font-bold text-indigo-400 mb-1">Flujo A: Cliente VIP Membego</div>
                  <p>Llegada → Escaneo QR → Consulta beneficios activos en Membego → Selección servicio incluido (RD$0.00) → Reserva de beneficio → Creación de Orden en Kanban → Ejecución de lavado → QC → Confirmación de consumo en Membego API → Entrega.</p>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <div className="font-bold text-emerald-400 mb-1">Flujo B: Cliente Visitante Anónimo</div>
                  <p>Llegada → Botón "Cliente General" → Selección de Categoría (ej: SUV) → Selección de Lavado Espuma → Asignación de lavador → Cobro en POS → Emisión de Ticket de caja → Lavado → Entrega.</p>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'modelo' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">5. Modelo de Datos Conceptual</h3>
              <p>Entidades normalizadas preparadas para aislamiento multi-empresa:</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                {['Company', 'Branch', 'User', 'Customer', 'Vehicle', 'Service', 'Product', 'WorkOrder', 'WorkOrderItem', 'Bay', 'Inspection', 'CashSession', 'Invoice', 'Expense', 'CommissionEntry', 'AuditLog'].map(e => (
                  <div key={e} className="p-2 bg-slate-800 rounded border border-slate-700 text-slate-200 text-center">
                    {e}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'roles' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">6. Matriz de Roles y Permisos</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400 bg-slate-800/80">
                      <th className="p-2">Rol</th>
                      <th className="p-2">Llegada & Órdenes</th>
                      <th className="p-2">POS & Cobro</th>
                      <th className="p-2">Caja</th>
                      <th className="p-2">Reportes</th>
                      <th className="p-2">Configuración</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    <tr><td className="p-2 font-bold text-indigo-400">Propietario</td><td className="p-2">Full</td><td className="p-2">Full</td><td className="p-2">Full</td><td className="p-2">Full</td><td className="p-2">Full</td></tr>
                    <tr><td className="p-2 font-bold text-emerald-400">Administrador</td><td className="p-2">Full</td><td className="p-2">Full</td><td className="p-2">Full</td><td className="p-2">Operativo</td><td className="p-2">Limitado</td></tr>
                    <tr><td className="p-2 font-bold text-amber-400">Cajero</td><td className="p-2">Ver / Crear</td><td className="p-2">Full</td><td className="p-2">Turno Propio</td><td className="p-2">Sin Acceso</td><td className="p-2">Sin Acceso</td></tr>
                    <tr><td className="p-2 font-bold text-sky-400">Operario/Lavador</td><td className="p-2">Asignados</td><td className="p-2">Sin Acceso</td><td className="p-2">Sin Acceso</td><td className="p-2">Sin Acceso</td><td className="p-2">Sin Acceso</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSection === 'api' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">7. Contratos de API de Membego Core</h3>
              <div className="space-y-2 font-mono text-xs bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-emerald-400">GET /v1/customers/search?query=...</div>
                <div className="text-emerald-400">GET /v1/customers/:id/benefits</div>
                <div className="text-amber-400">POST /v1/redemptions/reserve (Headers: Idempotency-Key)</div>
                <div className="text-sky-400">POST /v1/redemptions/confirm (Headers: Idempotency-Key)</div>
                <div className="text-rose-400">POST /v1/redemptions/cancel (Headers: Idempotency-Key)</div>
              </div>
            </div>
          )}

          {activeSection === 'fases' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">8. Plan de Fases de Desarrollo</h3>
              <div className="space-y-2 text-xs">
                <div className="p-2.5 bg-indigo-950/40 border border-indigo-800/60 rounded-lg flex justify-between items-center">
                  <span className="font-bold text-indigo-300">Fase 0: Descubrimiento & Arquitectura</span>
                  <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">COMPLETADO</span>
                </div>
                <div className="p-2.5 bg-slate-800/40 border border-slate-700/60 rounded-lg flex justify-between items-center">
                  <span className="font-bold text-slate-200">Fase 1: Núcleo Operacional & Llegadas</span>
                  <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">IMPLEMENTADO Y ACTIVO</span>
                </div>
                <div className="p-2.5 bg-slate-800/40 border border-slate-700/60 rounded-lg flex justify-between items-center">
                  <span className="font-bold text-slate-200">Fase 2: POS, Caja & Facturación Térmica</span>
                  <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">IMPLEMENTADO Y ACTIVO</span>
                </div>
                <div className="p-2.5 bg-slate-800/40 border border-slate-700/60 rounded-lg flex justify-between items-center">
                  <span className="font-bold text-slate-200">Fase 3: Integración Membego API & Contingencia</span>
                  <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">IMPLEMENTADO Y ACTIVO</span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'riesgos' && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white border-b border-slate-800 pb-2">9. Matriz de Riesgos y Mitigación</h3>
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-lg">
                  <div className="font-bold text-amber-300">Riesgo 1: Caída de la API de Membego en horas pico</div>
                  <p className="text-slate-400 mt-1">Mitigación: Modo Contingencia Offline que permite crear órdenes con flag temporal y reintentos automáticos sin detener el lavado.</p>
                </div>
                <div className="p-3 bg-rose-950/30 border border-rose-800/50 rounded-lg">
                  <div className="font-bold text-rose-300">Riesgo 2: Doble redención de beneficio por fallas de red</div>
                  <p className="text-slate-400 mt-1">Mitigación: Encabezados obligatorios de idempotencia (<code className="text-indigo-400">IdempotencyKey</code>) en todas las solicitudes POST a Membego API.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-800/90 px-6 py-3 border-t border-slate-700 flex justify-between items-center text-xs text-slate-400">
          <div>Estado de desarrollo: <span className="text-emerald-400 font-bold">Fase 0 + Fase 1/2 Integradas en Runtime</span></div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors shadow-lg shadow-indigo-600/30"
          >
            Entendido, volver a la aplicación
          </button>
        </div>
      </div>
    </div>
  );
};
