-- =============================================================================
-- 0012 · Estado fiscal (¿hay NCF utilizables?)
-- =============================================================================
-- La facturación fiscal requiere rangos NCF autorizados por la DGII cargados en
-- `ncf_sequences`. Mientras no los haya, la interfaz debe DESACTIVAR el cobro y
-- decirlo con claridad, en lugar de dejar que el cajero choque contra el error
-- de `allocate_ncf` a mitad de una venta.
--
-- Problema: la política `ncf_sequences_select` solo deja LEER esa tabla a
-- propietario/administrador/contador. Un CAJERO —que es quien usa el POS— no la
-- ve, así que una consulta directa de conteo le daría 0 aunque haya rangos, y le
-- bloquearía el cobro para siempre.
--
-- Solución: una función SECURITY DEFINER que revela SOLO un booleano (y los
-- tipos disponibles), acotado a la empresa del propio usuario. No expone rangos,
-- números ni fechas: nada sensible. Cualquier rol del tenant puede llamarla.
-- =============================================================================

create or replace function public.fiscal_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with usable as (
    select s.ncf_type
    from public.ncf_sequences s
    where s.company_id = app.current_company_id()
      and s.is_active
      and s.next_value <= s.range_end        -- rango no agotado
      and s.authorized_until >= current_date -- autorización vigente
  )
  select jsonb_build_object(
    'ready', exists (select 1 from usable),
    'types', coalesce((select jsonb_agg(distinct ncf_type order by ncf_type) from usable), '[]'::jsonb)
  );
$$;

comment on function public.fiscal_status is
  'Booleano de preparación fiscal + tipos NCF utilizables, acotado a la empresa del usuario. '
  'SECURITY DEFINER para que también el cajero (que no puede leer ncf_sequences) sepa si puede facturar.';

-- Sin empresa asignada, current_company_id() es null y no hay filas: ready=false.
-- Fallo cerrado, coherente con el resto del sistema.
grant execute on function public.fiscal_status() to authenticated;
