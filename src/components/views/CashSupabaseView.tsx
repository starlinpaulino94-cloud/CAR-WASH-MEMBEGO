import React, { useCallback, useEffect, useState } from 'react';
import {
  CreditCard, Lock, Loader2, AlertCircle, RefreshCw, ArrowDownLeft,
  ArrowUpRight, History, EyeOff
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, parseAmountToCents } from '../../lib/money';
import {
  fetchOpenCashSession, fetchCashMovements, fetchCashSessionHistory,
  openCashSession, closeCashSession, registerCashMovement,
  CashSession, CashMovement
} from '../../data/billingRepository';

/**
 * Control de caja sobre Supabase.
 *
 * Cambios de fondo respecto a la versión auditada:
 *  - El arqueo es CIEGO de verdad: el efectivo esperado se oculta mientras se
 *    cuenta y el campo no viene pre-rellenado. La versión anterior mostraba la
 *    respuesta al lado y la escribía sola (§17.6), lo que eliminaba el control
 *    en lugar de aplicarlo.
 *  - El histórico de sesiones se conserva; antes se sobrescribía al abrir la
 *    siguiente, destruyendo el arqueo anterior.
 *  - Un descuadre negativo se muestra tal cual, sin recortarlo a cero.
 */
export const CashSupabaseView: React.FC = () => {
  const { profile, company, branch } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';

  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openingInput, setOpeningInput] = useState('');
  const [countedInput, setCountedInput] = useState('');
  const [notes, setNotes] = useState('');
  const [revealExpected, setRevealExpected] = useState(false);

  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementType, setMovementType] = useState<'inflow' | 'outflow'>('outflow');

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setLoadError(null);
    try {
      const current = await fetchOpenCashSession(branch.id);
      setSession(current);
      const [mv, hist] = await Promise.all([
        current ? fetchCashMovements(current.id) : Promise.resolve([]),
        fetchCashSessionHistory(branch.id)
      ]);
      setMovements(mv);
      setHistory(hist);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la caja');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const allowed = can(profile, 'operateCash');

  const handleOpen = async () => {
    if (busy || !branch || !company || !profile) return;
    const cents = parseAmountToCents(openingInput);
    if (cents === null || cents < 0) {
      setActionError('Introduzca un fondo inicial válido.');
      return;
    }
    setBusy(true); setActionError(null);
    try {
      await openCashSession({
        companyId: company.id, branchId: branch.id, cashierId: profile.id,
        initialAmountCents: cents, notes: notes.trim() || undefined
      });
      setOpeningInput(''); setNotes('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo abrir la caja');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (busy || !session) return;
    const cents = parseAmountToCents(countedInput);
    if (cents === null || cents < 0) {
      setActionError('Introduzca el efectivo contado.');
      return;
    }
    setBusy(true); setActionError(null);
    try {
      await closeCashSession({
        sessionId: session.id,
        countedCashCents: cents,
        expectedCashCents: session.expected_cash_cents,
        notes: notes.trim() || undefined
      });
      setCountedInput(''); setNotes(''); setRevealExpected(false);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo cerrar la caja');
    } finally {
      setBusy(false);
    }
  };

  const handleMovement = async () => {
    if (busy || !session || !company) return;
    const cents = parseAmountToCents(movementAmount);
    if (cents === null || cents <= 0) {
      setActionError('Introduzca un importe mayor que cero.');
      return;
    }
    if (!movementReason.trim()) {
      setActionError('Indique el motivo del movimiento.');
      return;
    }
    setBusy(true); setActionError(null);
    try {
      await registerCashMovement({
        companyId: company.id, sessionId: session.id, type: movementType,
        method: 'efectivo', amountCents: cents, reason: movementReason.trim()
      });
      setMovementAmount(''); setMovementReason('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4" aria-busy="true">
        <div className="h-8 w-64 bg-surface-2/60 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-72 bg-surface border border-line rounded-2xl animate-pulse" />
          <div className="h-72 bg-surface border border-line rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-danger/40 border border-danger/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-danger font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar la caja
          </div>
          <p className="text-xs text-body">{loadError}</p>
          <button onClick={() => void load()} className="px-4 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  const countedCents = parseAmountToCents(countedInput);
  const difference = countedCents !== null && session
    ? countedCents - session.expected_cash_cents
    : null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h2 className="text-xl font-bold text-strong flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-brand" /> Control de Caja
          </h2>
          <p className="text-xs text-muted">{branch?.name}</p>
        </div>
        <div className={`px-3 py-1 rounded-xl text-xs font-bold border ${
          session
            ? 'bg-success/20 text-success border-success/30'
            : 'bg-danger/20 text-danger border-danger/30'
        }`}>
          {session ? 'Caja abierta' : 'Caja cerrada'}
        </div>
      </div>

      {!allowed && (
        <div role="status" className="bg-warning/40 border border-warning/40 rounded-xl px-4 py-3 text-xs text-warning">
          Su rol no permite operar la caja. Puede consultar, pero no abrir ni cerrar turnos.
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-danger/50 border border-danger/40 rounded-xl text-xs text-danger">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {!session ? (
        <div className="bg-surface border border-line rounded-2xl p-6 max-w-md mx-auto space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-brand/20 text-brand rounded-2xl flex items-center justify-center mx-auto mb-2 border border-brand/30">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-strong text-base">Apertura de turno</h3>
            <p className="text-xs text-muted">Cuente el fondo de cambio antes de empezar</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted uppercase">Cajero</span>
              <p className="w-full bg-canvas border border-line rounded-xl p-3 text-xs text-body font-bold">
                {profile?.full_name}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="cash-open" className="text-xs font-semibold text-muted uppercase">
                Fondo inicial ({symbol})
              </label>
              <input
                id="cash-open" type="text" inputMode="decimal"
                value={openingInput} onChange={e => setOpeningInput(e.target.value)}
                placeholder="0.00" disabled={!allowed || busy}
                className="w-full bg-canvas border border-line rounded-xl p-3 text-sm font-bold text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50"
              />
            </div>
            <button
              onClick={() => void handleOpen()}
              disabled={!allowed || busy}
              className="w-full py-3 bg-brand hover:bg-brand disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-brand/30 transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Abrir caja
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Resumen */}
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
              Sesión en curso
            </h3>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between text-muted">
                <dt>Abierta por</dt><dd className="font-bold text-strong">{session.cashier_id === profile?.id ? profile?.full_name : '—'}</dd>
              </div>
              <div className="flex justify-between text-muted">
                <dt>Hora de apertura</dt>
                <dd>{new Date(session.opened_at).toLocaleString('es-DO')}</dd>
              </div>
              <div className="flex justify-between text-muted">
                <dt>Fondo inicial</dt>
                <dd className="font-bold text-strong">{formatCents(session.initial_amount_cents, symbol)}</dd>
              </div>

              <div className="pt-2 border-t border-line space-y-1.5">
                <div className="flex justify-between text-success">
                  <dt>Ventas en efectivo</dt><dd className="font-bold">{formatCents(session.total_cash_sales_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-brand">
                  <dt>Tarjeta</dt><dd className="font-bold">{formatCents(session.total_card_sales_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-brand">
                  <dt>Transferencia</dt><dd className="font-bold">{formatCents(session.total_transfer_sales_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-accent">
                  <dt>Beneficios Membego</dt><dd className="font-bold">{formatCents(session.total_membego_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-danger">
                  <dt>Salidas en efectivo</dt><dd className="font-bold">{formatCents(session.total_outflows_cents, symbol)}</dd>
                </div>
              </div>
            </dl>

            {/* El efectivo esperado permanece oculto: eso es lo que hace ciego al arqueo. */}
            <div className="p-3 bg-canvas rounded-xl border border-line space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-body">Efectivo esperado</span>
                {revealExpected ? (
                  <span className="font-black text-success">{formatCents(session.expected_cash_cents, symbol)}</span>
                ) : (
                  <span className="font-mono text-faint tracking-widest">••••••</span>
                )}
              </div>
              <button
                onClick={() => setRevealExpected(v => !v)}
                className="text-xs text-faint hover:text-body flex items-center gap-1"
              >
                <EyeOff className="w-3 h-3" />
                {revealExpected ? 'Ocultar' : 'Revelar (solo tras contar el efectivo)'}
              </button>
            </div>
          </div>

          {/* Arqueo y movimientos */}
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
                Arqueo ciego y cierre
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                Cuente el efectivo físico y anótelo <strong>antes</strong> de revelar el esperado.
                Esa es la razón de ser del arqueo ciego.
              </p>

              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label htmlFor="cash-counted" className="font-semibold text-muted uppercase">
                    Efectivo contado ({symbol})
                  </label>
                  <input
                    id="cash-counted" type="text" inputMode="decimal"
                    value={countedInput} onChange={e => setCountedInput(e.target.value)}
                    placeholder="0.00" disabled={!allowed || busy}
                    className="w-full bg-canvas border border-line rounded-xl p-3 text-base font-bold text-strong placeholder-faint focus:outline-none focus:border-brand disabled:opacity-50"
                  />
                </div>

                {difference !== null && revealExpected && (
                  <div className="p-3 bg-canvas rounded-xl border border-line space-y-1">
                    <span className="text-xs text-muted uppercase font-semibold">Diferencia</span>
                    <p className={`text-base font-black ${difference === 0 ? 'text-success' : 'text-danger'}`}>
                      {formatCents(difference, symbol)}
                      <span className="text-xs font-semibold ml-2">
                        {difference === 0 ? '(cuadra)' : difference > 0 ? '(sobrante)' : '(faltante)'}
                      </span>
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor="cash-notes" className="font-semibold text-muted uppercase">Observaciones</label>
                  <textarea
                    id="cash-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                    disabled={!allowed || busy}
                    className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-strong focus:outline-none focus:border-brand disabled:opacity-50"
                  />
                </div>

                <button
                  onClick={() => void handleClose()}
                  disabled={!allowed || busy || countedCents === null}
                  className="w-full py-3 bg-danger hover:bg-danger disabled:bg-surface-2 disabled:text-faint text-on-accent font-bold text-xs rounded-xl shadow-lg shadow-danger/30 transition-all flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Cerrar turno
                </button>
              </div>
            </div>

            <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
                Entrada o salida de efectivo
              </h3>
              <div className="flex gap-2">
                {(['outflow', 'inflow'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setMovementType(t)}
                    aria-pressed={movementType === t}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 ${
                      movementType === t
                        ? 'bg-brand text-on-accent border-brand'
                        : 'bg-canvas text-muted border-line'
                    }`}
                  >
                    {t === 'outflow' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                    {t === 'outflow' ? 'Salida' : 'Entrada'}
                  </button>
                ))}
              </div>
              <input
                type="text" inputMode="decimal" value={movementAmount}
                onChange={e => setMovementAmount(e.target.value)}
                placeholder={`Importe (${symbol})`} disabled={!allowed || busy}
                className="w-full bg-canvas border border-line rounded-lg p-2 text-xs text-strong placeholder-faint disabled:opacity-50"
              />
              <input
                type="text" value={movementReason}
                onChange={e => setMovementReason(e.target.value)}
                placeholder="Motivo" disabled={!allowed || busy}
                className="w-full bg-canvas border border-line rounded-lg p-2 text-xs text-strong placeholder-faint disabled:opacity-50"
              />
              <button
                onClick={() => void handleMovement()}
                disabled={!allowed || busy}
                className="w-full py-2 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 border border-line-strong text-body font-bold text-xs rounded-lg transition-colors"
              >
                Registrar movimiento
              </button>
            </div>
          </div>

          {/* Movimientos */}
          <div className="md:col-span-2 bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="font-bold text-strong text-sm border-b border-line pb-2">
              Movimientos del turno
            </h3>
            {movements.length === 0 ? (
              <p className="text-xs text-faint italic py-4 text-center">Sin movimientos todavía</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted border-b border-line">
                      <th className="py-2 pr-3 font-semibold">HORA</th>
                      <th className="py-2 pr-3 font-semibold">CONCEPTO</th>
                      <th className="py-2 pr-3 font-semibold">MÉTODO</th>
                      <th className="py-2 text-right font-semibold">IMPORTE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {movements.map(m => (
                      <tr key={m.id}>
                        <td className="py-2 pr-3 text-muted whitespace-nowrap">
                          {new Date(m.created_at).toLocaleTimeString('es-DO')}
                        </td>
                        <td className="py-2 pr-3 text-body">{m.reason}</td>
                        <td className="py-2 pr-3 text-muted uppercase">{m.method}</td>
                        <td className={`py-2 text-right font-bold whitespace-nowrap ${
                          m.type === 'inflow' ? 'text-success' : 'text-danger'
                        }`}>
                          {m.type === 'inflow' ? '+' : '−'}{formatCents(m.amount_cents, symbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Histórico: existe porque las sesiones ya no se sobrescriben */}
      <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
          <History className="w-4 h-4 text-brand" /> Turnos anteriores
        </h3>
        {history.filter(h => h.status === 'closed').length === 0 ? (
          <p className="text-xs text-faint italic py-4 text-center">Aún no hay turnos cerrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted border-b border-line">
                  <th className="py-2 pr-3 font-semibold">APERTURA</th>
                  <th className="py-2 pr-3 font-semibold">CIERRE</th>
                  <th className="py-2 pr-3 font-semibold">ESPERADO</th>
                  <th className="py-2 pr-3 font-semibold">CONTADO</th>
                  <th className="py-2 text-right font-semibold">DIFERENCIA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {history.filter(h => h.status === 'closed').map(h => (
                  <tr key={h.id}>
                    <td className="py-2 pr-3 text-muted whitespace-nowrap">
                      {new Date(h.opened_at).toLocaleString('es-DO')}
                    </td>
                    <td className="py-2 pr-3 text-muted whitespace-nowrap">
                      {h.closed_at ? new Date(h.closed_at).toLocaleString('es-DO') : '—'}
                    </td>
                    <td className="py-2 pr-3 text-body">{formatCents(h.expected_cash_cents, symbol)}</td>
                    <td className="py-2 pr-3 text-body">
                      {h.counted_cash_cents !== null ? formatCents(h.counted_cash_cents, symbol) : '—'}
                    </td>
                    <td className={`py-2 text-right font-bold ${
                      (h.difference_cents ?? 0) === 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {h.difference_cents !== null ? formatCents(h.difference_cents, symbol) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
