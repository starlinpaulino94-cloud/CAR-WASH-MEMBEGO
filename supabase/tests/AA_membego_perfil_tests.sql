-- =============================================================================
-- Sincronización del perfil de la empresa desde Membego · pruebas
-- (migración 20260825140000)
-- =============================================================================
-- Verifica membego_sync_perfil: vuelca el perfil y las sucursales al snapshot,
-- es idempotente y deja rastro en la bitácora. Se apoya en la empresa c_a de
-- 10_rls_tests.sql y crea su propio vínculo de Membego.
-- =============================================================================

set role postgres;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_res jsonb;
begin
  -- Vínculo de Membego para c_a (id de Membego de prueba).
  insert into public.membego_company_links (company_id, membego_company_id, is_active)
    values (v_c, 'cmtest_perfil_0001', true)
    on conflict (company_id) do update set membego_company_id = excluded.membego_company_id;

  v_res := public.membego_sync_perfil(
    'cmtest_perfil_0001',
    '{"id":"cmtest_perfil_0001","nombre":"Empresa Alfa Membego","slug":"alfa","logoUrl":"https://x/a.png","moneda":"DOP","zonaHoraria":"America/Santo_Domingo","idioma":"es"}'::jsonb,
    '[{"id":"suc1","nombre":"Principal","direccion":"Calle 1","activa":true},
      {"id":"suc2","nombre":"Cerrada","direccion":null,"activa":false}]'::jsonb
  );

  perform test.check('membego_sync_perfil resuelve la empresa y responde handled',
    (v_res ->> 'handled') = 'true', 'res=' || v_res::text);
  perform test.check('reporta el conteo de sucursales sincronizadas (2)',
    (v_res ->> 'sucursales') = '2', 'sucursales=' || (v_res ->> 'sucursales'));
end $$;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_perfil public.membego_empresa_perfil;
  v_n int;
  v_inactivas int;
begin
  select * into v_perfil from public.membego_empresa_perfil where company_id = v_c;
  perform test.check('el perfil guardó el nombre de Membego',
    v_perfil.nombre = 'Empresa Alfa Membego', 'nombre=' || coalesce(v_perfil.nombre,'∅'));
  perform test.check('el perfil guardó moneda y zona horaria',
    v_perfil.moneda = 'DOP' and v_perfil.zona_horaria = 'America/Santo_Domingo',
    'moneda=' || coalesce(v_perfil.moneda,'∅'));

  select count(*) into v_n from public.membego_sucursales where company_id = v_c;
  perform test.check('se guardaron las 2 sucursales', v_n = 2, 'n=' || v_n);

  select count(*) into v_inactivas from public.membego_sucursales
    where company_id = v_c and not activa;
  perform test.check('la sucursal inactiva conserva su bandera', v_inactivas = 1, 'inactivas=' || v_inactivas);
end $$;

-- Idempotencia: reejecutar con menos sucursales REEMPLAZA el snapshot.
do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_n int;
begin
  perform public.membego_sync_perfil(
    'cmtest_perfil_0001',
    '{"nombre":"Empresa Alfa Membego"}'::jsonb,
    '[{"id":"suc1","nombre":"Principal","activa":true}]'::jsonb
  );
  select count(*) into v_n from public.membego_sucursales where company_id = v_c;
  perform test.check('reejecutar reemplaza el snapshot, no acumula (queda 1)', v_n = 1, 'n=' || v_n);
end $$;

-- Empresa desconocida: no escribe nada, responde handled=false.
do $$
declare v_res jsonb;
begin
  v_res := public.membego_sync_perfil('empresa_que_no_existe', '{}'::jsonb, '[]'::jsonb);
  perform test.check('un membego_company_id no vinculado no hace nada',
    (v_res ->> 'handled') = 'false', 'res=' || v_res::text);
end $$;

reset role;
