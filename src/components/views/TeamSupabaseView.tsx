import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { formatCents, bpsToPercent } from '../../lib/money';
import {
  fetchTeam, fetchCommissionSummary, Profile, CommissionSummary
} from '../../data/adminRepository';
import {
  ViewHeader, ErrorState, StatCard, FilterChips, ReadOnlyNotice
} from '../common/DataViewShell';

type RangeId = 'month' | 'week' | 'all';

const RANGES: { id: RangeId; label: string }[] = [
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'all', label: 'Últimos 12 meses' }
];

function bounds(id: RangeId): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(now);
  if (id === 'week') return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to };
  if (id === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  return { from: iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())), to };
}

/**
 * Equipo y comisiones.
 *
 * Las comisiones son datos de nómina: RLS solo las muestra al mando y a cada
 * operario las suyas. Esta vista respeta lo mismo — un operario ve su fila y
 * nada más.
 */
export const TeamSupabaseView: React.FC = () => {
  const { company, profile } = useAuth();
  const symbol = company?.currency_symbol ?? 'RD$';
  const seesAll = can(profile, 'viewAllCommissions');

  const [range, setRange] = useState<RangeId>('month');
  const [team, setTeam] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Map<string, CommissionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => bounds(range), [range]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [people, commissions] = await Promise.all([
        fetchTeam(),
        fetchCommissionSummary(period.from, period.to)
      ]);
      setTeam(people);
      setSummary(commissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el equipo');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    let total = 0, unpaid = 0;
    for (const s of summary.values()) { total += s.totalCents; unpaid += s.unpaidCents; }
    return { total, unpaid };
  }, [summary]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} title="No se pudo cargar el equipo" />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ViewHeader
        icon={<Briefcase className="w-5 h-5 text-indigo-400" />}
        title="Equipo y comisiones"
        subtitle="Personal de la sucursal y comisiones generadas al entregar"
        actions={<FilterChips options={RANGES} value={range} onChange={setRange} />}
      />

      {!seesAll && (
        <ReadOnlyNotice>
          Su rol solo permite ver sus propias comisiones. Las de sus compañeros están
          restringidas por la base de datos, no solo por esta pantalla.
        </ReadOnlyNotice>
      )}

      {seesAll && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Comisiones del periodo" value={formatCents(totals.total, symbol)} tone="text-indigo-400" />
          <StatCard label="Pendientes de pago" value={formatCents(totals.unpaid, symbol)}
            tone={totals.unpaid > 0 ? 'text-amber-400' : 'text-slate-500'} />
          <StatCard label="Personal activo" value={String(team.filter(t => t.is_active).length)} />
        </div>
      )}

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Personal y comisiones</caption>
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th scope="col" className="p-3 font-semibold">PERSONA</th>
                <th scope="col" className="p-3 font-semibold">ROL</th>
                <th scope="col" className="p-3 font-semibold text-right">TASA</th>
                <th scope="col" className="p-3 font-semibold text-right">SERVICIOS</th>
                <th scope="col" className="p-3 font-semibold text-right">COMISIÓN</th>
                <th scope="col" className="p-3 font-semibold text-right">POR PAGAR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} aria-hidden="true">
                    <td colSpan={6} className="p-3"><div className="h-5 bg-slate-800/60 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : team.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center text-slate-500 italic">
                  No hay personal registrado.
                </td></tr>
              ) : team.map(person => {
                const s = summary.get(person.id);
                return (
                  <tr key={person.id} className={`hover:bg-slate-800/40 ${person.is_active ? '' : 'opacity-50'}`}>
                    <td className="p-3">
                      <div className="font-bold text-white">{person.full_name || person.email}</div>
                      <div className="text-[10px] text-slate-500">{person.email}</div>
                    </td>
                    <td className="p-3">
                      <span className="bg-indigo-950 text-indigo-300 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                        {person.role ?? 'sin rol'}
                      </span>
                      {!person.is_active && <span className="ml-1 text-[10px] text-slate-500">inactivo</span>}
                    </td>
                    <td className="p-3 text-right text-emerald-400 font-bold">
                      {person.commission_bps ? bpsToPercent(person.commission_bps) : '—'}
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">{s?.count ?? 0}</td>
                    <td className="p-3 text-right font-bold text-indigo-300 whitespace-nowrap">
                      {formatCents(s?.totalCents ?? 0, symbol)}
                    </td>
                    <td className={`p-3 text-right font-bold whitespace-nowrap ${
                      (s?.unpaidCents ?? 0) > 0 ? 'text-amber-400' : 'text-slate-600'
                    }`}>
                      {formatCents(s?.unpaidCents ?? 0, symbol)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        Las comisiones se generan al entregar el vehículo, repartiendo cada servicio entre
        los operarios asignados con la tasa de cada uno.
      </p>
    </div>
  );
};
