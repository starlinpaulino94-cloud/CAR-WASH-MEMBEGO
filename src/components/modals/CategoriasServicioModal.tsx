import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Check, X, Pencil, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/button';
import {
  fetchCategoriasServicio, crearCategoriaServicio, actualizarCategoriaServicio,
  CategoriaServicio
} from '../../data/adminRepository';
import { FormModal, textInputClass } from '../common/FormModal';
import { InlineAlert } from '../common/DataViewShell';

/**
 * Crear y ordenar los tipos de trabajo del catálogo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE ESCONDEN, NO SE BORRAN
 *
 * Una categoría no tiene botón de borrar y es deliberado: los servicios guardan
 * su código, así que borrarla dejaría huérfanos servicios que se siguen
 * vendiendo — y el precio y el histórico cuelgan de ellos, no de ella.
 * Esconderla la saca del filtro y de los desplegables sin tocar nada; si se
 * vuelve a encender, sus servicios vuelven a agruparse solos.
 *
 * El código tampoco se edita: es lo que ata la categoría a sus servicios. Se
 * cambia la etiqueta, que es lo que se lee.
 */
export const CategoriasServicioModal: React.FC<{
  onClose: () => void;
  /** Se llama cuando algo cambió, para que la pantalla de atrás se refresque. */
  onCambio: () => void;
}> = ({ onClose, onCambio }) => {
  const [cats, setCats] = useState<CategoriaServicio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nueva, setNueva] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');
  /** `true` si se tocó algo: evita recargar la pantalla de atrás sin motivo. */
  const [huboCambio, setHuboCambio] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // Con las inactivas: esta es la pantalla donde se vuelven a encender, y
      // una categoría escondida que no se ve desde ningún sitio está perdida.
      setCats(await fetchCategoriasServicio(false));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las categorías');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const cerrar = () => { if (huboCambio) onCambio(); onClose(); };

  const crear = async () => {
    const label = nueva.trim();
    if (!label) { setError('Escriba el nombre de la categoría.'); return; }
    setBusy(true);
    try {
      await crearCategoriaServicio(label);
      setNueva('');
      setHuboCambio(true);
      setError(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la categoría');
    } finally {
      setBusy(false);
    }
  };

  const renombrar = async (id: string) => {
    const label = borrador.trim();
    if (!label) { setError('El nombre no puede quedar vacío.'); return; }
    setBusy(true);
    try {
      await actualizarCategoriaServicio(id, { label });
      setEditando(null);
      setHuboCambio(true);
      setError(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo renombrar');
    } finally {
      setBusy(false);
    }
  };

  const alternar = async (c: CategoriaServicio) => {
    setBusy(true);
    try {
      await actualizarCategoriaServicio(c.id, { isActive: !c.is_active });
      setHuboCambio(true);
      setError(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la visibilidad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal
      title="Categorías de servicio"
      submitLabel="Listo"
      busy={busy}
      error={null}
      onSubmit={cerrar}
      onClose={cerrar}
    >
      <p className="text-xs text-muted leading-relaxed">
        Agrupan el catálogo en la caja, en la recepción y al editar una orden.
        Cada servicio pertenece a una; se le asigna en la tabla del catálogo.
      </p>

      {error && <InlineAlert tone="error" onDismiss={() => setError(null)}>{error}</InlineAlert>}

      <div className="flex gap-2">
        <input
          className={textInputClass}
          value={nueva}
          disabled={busy}
          onChange={e => setNueva(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void crear(); } }}
          placeholder="Nombre de la categoría nueva"
          aria-label="Nombre de la categoría nueva"
        />
        <Button size="sm" onClick={() => void crear()} disabled={busy || !nueva.trim()}>
          <Plus className="w-4 h-4" /> Añadir
        </Button>
      </div>

      {cargando ? (
        <p className="text-xs text-faint flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Cargando…
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-xl overflow-hidden">
          {cats.map(c => (
            <li key={c.id} className={`flex items-center gap-2 p-2.5 ${c.is_active ? '' : 'opacity-50'}`}>
              {editando === c.id ? (
                <>
                  <input
                    autoFocus className={textInputClass} value={borrador} disabled={busy}
                    onChange={e => setBorrador(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); void renombrar(c.id); }
                      if (e.key === 'Escape') setEditando(null);
                    }}
                    aria-label={`Nombre de ${c.label}`}
                  />
                  <Button variant="ghost" size="icon-sm" className="text-success hover:text-success"
                    onClick={() => void renombrar(c.id)} disabled={busy} aria-label="Guardar">
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="text-faint"
                    onClick={() => setEditando(null)} disabled={busy} aria-label="Cancelar">
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-strong truncate">{c.label}</span>
                    <span className="block text-xs text-faint">
                      {c.code}{!c.is_active && ' · escondida'}
                    </span>
                  </span>
                  <Button variant="ghost" size="icon-sm"
                    onClick={() => { setEditando(c.id); setBorrador(c.label); }}
                    disabled={busy} aria-label={`Renombrar ${c.label}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm"
                    onClick={() => void alternar(c)} disabled={busy}
                    title={c.is_active
                      ? 'Deja de ofrecerse en el filtro; sus servicios se siguen vendiendo'
                      : 'Vuelve a ofrecerse en el filtro'}
                    aria-label={`${c.is_active ? 'Esconder' : 'Mostrar'} ${c.label}`}>
                    {c.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-faint">
        Esconder una categoría la saca del filtro, pero no toca sus servicios:
        se siguen vendiendo y vuelven a agruparse si la enciende de nuevo.
      </p>
    </FormModal>
  );
};
