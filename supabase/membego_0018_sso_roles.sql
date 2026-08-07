-- =============================================================================
-- 0018 · PARCHE (editor SQL Supabase) · SSO de entrada: rol no reconocido → 403
-- =============================================================================
-- Ejecuta este script COMPLETO en el editor SQL de Supabase (Production).
-- Idempotente (create or replace). Arregla el 500 con roles de plataforma:
--   · SUPERADMIN  -> superadmin (rol máximo, acotado al tenant)
--   · rol NO reconocido -> se rechaza limpio (el borde responde 403, no 500)
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
  v_company  uuid := app.membego_company(p_membego_company_id);
  v_role_txt text;
  v_role     app.user_role;
  v_uid      uuid;
begin
  if v_company is null then
    raise exception 'La empresa de Membego (%) no está vinculada en este sistema.', p_membego_company_id
      using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'El token de Membego no trae un correo válido.' using errcode = 'check_violation';
  end if;

  -- SUPERADMIN es el dueño de la plataforma → nuestro rol máximo (superadmin, que
  -- aquí sigue acotado al tenant por belongs_to_tenant; no cruza empresas).
  -- Un rol que NO reconocemos NO se degrada en silencio: se rechaza limpio
  -- (insufficient_privilege → el borde responde 403, no 500) para no adivinar
  -- permisos de un rol que no entendemos.
  v_role_txt := case upper(coalesce(p_rol, ''))
    when 'ADMIN_EMPRESA' then 'administrador'
    when 'GERENTE'       then 'supervisor'
    when 'RECEPCION'     then 'recepcionista'
    when 'EMPLEADO'      then 'operario'
    when 'SUPERADMIN'    then 'superadmin'
    else null
  end;
  if v_role_txt is null then
    raise exception 'Rol de Membego no reconocido: %', coalesce(p_rol, '(vacío)')
      using errcode = 'insufficient_privilege';
  end if;
  v_role := v_role_txt::app.user_role;

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
