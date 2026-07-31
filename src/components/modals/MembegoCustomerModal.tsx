import React, { useEffect, useId, useRef } from 'react';
import { X, Loader2, BadgeCheck, Gift, AlertCircle } from 'lucide-react';
import { formatCents } from '../../lib/money';
import { CustomerMembego } from '../../data/adminRepository';

/**
 * Ficha de beneficios de Membego de un cliente: membresías y promociones.
 *
 * Solo lectura: estos datos los escribe el webhook de Membego, no la interfaz.
 * Lo que se ve aquí es exactamente lo de ESTA empresa (RLS), nunca de otro
 * car wash.
 */
const MEMBERSHIP_TONE: Record<string, string> = {
  active: 'bg-emerald-500/20 text-emerald-300',
  paused: 'bg-amber-500/20 text-amber-300',
  cancelled: 'bg-rose-500/20 text-rose-300',
  expired: 'bg-slate-600/30 text-slate-400'
};
const PROMO_TONE: Record<string, string> = {
  available: 'bg-emerald-500/20 text-emerald-300',
  redeemed: 'bg-indigo-500/20 text-indigo-300',
  expired: 'bg-slate-600/30 text-slate-400',
  cancelled: 'bg-rose-500/20 text-rose-300'
};

export const MembegoCustomerModal: React.FC<{
  customerName: string;
  tier: string | null;
  data: CustomerMembego | null;
  loading: boolean;
  error: string | null;
  symbol: string;
  onClose: () => void;
}> = ({ customerName, tier, data, loading, error, symbol, onClose }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nothing = !loading && !error &&
    (data?.memberships.length ?? 0) === 0 && (data?.promotions.length ?? 0) === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col focus:outline-none">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div>
            <h2 id={titleId} className="font-bold text-white text-sm flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-amber-400" /> Beneficios Membego
            </h2>
            <p className="text-[11px] text-slate-400">
              {customerName}{tier && <> · <span className="text-amber-300 font-semibold">{tier}</span></>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 text-xs py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando beneficios…
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" /> {error}
            </div>
          )}

          {nothing && (
            <p className="text-center text-xs text-slate-500 italic py-6">
              Este cliente todavía no tiene membresías ni promociones de Membego.
            </p>
          )}

          {!loading && !error && (data?.memberships.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">Membresías</h3>
              {data!.memberships.map(m => (
                <div key={m.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white text-sm">{m.plan_name || 'Membresía'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${MEMBERSHIP_TONE[m.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {m.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                    {m.tier && <span>Nivel {m.tier}</span>}
                    <span>{m.is_paid ? 'De pago' : 'Gratuita'}</span>
                    {m.valid_until && <span>Vence {new Date(m.valid_until).toLocaleDateString('es-DO')}</span>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {!loading && !error && (data?.promotions.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5" /> Promociones y ofertas
              </h3>
              {data!.promotions.map(p => (
                <div key={p.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white text-sm">{p.title || 'Oferta'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${PROMO_TONE[p.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                    <span className={p.kind === 'paid' ? 'text-indigo-300' : 'text-emerald-300'}>
                      {p.kind === 'paid' ? 'De pago' : 'Gratis'}
                    </span>
                    {p.code && <span className="font-mono">{p.code}</span>}
                    {p.value_cents > 0 && <span>{formatCents(p.value_cents, symbol)}</span>}
                    {p.expires_at && <span>Vence {new Date(p.expires_at).toLocaleDateString('es-DO')}</span>}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
