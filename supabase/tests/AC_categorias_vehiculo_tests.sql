-- =============================================================================
-- Categorías de vehículo dinámicas · pruebas (migración 20260825160000)
-- =============================================================================
-- Verifica create_vehicle_category / update_vehicle_category: solo el
-- superadmin, agrega el valor al enum, lo deja usable, y desactivar oculta sin
-- borrar. Crea su propio superadmin para la empresa c_a.
-- =============================================================================

set role postgres;

do $$
declare
  v_c uuid := test.var('c_a')::uuid;
  v_super uuid := '99999999-5555-4444-3333-222222222222';
begin
  -- Semilla de categorías para c_a (la migración sembró 0: no había empresas aún).
  insert into public.vehicle_categories (company_id, code, label, sort_order) values
    (v_c, 'sedan', 'Sedán', 10), (v_c, 'suv', 'SUV', 20)
  on conflict (company_id, code) do nothing;

  -- Un superadmin de c_a (auth.users dispara el perfil; se ajusta rol/empresa).
  insert into auth.users (id) values (v_super) on conflict do nothing;
  update public.profiles set company_id = v_c, role = 'superadmin', is_active = true, full_name = 'Super'
    where id = v_super;
  perform test.set_var('u_super_a', v_super::text);
end $$;

-- Un cajero NO puede crear categorías.
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
do $$
declare v_err text;
begin
  begin
    perform public.create_vehicle_category('Camioneta');
    v_err := 'sin error';
  exception when others then v_err := SQLERRM;
  end;
  perform test.check('un cajero no puede crear categorías de vehículo',
    v_err like '%superadministrador%', v_err);
end $$;

-- El superadmin crea «Camioneta» (fuera de un bloque: el ALTER TYPE ADD VALUE
-- va en su propia transacción autocommit, como en PostgREST).
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_super_a'), false);
set role authenticated;
select public.create_vehicle_category('Camioneta');

do $$
declare v_c uuid := test.var('c_a')::uuid; v_row public.vehicle_categories;
begin
  select * into v_row from public.vehicle_categories
   where company_id = v_c and code = 'camioneta';
  perform test.check('el superadmin creó la categoría con su code normalizado',
    v_row.label = 'Camioneta' and v_row.code = 'camioneta', 'row=' || coalesce(v_row.label,'∅'));
  perform test.check('la categoría nueva nace activa', v_row.is_active, 'activa=' || v_row.is_active::text);
end $$;

-- El valor quedó en el enum y es usable en una nueva transacción.
do $$
begin
  perform 'camioneta'::app.vehicle_category;
  perform test.check('el valor «camioneta» quedó usable en el enum', true, 'ok');
end $$;

-- Ocultar (desactivar) no borra: deja de ofrecerse pero sigue en la tabla.
do $$
declare v_c uuid := test.var('c_a')::uuid; v_id uuid;
begin
  select id into v_id from public.vehicle_categories where company_id = v_c and code = 'camioneta';
  perform public.update_vehicle_category(v_id, null, null, false);
  perform test.check('desactivar oculta la categoría pero no la borra',
    exists(select 1 from public.vehicle_categories where id = v_id and not is_active),
    'no encontrada o sigue activa');
end $$;

-- Crear una duplicada se rechaza con su motivo.
do $$
declare v_err text;
begin
  begin perform public.create_vehicle_category('Camioneta'); v_err := 'sin error';
  exception when others then v_err := SQLERRM; end;
  perform test.check('no se crea una categoría duplicada', v_err like '%Ya existe%', v_err);
end $$;

reset role;
