-- =============================================================================
-- 0015 · SSO de empleados desde Membego
-- =============================================================================
-- Membego redirige al empleado a /sso/membego con un token firmado (HMAC, vence
-- en 90 s). La función serverless verifica la firma (en el borde) y llama a esta
-- función con la service_role para asegurar el usuario local y su perfil en la
-- empresa del token, con el rol mapeado. Luego el borde acuña la sesión de
-- Supabase (magic link) y redirige al panel.
--
-- Roles Membego → roles del car wash:
--   ADMIN_EMPRESA → administrador   GERENTE   → supervisor
--   RECEPCION     → recepcionista   EMPLEADO  → operario
--   SUPERADMIN    → superadmin      (otro)    → operario
-- =============================================================================

create or replace function public.membego_sso_upsert_user(
  p_membego_company_id text,
  p_sub                text,   -- id estable del usuario en Membego
  p_email              text,
  p_rol                text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.membego_company(p_membego_company_id);
  v_role    app.user_role;
  v_uid     uuid;
begin
  if v_company is null then
    raise exception 'La empresa de Membego (%) no está vinculada en este sistema.', p_membego_company_id
      using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'El token de Membego no trae un correo válido.' using errcode = 'check_violation';
  end if;

  v_role := case upper(coalesce(p_rol, ''))
    when 'ADMIN_EMPRESA' then 'administrador'
    when 'GERENTE'       then 'supervisor'
    when 'RECEPCION'     then 'recepcionista'
    when 'EMPLEADO'      then 'operario'
    when 'SUPERADMIN'    then 'superadmin'
    else 'operario'
  end::app.user_role;

  -- El usuario se enlaza por correo (identidad de Membego). Si no existe, se crea
  -- con clave aleatoria: nunca la usa, entra siempre por SSO (magic link).
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      lower(trim(p_email)), crypt(encode(gen_random_bytes(18), 'hex'), gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('membego_sub', p_sub), '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email)), 'email_verified', true),
      'email', now(), now(), now());
  end if;

  -- Perfil en la empresa del token, con el rol mapeado. El trigger de alta ya
  -- creó el perfil vacío si el usuario es nuevo; aquí lo completamos/actualizamos.
  update public.profiles
     set company_id = v_company, role = v_role, email = lower(trim(p_email)), is_active = true
   where id = v_uid;

  return v_uid;
end;
$$;

comment on function public.membego_sso_upsert_user is
  'SSO Membego: asegura el usuario local y su perfil en la empresa del token, con el rol mapeado. La verifica la firma el borde.';

grant execute on function public.membego_sso_upsert_user(text, text, text, text) to service_role;
