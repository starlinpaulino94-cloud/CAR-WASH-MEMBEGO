import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Loader2, Save, BadgeCheck, Link2, History, RefreshCw, Building2, DownloadCloud } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { bpsToPercent } from '../../lib/money';
import {
  updateCompany, fetchMembegoLink, linkMembegoCompany, MembegoLink,
  sincronizarPerfilMembego, fetchPerfilMembego, fetchSucursalesMembego,
  MembegoEmpresaPerfil, MembegoSucursal
} from '../../data/adminRepository';
import { ViewHeader, InlineAlert, ReadOnlyNotice } from '../common/DataViewShell';
import { fetchMembegoLogs, MembegoSyncLog } from '../../data/adminRepository';
import { NivelesMembego } from '../settings/NivelesMembego';

/**
 * Configuración de la empresa.
 *
 * Editar estos datos está restringido al propietario por RLS: la interfaz solo
 * refleja esa regla. Los campos fiscales importan porque de ellos salen el
 * ITBIS y la cabecera de todos los comprobantes.
 *
 * `seccion` divide la pantalla en los submódulos de Configuración (empresa /
 * impresión / membego) SIN duplicar lógica: es el mismo componente y el mismo
 * guardado; solo cambia qué bloques se pintan. Sin prop, muestra todo.
 */
