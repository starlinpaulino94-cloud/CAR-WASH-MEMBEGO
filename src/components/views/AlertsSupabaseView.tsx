import React, { useEffect, useState } from 'react';
import {
  Bell, RefreshCw, MessageCircle, Check, X,
  Package, Landmark, Wrench, CalendarClock, CreditCard, Car
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  fetchNotifications, refreshAlerts, markNotification, whatsappLink,
  Notification, NotificationKind, NotificationStatus
} from '../../data/notificationRepository';
import {
  ViewHeader, ErrorState, InlineAlert, ReadOnlyNotice, FilterChips, StatCard, HelpNote
} from '../common/DataViewShell';

type Filter = 'pendiente' | 'todas';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'todas', label: 'Todos' }
];

const KIND_META: Record<NotificationKind, { icon: React.ReactNode; label: string }> = {
  orden_lista:             { icon: <Car className="w-4 h-4" />,           label: 'Vehículo listo' },
  recordatorio_cita:       { icon: <CalendarClock className="w-4 h-4" />, label: 'Cita' },
  stock_bajo:              { icon: <Package className="w-4 h-4" />,       label: 'Inventario' },
  cuenta_vencida:          { icon: <Landmark className="w-4 h-4" />,      label: 'Cobro vencido' },
  mantenimiento_pendiente: { icon: <Wrench className="w-4 h-4" />,        label: 'Mantenimiento' },
  caja_sin_cerrar:         { icon: <CreditCard className="w-4 h-4" />,    label: 'Caja' },
  otro:                    { icon: <Bell className="w-4 h-4" />,          label: 'Aviso' }
};

const STATUS_META: Record<NotificationStatus, { label: string; clase: string }> = {
  pendiente:  { label: 'Pendiente',  clase: 'bg-warning/20 text-warning' },
  enviado:    { label: 'Enviado',    clase: 'bg-success/20 text-success' },
  descartado: { label: 'Descartado', clase: 'bg-surface-3/50 text-muted' },
  fallido:    { label: 'Falló',      clase: 'bg-danger/20 text-danger' }
};

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });

/**
 * Avisos: lo que el sistema sabe y antes no decía.
 *
 * Al cliente —su vehículo está listo, su cita es mañana— y al negocio —producto
 * bajo mínimo, cuenta vencida, equipo sin mantenimiento, caja sin cerrar—.
 *
 * El envío es manual a propósito: no hay proveedor de WhatsApp contratado, así
 * que el botón abre el chat con el texto ya escrito y luego se marca. Es lo que
 * se puede hacer bien hoy, en vez de fingir una integración que no existe.
 */
export const AlertsSupabaseView: React.FC = () => {
  const { profile, phase } = useAuth();
  const canRefresh = ['propietario', 'administrador', 'supervisor', 'contador', 'superadmin']
    .includes(profile?.role ?? '');

  const [filter, setFilter] = useState<Filter>('pendiente');
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'ready') { setLoading(false); return; }
    setLoading(true);
    fetchNotifications(filter === 'todas' ? 'todas' : 'pendiente')
      .then(setRows)
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar los avisos'))
      .finally(() => setLoading(false));
  }, [phase, filter, nonce]);

  const barrer = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await refreshAlerts();
      setNotice(r.total === 0
        ? 'Todo al día: no hay avisos nuevos.'
        : `${r.total} aviso(s) nuevo(s).`);
      setNonce(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron refrescar los avisos');
    } finally {
      setBusy(false);
    }
  };

  const resolver = async (n: Notification, status: 'enviado' | 'descartado') => {
    try {
      await markNotification(n.id, status);
      setNotice(status === 'enviado' ? 'Aviso marcado como enviado.' : 'Aviso descartado.');
      setNonce(x => x + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el aviso');
    }
  };

  if (phase !== 'ready') {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <ViewHeader
          title="Avisos" subtitle="Al cliente y al negocio" />
        <ReadOnlyNotice>Disponible al conectar la base de datos.</ReadOnlyNotice>
      </div>
    );
  }

  if (error && rows.length === 0 && !loading && !busy) {
    return <ErrorState message={error} onRetry={() => setNonce(n => n + 1)}
      title="No se pudieron cargar los avisos" />;
  }

  const pendientes = rows.filter(r => r.status === 'pendiente');
  const alCliente = pendientes.filter(r => r.audience === 'cliente').length;
  const alNegocio = pendientes.filter(r => r.audience === 'interno').length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <ViewHeader
        title="Avisos"
        subtitle="Lo que hay que decirle a alguien: al cliente o a usted mismo"
        actions={canRefresh ? (
          <button onClick={() => void barrer()} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand text-on-accent font-bold text-xs rounded-xl disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Buscar avisos
          </button>
        ) : undefined}
      />

      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Pendientes" value={String(pendientes.length)}
          tone={pendientes.length > 0 ? 'text-warning' : undefined} />
        <StatCard label="Al cliente" value={String(alCliente)}
          hint="Vehículo listo, recordatorios" />
        <StatCard label="Del negocio" value={String(alNegocio)}
          hint="Inventario, cobros, equipos" />
      </div>

      <FilterChips options={FILTERS} value={filter} onChange={setFilter} />

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-20 bg-surface-2/50 rounded-2xl animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface/80 border border-line rounded-2xl p-8 text-center">
          <Bell className="w-8 h-8 text-faint mx-auto mb-2" />
          <p className="text-sm text-muted">
            {filter === 'pendiente'
              ? 'Nada pendiente. Pulse «Buscar avisos» para revisar inventario, cobros y equipos.'
              : 'Todavía no hay avisos.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(n => {
            const meta = KIND_META[n.kind];
            const esCliente = n.audience === 'cliente';
            return (
              <li key={n.id}
                className="bg-surface/80 border border-line rounded-2xl p-4 flex flex-wrap items-start gap-3">
                <span className={`p-2 rounded-xl ${esCliente ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted'}`}>
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-[14rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-strong text-sm">{n.title}</h2>
                    <span className={`font-bold px-2 py-0.5 rounded text-xs ${STATUS_META[n.status].clase}`}>
                      {STATUS_META[n.status].label}
                    </span>
                    <span className="text-xs text-faint">{meta.label} · {cuando(n.created_at)}</span>
                  </div>
                  <p className="text-sm text-muted mt-0.5">{n.body}</p>
                </div>

                {n.status === 'pendiente' && (
                  <div className="flex items-center gap-1.5">
                    {n.recipient_phone && (
                      <a href={whatsappLink(n.recipient_phone, n.body)}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-success hover:bg-success text-on-accent font-bold text-xs rounded-lg">
                        <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                      </a>
                    )}
                    <button onClick={() => void resolver(n, 'enviado')}
                      aria-label={`Marcar como enviado: ${n.title}`}
                      className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-success">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => void resolver(n, 'descartado')}
                      aria-label={`Descartar: ${n.title}`}
                      className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-muted">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <HelpNote summary="Cómo se envía un aviso">
        Salen desde el WhatsApp de este dispositivo: el botón abre el chat con el
        texto ya escrito. Después, márquelo como enviado para que salga de lo
        pendiente.
      </HelpNote>
    </div>
  );
};
