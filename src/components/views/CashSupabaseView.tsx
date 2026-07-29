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
        <div className="h-8 w-64 bg-slate-800/60 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-72 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          <div className="h-72 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div role="alert" className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> No se pudo cargar la caja
          </div>
          <p className="text-xs text-slate-300">{loadError}</p>
          <button onClick={() => void load()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2">
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
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-400" /> Control de Caja
          </h2>
          <p className="text-xs text-slate-400">{branch?.name}</p>
        </div>
        <div className={`px-3 py-1 rounded-xl text-xs font-bold border ${
          session
            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
        }`}>
          {session ? 'Caja abierta' : 'Caja cerrada'}
        </div>
      </div>

      {!allowed && (
        <div role="status" className="bg-amber-950/40 border border-amber-500/40 rounded-xl px-4 py-3 text-xs text-amber-200">
          Su rol no permite operar la caja. Puede consultar, pero no abrir ni cerrar turnos.
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {!session ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md mx-auto space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-indigo-600/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-indigo-500/30">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-base">Apertura de turno</h3>
            <p className="text-xs text-slate-400">Cuente el fondo de cambio antes de empezar</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase">Cajero</span>
              <p className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 font-bold">
                {profile?.full_name}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="cash-open" className="text-xs font-semibold text-slate-400 uppercase">
                Fondo inicial ({symbol})
              </label>
              <input
                id="cash-open" type="text" inputMode="decimal"
                value={openingInput} onChange={e => setOpeningInput(e.target.value)}
                placeholder="0.00" disabled={!allowed || busy}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm font-bold text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
            <button
              onClick={() => void handleOpen()}
              disabled={!allowed || busy}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Abrir caja
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Resumen */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
              Sesión en curso
            </h3>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <dt>Abierta por</dt><dd className="font-bold text-white">{session.cashier_id === profile?.id ? profile?.full_name : '—'}</dd>
              </div>
              <div className="flex justify-between text-slate-400">
                <dt>Hora de apertura</dt>
                <dd>{new Date(session.opened_at).toLocaleString('es-DO')}</dd>
              </div>
              <div className="flex justify-between text-slate-400">
                <dt>Fondo inicial</dt>
                <dd className="font-bold text-white">{formatCents(session.initial_amount_cents, symbol)}</dd>
              </div>

              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex justify-between text-emerald-400">
                  <dt>Ventas en efectivo</dt><dd className="font-bold">{formatCents(session.total_cash_sales_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-indigo-400">
                  <dt>Tarjeta</dt><dd className="font-bold">{formatCents(session.total_card_sales_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-indigo-400">
                  <dt>Transferencia</dt><dd className="font-bold">{formatCents(session.total_transfer_sales_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-purple-400">
                  <dt>Beneficios Membego</dt><dd className="font-bold">{formatCents(session.total_membego_cents, symbol)}</dd>
                </div>
                <div className="flex justify-between text-rose-400">
                  <dt>Salidas en efectivo</dt><dd className="font-bold">{formatCents(session.total_outflows_cents, symbol)}</dd>
                </div>
              </div>
            </dl>

            {/* El efectivo esperado permanece oculto: eso es lo que hace ciego al arqueo. */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300">Efectivo esperado</span>
                {revealExpected ? (
                  <span className="font-black text-emerald-400">{formatCents(session.expected_cash_cents, symbol)}</span>
                ) : (
                  <span className="font-mono text-slate-600 tracking-widest">••••••</span>
                )}
              </div>
              <button
                onClick={() => setRevealExpected(v => !v)}
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
              >
                <EyeOff className="w-3 h-3" />
                {revealExpected ? 'Ocultar' : 'Revelar (solo tras contar el efectivo)'}
              </button>
            </div>
          </div>

          {/* Arqueo y movimientos */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
                Arqueo ciego y cierre
              </h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cuente el efectivo físico y anótelo <strong>antes</strong> de revelar el esperado.
                Esa es la razón de ser del arqueo ciego.
              </p>

              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label htmlFor="cash-counted" className="font-semibold text-slate-400 uppercase">
                    Efectivo contado ({symbol})
                  </label>
                  <input
                    id="cash-counted" type="text" inputMode="decimal"
                    value={countedInput} onChange={e => setCountedInput(e.target.value)}
                    placeholder="0.00" disabled={!allowed || busy}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-base font-bold text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                </div>

                {difference !== null && revealExpected && (
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Diferencia</span>
                    <p className={`text-base font-black ${difference === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCents(difference, symbol)}
                      <span className="text-[11px] font-semibold ml-2">
                        {difference === 0 ? '(cuadra)' : difference > 0 ? '(sobrante)' : '(faltante)'}
                      </span>
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor="cash-notes" className="font-semibold text-slate-400 uppercase">Observaciones</label>
                  <textarea
                    id="cash-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                    disabled={!allowed || busy}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                </div>

                <button
                  onClick={() => void handleClose()}
                  disabled={!allowed || busy || countedCents === null}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Cerrar turno
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
                Entrada o salida de efectivo
              </h3>
              <div className="flex gap-2">
                {(['outflow', 'inflow'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setMovementType(t)}
                    aria-pressed={movementType === t}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-all flex items-center justify-center gap-1 ${
                      movementType === t
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
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
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600 disabled:opacity-50"
              />
              <input
                type="text" value={movementReason}
                onChange={e => setMovementReason(e.target.value)}
                placeholder="Motivo" disabled={!allowed || busy}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600 disabled:opacity-50"
              />
              <button
                onClick={() => void handleMovement()}
                disabled={!allowed || busy}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-200 font-bold text-xs rounded-lg transition-colors"
              >
                Registrar movimiento
              </button>
            </div>
          </div>

          {/* Movimientos */}
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">
              Movimientos del turno
            </h3>
            {movements.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">Sin movimientos todavía</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-3 font-semibold">HORA</th>
                      <th className="py-2 pr-3 font-semibold">CONCEPTO</th>
                      <th className="py-2 pr-3 font-semibold">MÉTODO</th>
                      <th className="py-2 text-right font-semibold">IMPORTE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {movements.map(m => (
                      <tr key={m.id}>
                        <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                          {new Date(m.created_at).toLocaleTimeString('es-DO')}
                        </td>
                        <td className="py-2 pr-3 text-slate-200">{m.reason}</td>
                        <td className="py-2 pr-3 text-slate-400 uppercase">{m.method}</td>
                        <td className={`py-2 text-right font-bold whitespace-nowrap ${
                          m.type === 'inflow' ? 'text-emerald-400' : 'text-rose-400'
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" /> Turnos anteriores
        </h3>
        {history.filter(h => h.status === 'closed').length === 0 ? (
          <p className="text-xs text-slate-500 italic py-4 text-center">Aún no hay turnos cerrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-3 font-semibold">APERTURA</th>
                  <th className="py-2 pr-3 font-semibold">CIERRE</th>
                  <th className="py-2 pr-3 font-semibold">ESPERADO</th>
                  <th className="py-2 pr-3 font-semibold">CONTADO</th>
                  <th className="py-2 text-right font-semibold">DIFERENCIA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.filter(h => h.status === 'closed').map(h => (
                  <tr key={h.id}>
                    <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                      {new Date(h.opened_at).toLocaleString('es-DO')}
                    </td>
                    <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                      {h.closed_at ? new Date(h.closed_at).toLocaleString('es-DO') : '—'}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{formatCents(h.expected_cash_cents, symbol)}</td>
                    <td className="py-2 pr-3 text-slate-300">
                      {h.counted_cash_cents !== null ? formatCents(h.counted_cash_cents, symbol) : '—'}
                    </td>
                    <td className={`py-2 text-right font-bold ${
                      (h.difference_cents ?? 0) === 0 ? 'text-emerald-400' : 'text-rose-400'
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
