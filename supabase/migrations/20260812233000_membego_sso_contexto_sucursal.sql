-- =============================================================================
-- SSO Membego · declarar el contexto de sucursal ante el guardia de alcance
-- =============================================================================
-- SÍNTOMA (tras la 20260812220000): «La sucursal y el alcance no se editan
-- directamente. Use set_employee_branch().» (42501) al cruzar de empresa.
--
-- CAUSA: el guardia `profiles_scope_guard` (0029) protege branch_id y
-- branch_scope de ediciones directas — mover la propia sucursal sería una
-- escalada de permisos. Su llave es el contexto `app.branch_ctx = 'ok'`, que
-- las funciones sancionadas (`set_employee_branch`, `create_employee`)
-- declaran antes de tocar el perfil. El upsert del SSO tocaba branch_id sin
-- declararlo — tercer guardián de la cadena, y como los dos anteriores, tiene
-- razón: la corrección es declarar el contexto, no quitar el guardia.
--
-- Este cambio es SOLO ese candado alrededor del update del perfil (mismo
-- patrón exacto que create_employee). Todo lo demás es idéntico a la
-- 20260812220000. Idempotente.
-- =============================================================================

create or replace function public.membego_sso_upsert_user(
  p_membego_company_id text,
  p_sub                text,
  p_email              text,
  p_rol                text,
  p_company_name       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_company     uuid;
  v_link_activa boolean;
  v_nombre      text;
  v_rol_in      text := upper(trim(coalesce(p_rol, '')));
  v_role_txt    text;
  v_role        app.user_role;
  v_uid         uuid;
begin
  -- Vínculo existente, activo o no. Sin fila se auto-vincula; con fila
  -- desactivada se rechaza (decisión del operador, ver 20260812210000).
  select company_id, is_active into v_company, v_link_activa
  from public.membego_company_links
  where membego_company_id = p_membego_company_id;

  if v_company is not null and not v_link_activa then
    raise exception 'La empresa de Membego (%) está desactivada en este sistema.', p_membego_company_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_company is null then
    v_nombre := coalesce(
      nullif(trim(p_company_name), ''),
      'Car Wash ' || right(p_membego_company_id, 6)
    );
    begin
      insert into public.companies (trade_name, legal_name, tax_id)
      values (v_nombre, v_nombre, 'MBGO-' || p_membego_company_id)
      returning id into v_company;

      insert into public.membego_company_links (company_id, membego_company_id, is_active)
      values (v_company, p_membego_company_id, true);

      insert into public.branches (company_id, name, is_main)
      values (v_company, 'Sucursal principal', true);
    exception when unique_violation then
      select company_id into v_company
      from public.membego_company_links
      where membego_company_id = p_membego_company_id and is_active;
      if v_company is null then
        raise exception 'La empresa de Membego (%) no pudo vincularse. Intenta de nuevo.', p_membego_company_id
          using errcode = 'insufficient_privilege';
      end if;
    end;
  end if;

  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'El token de Membego no trae un correo válido.' using errcode = 'check_violation';
  end if;

  if v_rol_in in ('CLIENTE', 'MARKETING') then
    raise exception 'El rol % de Membego no tiene acceso a este sistema.', v_rol_in
      using errcode = 'insufficient_privilege';
  end if;

  v_role_txt := case v_rol_in
    when 'SUPERADMIN'    then 'superadmin'
    when 'ADMINISTRADOR' then 'administrador'
    when 'ADMIN_EMPRESA' then 'administrador'
    when 'GERENTE'       then 'supervisor'
    when 'SUPERVISOR'    then 'supervisor'
    when 'CAJERO'        then 'cajero'
    when 'RECEPCION'     then 'recepcionista'
    when 'EMPLEADO'      then 'operario'
    else null
  end;
  if v_role_txt is null then
    raise exception 'Rol de Membego no reconocido: %', coalesce(nullif(v_rol_in, ''), '(vacío)')
      using errcode = 'insufficient_privilege';
  end if;
  v_role := v_role_txt::app.user_role;

  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      lower(trim(p_email)), null,
      now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('membego_sub', p_sub), '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email)), 'email_verified', true),
      'email', now(), now(), now());
  end if;

  -- Perfil en la empresa del token. AL CAMBIAR DE EMPRESA, la sucursal cambia
  -- con él (a la principal de la nueva); en la misma empresa, la asignación
  -- local del operador no se toca. Sin esto, el trigger
  -- profiles_branch_belongs_to_company rechaza el cruce — con razón.
  -- Candado del guardia de alcance (0029): mismo patrón que create_employee.
  -- Local a la transacción; se limpia al terminar por higiene.
  perform set_config('app.branch_ctx', 'ok', true);
  update public.profiles p
     set company_id = v_company,
         role       = v_role,
         email      = lower(trim(p_email)),
         is_active  = true,
         branch_id  = case
           when p.company_id is distinct from v_company then (
             select b.id from public.branches b
             where b.company_id = v_company and b.is_main
             limit 1
           )
           else p.branch_id
         end
   where p.id = v_uid;
  perform set_config('app.branch_ctx', '', true);

  return v_uid;
end;
$$;

comment on function public.membego_sso_upsert_user is
  'SSO Membego con AUTO-VINCULACIÓN (20260812210000) cambio de sucursal al cruzar de empresa (20260812220000) y contexto app.branch_ctx declarado ante el guardia de alcance (20260812233000).';

revoke all on function public.membego_sso_upsert_user(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.membego_sso_upsert_user(text, text, text, text, text)
  to service_role;
