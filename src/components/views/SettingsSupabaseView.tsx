import React, { useEffect, useState } from 'react';
import { Settings, Loader2, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/auth';
import { bpsToPercent } from '../../lib/money';
import { updateCompany } from '../../data/adminRepository';
import { ViewHeader, InlineAlert, ReadOnlyNotice } from '../common/DataViewShell';

/**
 * Configuración de la empresa.
 *
 * Editar estos datos está restringido al propietario por RLS: la interfaz solo
 * refleja esa regla. Los campos fiscales importan porque de ellos salen el
 * ITBIS y la cabecera de todos los comprobantes.
 */
export const SettingsSupabaseView: React.FC = () => {
  const { company, branch, profile, reload } = useAuth();
  const editable = can(profile, 'manageCatalog') && profile?.role === 'propietario';

  const [tradeName, setTradeName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [headerNote, setHeaderNote] = useState('');
  const [footerNote, setFooterNote] = useState('');
  const [printerWidth, setPrinterWidth] = useState<'58mm' | '80mm' | 'letter'>('80mm');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    setTradeName(company.trade_name);
    setLegalName(company.legal_name);
    setTaxId(company.tax_id);
    setHeaderNote(company.header_note ?? '');
    setFooterNote(company.footer_note ?? '');
    setPrinterWidth(company.thermal_printer_width);
  }, [company]);

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
        thermal_printer_width: printerWidth
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
      <label htmlFor={id} className="text-xs font-semibold text-slate-400 uppercase">{label}</label>
      <input id={id} type="text" value={value} disabled={!editable || busy}
        onChange={e => set(e.target.value)}
        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-60" />
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <ViewHeader
        icon={<Settings className="w-5 h-5 text-indigo-400" />}
        title="Configuración de la empresa"
        subtitle="Datos fiscales, moneda e impresión de comprobantes"
      />

      {!editable && (
        <ReadOnlyNotice>
          Solo el propietario puede modificar estos datos. La restricción la aplica la base
          de datos, no esta pantalla.
        </ReadOnlyNotice>
      )}
      {notice && <InlineAlert tone="success" onDismiss={() => setNotice(null)}>{notice}</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Datos fiscales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('s-trade', 'Nombre comercial', tradeName, setTradeName)}
          {field('s-legal', 'Razón social', legalName, setLegalName)}
          {field('s-tax', 'RNC', taxId, setTaxId, 'Aparece en todos los comprobantes.')}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase">ITBIS</span>
            <p className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-xs font-bold">
              {bpsToPercent(company?.tax_rate_bps ?? 1800)}
            </p>
            <p className="text-[10px] text-slate-500">
              La tasa impositiva no se edita desde aquí: cambiarla altera el cálculo de
              comprobantes ya emitidos y exige una decisión contable.
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase">Moneda</span>
            <p className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-xs font-bold">
              {company?.currency} ({company?.currency_symbol})
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-400 uppercase">Sucursal activa</span>
            <p className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-xs font-bold">
              {branch?.name ?? '—'}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2">Comprobantes</h3>
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="s-width" className="text-xs font-semibold text-slate-400 uppercase">
              Ancho de la impresora térmica
            </label>
            <select id="s-width" value={printerWidth} disabled={!editable || busy}
              onChange={e => setPrinterWidth(e.target.value as '58mm' | '80mm' | 'letter')}
              className="w-full sm:w-48 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-xs disabled:opacity-60">
              <option value="58mm">58 mm</option>
              <option value="80mm">80 mm</option>
              <option value="letter">Carta</option>
            </select>
            <p className="text-[10px] text-slate-500">Determina el ancho real del ticket al imprimir.</p>
          </div>
          {field('s-header', 'Nota de cabecera', headerNote, setHeaderNote)}
          {field('s-footer', 'Nota de pie', footerNote, setFooterNote)}
        </div>
      </section>

      {editable && (
        <button onClick={() => void save()} disabled={busy}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar cambios
        </button>
      )}
    </div>
  );
};
