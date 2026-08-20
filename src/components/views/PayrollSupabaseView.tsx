import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Wallet, Plus, HandCoins, CheckCircle2, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCents, parseAmountToCents, centsToInput } from '../../lib/money';
import { fetchOpenCashSession } from '../../data/billingRepository';
import {
  fetchStaff, setEmployeePay, fetchPendingAdvances, registerAdvance,
  fetchPayrollPeriods, fetchPayrollItems, openPayrollPeriod, adjustPayrollItem,
  approvePayroll, payPayroll, deletePayrollPeriod,
  Profile, PayrollAdvance, PayrollPeriod, PayrollItemRow, PayrollType, PaymentMethod
} from '../../data/payrollRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, SkeletonRows, EmptyRow, StatCard
} from '../common/DataViewShell';
import { FormModal, Field, textInputClass } from '../common/FormModal';

const TIPOS: { id: PayrollType; label: string }[] = [
  { id: 'solo_comision', label: 'Solo comisión' },
  { id: 'mensual', label: 'Sueldo mensual' },
  { id: 'por_hora', label: 'Por hora' }
];

const METODOS: { id: PaymentMethod; label: string }[] = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'tarjeta', label: 'Tarjeta' }
];

const ESTADO: Record<string, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'bg-surface-3/50 text-body' },
  aprobada: { label: 'Aprobada', clase: 'bg-warning/20 text-warning' },
  pagada:   { label: 'Pagada',   clase: 'bg-success/20 text-success' }
};

const hoyIso = () => new Date().toISOString().slice(0, 10);
const haceDias = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const horas = (minutes: number) => `${Math.floor(minutes / 60)} h ${minutes % 60} min`;

/**
 * Nómina: borrador → aprobada → pagada.
 *
 * Abrir el periodo calcula la partida de cada empleado y AMARRA las comisiones
 * y los adelantos que recoge; a partir de ahí ninguna otra nómina puede
 * cogerlos. Pagarla es lo que por fin marca las comisiones como pagadas y saca
 * el dinero de la caja.
 */
