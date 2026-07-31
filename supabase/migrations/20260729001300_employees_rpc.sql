-- =============================================================================
-- 0013 · Alta de empleados desde la interfaz
-- =============================================================================
-- El propietario/administrador necesita crear los usuarios de su equipo (cajero,
-- lavador, supervisor, ...) sin entrar al panel de Supabase ni escribir SQL.
--
-- Crear un usuario de acceso para OTRA persona no se puede hacer con seguridad
-- desde el navegador: la API de administración de auth exige la service_role,
-- que jamás debe viajar al cliente. La vía correcta y verificable es esta
-- función SECURITY DEFINER, que:
--   * comprueba que quien llama es propietario/administrador de una empresa,
--   * aplica el techo de rol (nadie crea un rol por encima del suyo),
--   * fuerza el tenant al del llamante (no puede colar usuarios en otra empresa),
--   * crea el usuario de acceso confirmado y su identidad,
--   * completa el perfil con empresa, sucursal y rol.
-- =============================================================================

create or replace function public.create_employee(
  p_email          text,
  p_password       text,
  p_full_name      text,
  p_role           app.user_role,
  p_branch_id      uuid    default null,
  p_phone          text    default null,
  p_commission_bps integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company     uuid := app.current_company_id();
  v_caller_role app.user_role := app.current_role();
  v_uid         uuid := gen_random_uuid();
  v_profile     public.profiles;
begin
  -- 1. El llamante pertenece a una empresa y puede gestionar personal.
  if v_company is null then
    raise exception 'No perteneces a ninguna empresa.' using errcode = 'check_violation';
  end if;
  if v_caller_role not in ('propietario', 'administrador', 'superadmin') then
    raise exception 'Tu rol no permite dar de alta empleados.' using errcode = 'insufficient_privilege';
  end if;

  -- 2. Techo de rol: solo un propietario/superadmin puede crear otro.
  if p_role in ('propietario', 'superadmin')
     and v_caller_role not in ('propietario', 'superadmin') then
    raise exception 'No puedes crear un usuario con el rol %.', p_role using errcode = 'insufficient_privilege';
  end if;

  -- 3. La sucursal, si se indica, debe ser de la empresa del llamante.
  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.company_id = v_company
  ) then
    raise exception 'La sucursal indicada no pertenece a tu empresa.' using errcode = 'check_violation';
  end if;

  -- 4. Validaciones de credenciales.
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'Correo electrónico inválido.' using errcode = 'check_violation';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from auth.users where lower(email) = lower(trim(p_email))) then
    raise exception 'Ya existe un usuario con el correo %.', p_email using errcode = 'unique_violation';
  end if;

  -- 5. Usuario de acceso, confirmado (puede entrar de inmediato) y su identidad.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(trim(p_email)), crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name)),
    '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email)), 'email_verified', true),
    'email', now(), now(), now()
  );

  -- 6. El trigger on_auth_user_created creó el perfil vacío; lo completamos con
  --    el tenant del llamante, la sucursal y el rol.
  update public.profiles
  set company_id     = v_company,
      branch_id      = p_branch_id,
      role           = p_role,
      full_name      = trim(p_full_name),
      phone          = p_phone,
      email          = lower(trim(p_email)),
      commission_bps = p_commission_bps,
      is_active      = true
  where id = v_uid
  returning * into v_profile;

  -- 7. Bitácora (el actor lo sella el servidor por trigger).
  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ALTA_EMPLEADO', 'Profile', v_uid::text,
          trim(p_full_name) || ' (' || p_role || ')');

  return v_profile;
end;
$$;

comment on function public.create_employee is
  'Alta de empleado: crea el usuario de acceso y su perfil en la empresa del llamante. '
  'Solo propietario/administrador; aplica techo de rol y aislamiento de tenant.';

grant execute on function
  public.create_employee(text, text, text, app.user_role, uuid, text, integer)
  to authenticated;