export const SettingsSupabaseView: React.FC<{ seccion?: 'empresa' | 'impresion' | 'membego' }> = ({ seccion }) => {
  const { company, branch, profile, reload } = useAuth();
  const show = (s: 'empresa' | 'impresion' | 'membego') => !seccion || seccion === s;
  const editable = can(profile, 'manageCatalog') && profile?.role === 'propietario';
  const canManageMembego = can(profile, 'manageStaff');

  const [tradeName, setTradeName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [headerNote, setHeaderNote] = useState('');
  const [footerNote, setFooterNote] = useState('');
  const [printerWidth, setPrinterWidth] = useState<'58mm' | '80mm' | 'letter'>('80mm');
  const [itbisIncluido, setItbisIncluido] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Vínculo con Membego.
  const [membegoLink, setMembegoLink] = useState<MembegoLink | null>(null);
  const [membegoInput, setMembegoInput] = useState('');
  const [membegoBusy, setMembegoBusy] = useState(false);
  const [membegoError, setMembegoError] = useState<string | null>(null);
  const [membegoNotice, setMembegoNotice] = useState<string | null>(null);
  // Bitácora de sincronización. Vivía en una pantalla aparte que solo existía
  // para alimentar un simulador; el simulador se fue y esto, que sí es real, se
  // queda donde tiene sentido: al lado del vínculo que lo produce.
  const [membegoLogs, setMembegoLogs] = useState<MembegoSyncLog[]>([]);
  // Perfil de la empresa sincronizado desde Membego (Fase 1).
  const [perfilMembego, setPerfilMembego] = useState<MembegoEmpresaPerfil | null>(null);
  const [sucursalesMembego, setSucursalesMembego] = useState<MembegoSucursal[]>([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    setTradeName(company.trade_name);
    setLegalName(company.legal_name);
    setTaxId(company.tax_id);
    setHeaderNote(company.header_note ?? '');
    setFooterNote(company.footer_note ?? '');
    setPrinterWidth(company.thermal_printer_width);
    setItbisIncluido(company.prices_include_tax ?? false);
  }, [company]);

  useEffect(() => {
    if (!canManageMembego) return;
    fetchMembegoLink()
      .then(link => { setMembegoLink(link); if (link) setMembegoInput(link.membegoCompanyId); })
      .catch(() => { /* no bloquea la vista */ });
    fetchMembegoLogs(25)
      .then(setMembegoLogs)
      .catch(() => { /* la bitácora es accesoria: no tumba los ajustes */ });
    fetchPerfilMembego()
      .then(setPerfilMembego)
      .catch(() => { /* aún no sincronizado: la vista lo dice */ });
    fetchSucursalesMembego()
      .then(setSucursalesMembego)
      .catch(() => { /* idem */ });
  }, [canManageMembego]);

  const sincronizarPerfil = async () => {
    if (syncBusy) return;
    setSyncBusy(true); setSyncError(null); setSyncNotice(null);
    try {
      const r = await sincronizarPerfilMembego();
      setPerfilMembego(await fetchPerfilMembego());
      setSucursalesMembego(await fetchSucursalesMembego());
      setSyncNotice(
        `Perfil sincronizado desde Membego${
          typeof r.sucursales === 'number' ? ` · ${r.sucursales} sucursal(es)` : ''
        }.${r.sucursalesError ? ' Las sucursales no se pudieron leer (falta el permiso branches:read).' : ''}`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'No se pudo sincronizar');
    } finally {
      setSyncBusy(false);
    }
  };

  const linkMembego = async () => {
    if (!membegoInput.trim() || membegoBusy) return;
    setMembegoBusy(true); setMembegoError(null); setMembegoNotice(null);
    try {
      await linkMembegoCompany(membegoInput);
      setMembegoLink(await fetchMembegoLink());
      setMembegoNotice('Comercio de Membego vinculado. Los eventos de esta empresa ya entran.');
    } catch (err) {
      setMembegoError(err instanceof Error ? err.message : 'No se pudo vincular');
    } finally {
      setMembegoBusy(false);
    }
  };

  const save = async () => {
    if (!company || busy) return;
    if (!tradeName.trim() || !legalName.trim() || !taxId.trim()) {
      setError('Nombre comercial, razón social y RNC son obligatorios.');
      return;
    }
    setBusy(true); setError(null);
    try {
      await updateCompany(company.id, {
        trade_name: tradeName.trim(), legal_name: legalName.trim(), tax_id: taxId.trim(),
        header_note: headerNote.trim() || null, footer_note: footerNote.trim() || null,
        thermal_printer_width: printerWidth,
        prices_include_tax: itbisIncluido
      });
      setNotice('Configuración guardada.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, hint?: string) => (
    <div key={id} className="space-y-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted uppercase">{label}</label>
      <input id={id} type="text" value={value} disabled={!editable || busy}
        onChange={e => set(e.target.value)}
        className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong text-xs focus:outline-none focus:border-brand disabled:opacity-60" />
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );

  const headerBySection = {
    empresa:   { title: 'Empresa', subtitle: 'Datos fiscales y moneda de la empresa' },
    impresion: { title: 'Impresión', subtitle: 'Impresora térmica y notas de los comprobantes' },
    membego:   { title: 'Membego', subtitle: 'Vínculo de esta empresa con la plataforma Membego' }
  } as const;
  const header = seccion
    ? headerBySection[seccion]
    : { title: 'Configuración de la empresa', subtitle: 'Datos fiscales, moneda e impresión de comprobantes' };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <ViewHeader
        title={header.title}
        subtitle={header.subtitle}
      />

      {seccion !== 'membego' && !editable && (
        <ReadOnlyNotice>
          Solo el propietario puede modificar estos datos. La restricción la aplica la base
          de datos, no esta pantalla.
        </ReadOnlyNotice>
      )}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {show('empresa') && (
      <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2">Datos fiscales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('s-trade', 'Nombre comercial', tradeName, setTradeName)}
          {field('s-legal', 'Razón social', legalName, setLegalName)}
          {field('s-tax', 'RNC', taxId, setTaxId, 'Aparece en todos los comprobantes.')}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted uppercase">ITBIS</span>
            <p className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong text-xs font-bold">
              {bpsToPercent(company?.tax_rate_bps ?? 1800)}
            </p>
            <p className="text-xs text-faint">
              La tasa impositiva no se edita desde aquí: cambiarla altera el cálculo de
              comprobantes ya emitidos y exige una decisión contable.
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <span className="text-xs font-semibold text-muted uppercase">Cálculo del ITBIS</span>
            <label className="flex items-start gap-2.5 bg-canvas border border-line rounded-lg p-2.5 cursor-pointer has-[:disabled]:opacity-60 has-[:disabled]:cursor-default">
              <input
                type="checkbox"
                checked={itbisIncluido}
                disabled={!editable || busy}
                onChange={e => setItbisIncluido(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand shrink-0"
              />
              <span className="text-xs text-strong">
                Los precios de la lista <strong>ya incluyen</strong> el ITBIS.
                <span className="block text-faint font-normal mt-0.5">
                  Activado: un lavado de RD$&nbsp;1.000 se cobra 1.000 y el {bpsToPercent(company?.tax_rate_bps ?? 1800)} se
                  extrae de adentro para el comprobante. Apagado: el ITBIS se suma encima del precio.
                </span>
              </span>
            </label>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted uppercase">Moneda</span>
            <p className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong text-xs font-bold">
              {company?.currency} ({company?.currency_symbol})
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted uppercase">Sucursal activa</span>
            <p className="w-full bg-canvas border border-line rounded-lg p-2.5 text-strong text-xs font-bold">
              {branch?.name ?? '—'}
            </p>
          </div>
        </div>
      </section>
      )}

      {show('impresion') && (
      <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-strong text-sm border-b border-line pb-2">Comprobantes</h3>
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="s-width" className="text-xs font-semibold text-muted uppercase">
              Ancho de la impresora térmica
            </label>
            <select id="s-width" value={printerWidth} disabled={!editable || busy}
              onChange={e => setPrinterWidth(e.target.value as '58mm' | '80mm' | 'letter')}
              className="w-full sm:w-48 bg-canvas border border-line rounded-lg p-2.5 text-strong text-xs disabled:opacity-60">
              <option value="58mm">58 mm</option>
              <option value="80mm">80 mm</option>
              <option value="letter">Carta</option>
            </select>
            <p className="text-xs text-faint">Determina el ancho real del ticket al imprimir.</p>
          </div>
          {field('s-header', 'Nota de cabecera', headerNote, setHeaderNote)}
          {field('s-footer', 'Nota de pie', footerNote, setFooterNote)}
        </div>
      </section>
      )}

      {seccion !== 'membego' && editable && (
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Guardar cambios
        </Button>
      )}

      {/* Los niveles van con Membego y no en una pantalla aparte: existen solo
          para hablar con Membego, y es donde alguien los va a buscar cuando una
          membresía no cubra lo que debería. */}
      {show('membego') && canManageMembego && <NivelesMembego editable={editable} />}

      {/* Perfil de la empresa traído de Membego (Fase 1): datos maestros y
          sucursales. Es un snapshot informativo; no pisa los datos fiscales ni
          las sucursales operativas del car wash. */}
      {show('membego') && canManageMembego && (
        <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-2 gap-2">
            <h3 className="font-bold text-strong text-sm flex items-center gap-2">
              <DownloadCloud className="w-4 h-4 text-brand" /> Perfil desde Membego
            </h3>
            <Button size="sm" onClick={() => void sincronizarPerfil()} disabled={syncBusy}>
              {syncBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Sincronizar
            </Button>
          </div>

          {syncNotice && <InlineAlert tone="success" onDismiss={() => setSyncNotice(null)}>{syncNotice}</InlineAlert>}
          {syncError && <InlineAlert tone="error" onDismiss={() => setSyncError(null)}>{syncError}</InlineAlert>}

          {!perfilMembego ? (
            <p className="text-xs text-faint italic">
              Todavía no se ha traído el perfil de Membego. Pulsa <strong>Sincronizar</strong> para
              importar los datos de la empresa y sus sucursales.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="space-y-0.5">
                  <span className="text-faint uppercase font-semibold">Nombre en Membego</span>
                  <p className="text-strong font-bold">{perfilMembego.nombre ?? '—'}</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-faint uppercase font-semibold">Moneda · Zona horaria</span>
                  <p className="text-strong font-bold">
                    {perfilMembego.moneda ?? '—'} · {perfilMembego.zona_horaria ?? '—'}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-faint uppercase font-semibold flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Sucursales ({sucursalesMembego.length})
                </span>
                {sucursalesMembego.length === 0 ? (
                  <p className="text-xs text-faint italic">
                    Sin sucursales en el último snapshot (puede faltar el permiso <span className="font-mono">branches:read</span>).
                  </p>
                ) : (
                  <div className="space-y-1">
                    {sucursalesMembego.map(s => (
                      <div key={s.membego_branch_id}
                        className="flex items-center justify-between gap-2 p-2 bg-canvas rounded-lg border border-line text-xs">
                        <span className="min-w-0">
                          <span className="block font-bold text-strong truncate">{s.nombre}</span>
                          {s.direccion && <span className="block text-muted truncate">{s.direccion}</span>}
                        </span>
                        {!s.activa && (
                          <span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning font-bold whitespace-nowrap">
                            Inactiva
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-faint">
                Última sincronización: {new Date(perfilMembego.synced_at).toLocaleString('es-DO')}.
                Es una copia informativa: no cambia tus datos fiscales ni tus sucursales operativas.
              </p>
            </div>
          )}
        </section>
      )}

      {show('membego') && canManageMembego && (
        <section className="bg-surface border border-line rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-strong text-sm border-b border-line pb-2 flex items-center gap-2">
            <BadgeCheck className="w-4 h-4 text-warning" /> Integración Membego
          </h3>

          <div className={`flex items-center gap-2 p-3 rounded-xl border text-xs ${
            membegoLink?.isActive
              ? 'bg-success/40 border-success/40 text-success'
              : 'bg-canvas border-line text-muted'
          }`}>
            {membegoLink?.isActive ? <BadgeCheck className="w-4 h-4 text-success" /> : <Link2 className="w-4 h-4" />}
            {membegoLink
              ? <span>Vinculada al comercio <strong className="font-mono">{membegoLink.membegoCompanyId}</strong>{!membegoLink.isActive && ' (inactiva)'}.</span>
              : <span>Todavía no vinculada. Los eventos de Membego se ignoran hasta vincular.</span>}
          </div>

          {membegoNotice && <InlineAlert tone="success" onDismiss={() => setMembegoNotice(null)}>{membegoNotice}</InlineAlert>}
          {membegoError && <InlineAlert tone="error" onDismiss={() => setMembegoError(null)}>{membegoError}</InlineAlert>}

          <div className="space-y-1">
            <label htmlFor="s-membego" className="text-xs font-semibold text-muted uppercase">
              companyId de Membego
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input id="s-membego" type="text" value={membegoInput} disabled={membegoBusy}
                onChange={e => setMembegoInput(e.target.value)}
                placeholder="ej. cmre1hz570000jp04ad5i0roi"
                className="flex-1 p-2.5 text-xs font-mono rounded-lg border border-input bg-transparent text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30" />
              <Button onClick={() => void linkMembego()} disabled={membegoBusy || !membegoInput.trim()}>
                {membegoBusy ? <Loader2 className="animate-spin" /> : <Link2 />}
                {membegoLink ? 'Actualizar vínculo' : 'Vincular'}
              </Button>
            </div>
            <p className="text-xs text-faint">
              El <span className="font-mono">companyId</span> te lo da Membego. Vincula esta empresa para que
              sus clientes, membresías y promociones entren solo aquí.
            </p>
          </div>

          {/* Bitácora. Es lo que permite diagnosticar por qué un cliente de
              Membego no apareció: registra CADA intento, no solo los que
              salieron bien, con la hora y el actor que pone el servidor. */}
          <div className="space-y-2 pt-2 border-t border-line">
            <h4 className="font-bold text-strong text-xs flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-muted" /> Últimos eventos recibidos
            </h4>
            {membegoLogs.length === 0 ? (
              <p className="text-xs text-faint italic py-2">
                Todavía no ha llegado ningún evento de Membego.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {membegoLogs.map(log => (
                  <article key={log.id} className="p-2.5 bg-canvas rounded-lg border border-line text-xs space-y-1">
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-bold text-brand-hi">{log.action}</span>
                      <span className={`px-1.5 py-0.5 rounded font-bold ${
                        log.status === 'success'
                          ? 'bg-success/20 text-success'
                          : 'bg-danger/20 text-danger'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    {log.error_message && <p className="text-danger/90">{log.error_message}</p>}
                    <div className="text-faint">
                      {new Date(log.occurred_at).toLocaleString('es-DO')}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