export const PayrollSupabaseView: React.FC = () => {
  const { profile, phase, company, branch } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const canManage = ['propietario', 'administrador', 'contador', 'superadmin']
    .includes(profile?.role ?? '');
  const canApprove = ['propietario', 'administrador', 'superadmin'].includes(profile?.role ?? '');

  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selected, setSelected] = useState<PayrollPeriod | null>(null);
  const [items, setItems] = useState<PayrollItemRow[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [advances, setAdvances] = useState<PayrollAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = () => setNonce(n => n + 1);

  useEffect(() => {
    if (phase !== 'ready' || !canManage) { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchPayrollPeriods(), fetchStaff(), fetchPendingAdvances()])
      .then(([p, s, a]) => {
        setPeriods(p); setStaff(s); setAdvances(a);
        // Se mantiene la selección tras recargar, con los totales frescos.
        setSelected(prev => (prev ? p.find(x => x.id === prev.id) ?? null : null));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar la nómina'))
      .finally(() => setLoading(false));
  }, [phase, canManage, nonce]);

  useEffect(() => {
    if (!selected) { setItems([]); return; }
    fetchPayrollItems(selected.id).then(setItems).catch(() => setItems([]));
  }, [selected, nonce]);

  // --- Abrir periodo
  const [showOpen, setShowOpen] = useState(false);
  const [desde, setDesde] = useState(haceDias(14));
  const [hasta, setHasta] = useState(hoyIso());

  const abrir = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const p = await openPayrollPeriod({ from: desde, to: hasta, branchId: null });
      setShowOpen(false);
      setSelected(p);
      setNotice(`Nómina del ${desde} al ${hasta} calculada: neto ${formatCents(p.net_cents, symbol)}.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la nómina');
    } finally {
      setBusy(false);
    }
  };

  // --- Adelanto
  const [showAdvance, setShowAdvance] = useState(false);
  const [advProfile, setAdvProfile] = useState('');
  const [advAmount, setAdvAmount] = useState('');
  const [advReason, setAdvReason] = useState('');

  const darAdelanto = async () => {
    if (busy) return;
    const cents = parseAmountToCents(advAmount);
    if (!advProfile) { setError('Elija al empleado.'); return; }
    if (cents === null || cents <= 0) { setError('Indique un importe válido.'); return; }
    setBusy(true); setError(null);
    try {
      // El adelanto sale de la gaveta: si hay caja abierta se registra allí y el
      // arqueo de la noche cuadra solo.
      const session = branch ? await fetchOpenCashSession(branch.id).catch(() => null) : null;
      await registerAdvance({
        profileId: advProfile, amountCents: cents,
        reason: advReason.trim() || null, cashSessionId: session?.id ?? null
      });
      setShowAdvance(false); setAdvAmount(''); setAdvReason('');
      setNotice(session
        ? 'Adelanto entregado y descontado de la caja.'
        : 'Adelanto registrado. Sin caja abierta, no se descontó de la gaveta.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el adelanto');
    } finally {
      setBusy(false);
    }
  };

  // --- Sueldo
  const [payTarget, setPayTarget] = useState<Profile | null>(null);
  const [payType, setPayType] = useState<PayrollType>('solo_comision');
  const [payBase, setPayBase] = useState('');
  const [payHour, setPayHour] = useState('');

  const openPay = (p: Profile) => {
    setPayTarget(p);
    setPayType(p.payroll_type);
    setPayBase(p.base_salary_cents > 0 ? centsToInput(p.base_salary_cents) : '');
    setPayHour(p.hourly_rate_cents > 0 ? centsToInput(p.hourly_rate_cents) : '');
    setError(null);
  };

  const guardarSueldo = async () => {
    if (!payTarget || busy) return;
    setBusy(true); setError(null);
    try {
      await setEmployeePay({
        profileId: payTarget.id,
        payrollType: payType,
        baseSalaryCents: parseAmountToCents(payBase) ?? 0,
        hourlyRateCents: parseAmountToCents(payHour) ?? 0
      });
      setPayTarget(null);
      setNotice(`Sueldo de ${payTarget.full_name} actualizado.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo fijar el sueldo');
    } finally {
      setBusy(false);
    }
  };

  // --- Ajuste de partida
  const [adjItem, setAdjItem] = useState<PayrollItemRow | null>(null);
  const [bonus, setBonus] = useState('');
  const [deduc, setDeduc] = useState('');

  const openAdjust = (it: PayrollItemRow) => {
    setAdjItem(it);
    setBonus(it.bonus_cents > 0 ? centsToInput(it.bonus_cents) : '');
    setDeduc(it.deductions_cents > 0 ? centsToInput(it.deductions_cents) : '');
    setError(null);
  };

  const guardarAjuste = async () => {
    if (!adjItem || busy) return;
    setBusy(true); setError(null);
    try {
      await adjustPayrollItem({
        itemId: adjItem.id,
        bonusCents: parseAmountToCents(bonus) ?? 0,
        deductionsCents: parseAmountToCents(deduc) ?? 0
      });
      setAdjItem(null);
      setNotice('Partida ajustada.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ajustar la partida');
    } finally {
      setBusy(false);
    }
  };

  // --- Aprobar y pagar
  const aprobar = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      const p = await approvePayroll(selected.id);
      setSelected(p);
      setNotice('Nómina aprobada. Ya no admite ajustes.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aprobar la nómina');
    } finally {
      setBusy(false);
    }
  };

  const [showPay, setShowPay] = useState(false);
  const [metodo, setMetodo] = useState<PaymentMethod>('efectivo');

  const pagar = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      let sessionId: string | null = null;
      if (metodo === 'efectivo') {
        if (!branch) { setError('No hay sucursal activa para registrar el efectivo.'); return; }
        const session = await fetchOpenCashSession(branch.id);
        if (!session) { setError('Abra la caja antes de pagar la nómina en efectivo.'); return; }
        sessionId = session.id;
      }
      const p = await payPayroll({ periodId: selected.id, method: metodo, cashSessionId: sessionId });
      setSelected(p); setShowPay(false);
      setNotice(`Nómina pagada: ${formatCents(p.net_cents, symbol)}. Las comisiones quedaron saldadas.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo pagar la nómina');
    } finally {
      setBusy(false);
    }
  };

  const descartar = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      await deletePayrollPeriod(selected.id);
      setSelected(null);
      setNotice('Borrador descartado. Comisiones y adelantos vuelven a quedar libres.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar el borrador');
    } finally {
      setBusy(false);
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Nómina" subtitle="Sueldos, comisiones y adelantos" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Nómina" subtitle="Sueldos, comisiones y adelantos" />
        <ReadOnlyNotice>
          La nómina completa solo la ve quien la firma: propiedad, administración o contabilidad.
        </ReadOnlyNotice>
      </div>
    );
  }

  if (error && periods.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={reload} title="No se pudo cargar la nómina" />;
  }

  const editable = selected?.status === 'borrador';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        title="Nómina"
        subtitle="Sueldo, horas, comisiones y adelantos en un solo neto"
        actions={
          <div className="flex gap-2">
            <button onClick={() => setShowAdvance(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 text-body font-bold text-xs rounded-xl">
              <HandCoins className="w-4 h-4" /> Dar adelanto
            </button>
            <Button size="sm" onClick={() => setShowOpen(true)}
              >
              <Plus className="w-4 h-4" /> Abrir nómina
            </Button>
          </div>
        }
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && !showOpen && !showAdvance && !payTarget && !adjItem && (
        <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>
      )}

      {advances.length > 0 && (
        <InlineAlert tone="warning">
          Hay {advances.length} adelanto(s) pendiente(s) por{' '}
          {formatCents(advances.reduce((s, a) => s + a.amount_cents, 0), symbol)}.
          Se descontarán en la próxima nómina que se abra.
        </InlineAlert>
      )}

      {/* ------------------------------------------------------ Periodos */}
      <div className="bg-surface/80 border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="text-xs">
            <caption className="sr-only">Nóminas</caption>
            <TableHeader>
              <TableRow className="border-b border-line text-muted bg-canvas/50">
                <TableHead scope="col" className="p-3 font-semibold">PERIODO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">BRUTO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">DEDUCCIONES</TableHead>
                <TableHead scope="col" className="p-3 font-semibold text-right">NETO</TableHead>
                <TableHead scope="col" className="p-3 font-semibold">ESTADO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <SkeletonRows cols={5} />
                : periods.length === 0 ? (
                  <EmptyRow cols={5}>Todavía no se ha calculado ninguna nómina.</EmptyRow>
                ) : periods.map(p => (
                  <TableRow key={p.id}
                    className={`hover:bg-surface-2/40 ${selected?.id === p.id ? 'bg-surface-2/60' : ''}`}>
                    <TableCell className="p-3">
                      <button onClick={() => setSelected(p)}
                        className="font-bold text-strong hover:text-brand-hi tabular-nums">
                        {p.period_from} — {p.period_to}
                      </button>
                    </TableCell>
                    <TableCell className="p-3 text-right text-body tabular-nums">
                      {formatCents(p.gross_cents, symbol)}
                    </TableCell>
                    <TableCell className="p-3 text-right text-muted tabular-nums">
                      −{formatCents(p.deductions_cents, symbol)}
                    </TableCell>
                    <TableCell className="p-3 text-right font-bold text-strong tabular-nums">
                      {formatCents(p.net_cents, symbol)}
                    </TableCell>
                    <TableCell className="p-3">
                      <span className={`font-bold px-2 py-0.5 rounded text-xs ${ESTADO[p.status].clase}`}>
                        {ESTADO[p.status].label}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* -------------------------------------------------- Detalle */}
      {selected && (
        <section aria-label="Detalle de la nómina"
          className="bg-surface/80 border border-line rounded-2xl p-5 space-y-4">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-strong tabular-nums">
                {selected.period_from} — {selected.period_to}
              </h2>
              <p className="text-xs text-faint">
                {ESTADO[selected.status].label}
                {selected.paid_at && ` · pagada el ${new Date(selected.paid_at).toLocaleDateString('es-DO')}`}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setSelected(null)} aria-label="Cerrar detalle"
              >
              <X className="w-4 h-4" />
            </Button>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Bruto" value={formatCents(selected.gross_cents, symbol)} />
            <StatCard label="Deducciones" value={formatCents(selected.deductions_cents, symbol)}
              tone="text-warning" hint="Adelantos y descuentos" />
            <StatCard label="Neto a entregar" value={formatCents(selected.net_cents, symbol)} />
          </div>

          {canApprove && selected.status === 'borrador' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="bg-success hover:bg-success/90 text-on-accent" onClick={() => void aprobar()} disabled={busy}
                >
                <CheckCircle2 className="w-4 h-4" /> Aprobar nómina
              </Button>
              <button onClick={() => void descartar()} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 text-body font-bold text-xs rounded-xl disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> Descartar borrador
              </button>
            </div>
          )}
          {canApprove && selected.status === 'aprobada' && (
            <Button size="sm" className="bg-success hover:bg-success/90 text-on-accent" onClick={() => setShowPay(true)} disabled={busy}
              >
              <Wallet className="w-4 h-4" /> Pagar {formatCents(selected.net_cents, symbol)}
            </Button>
          )}

          <div className="overflow-x-auto">
            <Table className="text-xs">
              <caption className="sr-only">Partidas de la nómina</caption>
              <TableHeader>
                <TableRow className="border-b border-line text-muted">
                  <TableHead scope="col" className="p-2 font-semibold">EMPLEADO</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">BASE</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">HORAS</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">COMISIONES</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">BONO</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">ADELANTOS</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">DESCUENTOS</TableHead>
                  <TableHead scope="col" className="p-2 font-semibold text-right">NETO</TableHead>
                  {editable && <TableHead scope="col" className="p-2 font-semibold" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(it => (
                  <TableRow key={it.id} className="hover:bg-surface-2/40">
                    <TableCell className="p-2 font-bold text-strong">{it.full_name}</TableCell>
                    <TableCell className="p-2 text-right text-body tabular-nums">
                      {formatCents(it.base_cents, symbol)}
                    </TableCell>
                    <TableCell className="p-2 text-right text-muted tabular-nums">
                      {it.payroll_type === 'por_hora' ? horas(it.worked_minutes) : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right text-body tabular-nums">
                      {formatCents(it.commissions_cents, symbol)}
                    </TableCell>
                    <TableCell className="p-2 text-right text-success tabular-nums">
                      {it.bonus_cents > 0 ? formatCents(it.bonus_cents, symbol) : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right text-warning tabular-nums">
                      {it.advances_cents > 0 ? `−${formatCents(it.advances_cents, symbol)}` : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right text-warning tabular-nums">
                      {it.deductions_cents > 0 ? `−${formatCents(it.deductions_cents, symbol)}` : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right font-bold text-strong tabular-nums">
                      {formatCents(it.net_cents, symbol)}
                    </TableCell>
                    {editable && (
                      <TableCell className="p-2 text-right">
                        <Button variant="secondary" size="xs" onClick={() => openAdjust(it)}
                          >
                          Ajustar
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* -------------------------------------------------- Sueldos */}
      <section aria-label="Sueldos del equipo"
        className="bg-surface/80 border border-line rounded-2xl p-5 space-y-3">
        <h2 className="text-base font-bold text-strong">Sueldos del equipo</h2>
        <p className="text-xs text-faint">
          El sueldo solo se cambia aquí: un UPDATE directo sobre la ficha lo rechaza
          la base. Es lo que impide que alguien se suba su propia comisión.
        </p>
        <ul className="divide-y divide-line/60">
          {staff.map(p => (
            <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-strong text-sm">{p.full_name}</div>
                <div className="text-xs text-faint">
                  {TIPOS.find(t => t.id === p.payroll_type)?.label}
                  {p.payroll_type === 'mensual' && ` · ${formatCents(p.base_salary_cents, symbol)} al mes`}
                  {p.payroll_type === 'por_hora' && ` · ${formatCents(p.hourly_rate_cents, symbol)} la hora`}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => openPay(p)}
                >
                Fijar sueldo
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------- Modales */}
      {showOpen && (
        <FormModal
          title="Abrir nómina"
          submitLabel="Calcular"
          busy={busy}
          error={error}
          onSubmit={() => void abrir()}
          onClose={() => setShowOpen(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Desde" htmlFor="nom-desde">
            <input id="nom-desde" type="date" className={textInputClass} value={desde}
              onChange={e => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta" htmlFor="nom-hasta">
            <input id="nom-hasta" type="date" className={textInputClass} value={hasta}
              onChange={e => setHasta(e.target.value)} />
          </Field>
          <p className="text-xs text-faint">
            El sueldo mensual se prorratea sobre 30 días; el pago por hora sale de
            los minutos realmente marcados. Las comisiones y los adelantos que
            entren aquí quedan amarrados a esta nómina.
          </p>
        </FormModal>
      )}

      {showAdvance && (
        <FormModal
          title="Dar adelanto"
          submitLabel="Entregar adelanto"
          busy={busy}
          error={error}
          onSubmit={() => void darAdelanto()}
          onClose={() => setShowAdvance(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Empleado" htmlFor="adv-profile">
            <select id="adv-profile" className={textInputClass} value={advProfile}
              onChange={e => setAdvProfile(e.target.value)}>
              <option value="">Elija al empleado…</option>
              {staff.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field label="Importe" htmlFor="adv-amount">
            <input id="adv-amount" className={textInputClass} value={advAmount}
              inputMode="decimal" onChange={e => setAdvAmount(e.target.value)} />
          </Field>
          <Field label="Motivo" htmlFor="adv-reason">
            <input id="adv-reason" className={textInputClass} value={advReason}
              onChange={e => setAdvReason(e.target.value)} placeholder="Adelanto de quincena…" />
          </Field>
          <p className="text-xs text-faint">
            Sale de la caja abierta y se descuenta en la próxima nómina.
          </p>
        </FormModal>
      )}

      {payTarget && (
        <FormModal
          title={`Sueldo — ${payTarget.full_name}`}
          submitLabel="Guardar sueldo"
          busy={busy}
          error={error}
          onSubmit={() => void guardarSueldo()}
          onClose={() => setPayTarget(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Modalidad" htmlFor="pay-type">
            <select id="pay-type" className={textInputClass} value={payType}
              onChange={e => setPayType(e.target.value as PayrollType)}>
              {TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          {payType === 'mensual' && (
            <Field label="Sueldo mensual" htmlFor="pay-base">
              <input id="pay-base" className={textInputClass} value={payBase}
                inputMode="decimal" onChange={e => setPayBase(e.target.value)} />
            </Field>
          )}
          {payType === 'por_hora' && (
            <Field label="Tarifa por hora" htmlFor="pay-hour">
              <input id="pay-hour" className={textInputClass} value={payHour}
                inputMode="decimal" onChange={e => setPayHour(e.target.value)} />
            </Field>
          )}
          <p className="text-xs text-faint">
            La comisión por servicio se configura en el catálogo y en la ficha del
            empleado; esto fija la parte fija de su pago.
          </p>
        </FormModal>
      )}

      {adjItem && (
        <FormModal
          title={`Ajustar — ${adjItem.full_name}`}
          submitLabel="Guardar ajuste"
          busy={busy}
          error={error}
          onSubmit={() => void guardarAjuste()}
          onClose={() => setAdjItem(null)}
          onDismissError={() => setError(null)}
        >
          <Field label="Bono" htmlFor="adj-bonus">
            <input id="adj-bonus" className={textInputClass} value={bonus}
              inputMode="decimal" onChange={e => setBonus(e.target.value)} />
          </Field>
          <Field label="Descuento" htmlFor="adj-deduc">
            <input id="adj-deduc" className={textInputClass} value={deduc}
              inputMode="decimal" onChange={e => setDeduc(e.target.value)} />
          </Field>
          <p className="text-xs text-faint">
            Solo se ajusta mientras la nómina está en borrador. Una vez aprobada,
            los números quedan congelados.
          </p>
        </FormModal>
      )}

      {showPay && selected && (
        <FormModal
          title="Pagar nómina"
          submitLabel={`Pagar ${formatCents(selected.net_cents, symbol)}`}
          busy={busy}
          error={error}
          onSubmit={() => void pagar()}
          onClose={() => setShowPay(false)}
          onDismissError={() => setError(null)}
        >
          <Field label="Forma de pago" htmlFor="pay-method">
            <select id="pay-method" className={textInputClass} value={metodo}
              onChange={e => setMetodo(e.target.value as PaymentMethod)}>
              {METODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <p className="text-xs text-faint">
            En efectivo se registra una salida de caja por empleado, para que el
            arqueo se pueda explicar sobre el recibo que firmó cada quien. Al pagar,
            las comisiones recogidas quedan saldadas.
          </p>
        </FormModal>
      )}
    </div>
  );
};
