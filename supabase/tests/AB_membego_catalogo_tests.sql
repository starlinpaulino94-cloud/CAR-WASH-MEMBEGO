-- =============================================================================
-- Sincronización masiva del catálogo de Membego · pruebas
-- (migración 20260825150000)
-- =============================================================================
-- Verifica membego_sync_catalogo: vuelca promociones, citas y membresías al
-- snapshot, es idempotente (reemplaza) y deja rastro. Reutiliza el vínculo de
-- Membego que crea AA_membego_perfil para la empresa c_a.
-- =============================================================================

set role postgres;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_res jsonb;
begin
  insert into public.membego_company_links (company_id, membego_company_id, is_active)
    values (v_c, 'cmtest_perfil_0001', true)
    on conflict (company_id) do update set membego_company_id = excluded.membego_company_id;

  v_res := public.membego_sync_catalogo(
    'cmtest_perfil_0001',
    '[{"id":"p1","titulo":"2x1","descripcion":"martes","activo":true,"vigenciaDesde":"2026-08-01T00:00:00Z","vigenciaHasta":null},
      {"id":"p2","titulo":"Cera","descripcion":"premium","activo":false,"vigenciaDesde":"2026-07-01T00:00:00Z","vigenciaHasta":"2026-09-01T00:00:00Z"}]'::jsonb,
    '[{"id":"c1","customerId":"cu1","branchId":"b1","vehicleId":"v1","inicio":"2026-08-26T15:00:00Z","duracionMin":45,"servicio":"Detallado","estado":"CONFIRMADA"}]'::jsonb,
    '[{"id":"m1","customerId":"cu1","planNombre":"PLAN SILVER","estado":"ACTIVA","vigenteHasta":"2027-01-01T00:00:00Z"}]'::jsonb
  );

  perform test.check('membego_sync_catalogo responde handled con conteos',
    (v_res ->> 'handled') = 'true'
      and (v_res ->> 'promociones') = '2'
      and (v_res ->> 'citas') = '1'
      and (v_res ->> 'membresias') = '1',
    'res=' || v_res::text);
end $$;

do $$
declare v_c uuid := test.var('c_a')::uuid; v_n int;
begin
  select count(*) into v_n from public.membego_promociones where company_id = v_c and not activo;
  perform test.check('la promoción inactiva conserva su bandera', v_n = 1, 'inactivas=' || v_n);

  perform test.check('la cita guardó servicio, duración y estado',
    exists(select 1 from public.membego_citas
           where company_id = v_c and servicio = 'Detallado' and duracion_min = 45 and estado = 'CONFIRMADA'),
    'Detallado · 45min · CONFIRMADA');

  perform test.check('la membresía guardó plan y vencimiento',
    exists(select 1 from public.membego_membresias
           where company_id = v_c and plan_nombre = 'PLAN SILVER' and vigente_hasta is not null),
    'PLAN SILVER con vencimiento');
end $$;

-- Idempotencia: reejecutar con vacío reemplaza (deja todo en cero).
do $$
declare v_c uuid := test.var('c_a')::uuid; v_p int; v_ci int; v_m int;
begin
  perform public.membego_sync_catalogo('cmtest_perfil_0001', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  select count(*) into v_p  from public.membego_promociones where company_id = v_c;
  select count(*) into v_ci from public.membego_citas       where company_id = v_c;
  select count(*) into v_m  from public.membego_membresias  where company_id = v_c;
  perform test.check('reejecutar reemplaza los tres snapshots (todo a 0)',
    v_p = 0 and v_ci = 0 and v_m = 0, 'p=' || v_p || ' c=' || v_ci || ' m=' || v_m);
end $$;

reset role;
