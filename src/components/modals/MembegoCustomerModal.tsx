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
  active: 'bg-success/20 text-success',
  paused: 'bg-warning/20 text-warning',
  cancelled: 'bg-danger/20 text-danger',
  expired: 'bg-surface-3/30 text-muted'
};
const PROMO_TONE: Record<string, string> = {
  available: 'bg-success/20 text-success',
  redeemed: 'bg-brand/20 text-brand-hi',
  expired: 'bg-surface-3/30 text-muted',
  cancelled: 'bg-danger/20 text-danger'
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
        className="w-full max-w-lg bg-surface border border-line-strong rounded-2xl shadow-2xl max-h-[90vh] flex flex-col focus:outline-none">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 id={titleId} className="font-bold text-strong text-sm flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-warning" /> Beneficios Membego
            </h2>
            <p className="text-xs text-muted">
              {customerName}{tier && <> · <span className="text-warning font-semibold">{tier}</span></>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-strong">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 text-muted text-xs py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando beneficios…
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" /> {error}
            </div>
          )}

          {nothing && (
            <p className="text-center text-xs text-faint italic py-6">
              Este cliente todavía no tiene membresías ni promociones de Membego.
            </p>
          )}

          {!loading && !error && (data?.memberships.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-extrabold text-muted uppercase tracking-wider">Membresías</h3>
              {data!.memberships.map(m => (
                <div key={m.id} className="p-3 bg-canvas border border-line rounded-xl space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-strong text-sm">{m.plan_name || 'Membresía'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${MEMBERSHIP_TONE[m.status] ?? 'bg-surface-3 text-body'}`}>
                      {m.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
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
              <h3 className="text-xs font-extrabold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5" /> Promociones y ofertas
              </h3>
              {data!.promotions.map(p => (
                <div key={p.id} className="p-3 bg-canvas border border-line rounded-xl space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-strong text-sm">{p.title || 'Oferta'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${PROMO_TONE[p.status] ?? 'bg-surface-3 text-body'}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span className={p.kind === 'paid' ? 'text-brand-hi' : 'text-success'}>
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
