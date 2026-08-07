-- =============================================================================
-- SSO Membego · pgcrypto alcanzable desde la función (search_path)
-- =============================================================================
-- SÍNTOMA: al entrar por el botón con una cuenta que NO existía todavía en este
-- sistema: «function gen_random_bytes(integer) does not exist» (42883).
--
-- CAUSA: `gen_random_bytes`, `crypt` y `gen_salt` son de pgcrypto, y en Supabase
-- pgcrypto vive en el esquema `extensions`, no en `public`. La función declara
-- `set search_path = public, pg_temp`, así que no las encuentra.
--
-- POR QUÉ NO SE VIO ANTES: ese código solo corre en la rama que CREA el usuario
-- (`if v_uid is null`). Con cuentas que ya existían en auth.users el SSO pasaba
-- de largo. El bug estaba desde la 20260729001500; el primer empleado nuevo que
-- entrara por SSO se lo iba a encontrar.
--
-- ARREGLO: añadir `extensions` al search_path. Se deja `public` primero (no
-- cambia la resolución de nada existente) y `pg_temp` al final, que es lo que
-- evita que un objeto temporal secuestre una llamada en una función SECURITY
-- DEFINER. Tolerante además a instalaciones donde pgcrypto esté en `public`.
--
-- Verificado contra PostgreSQL real con pgcrypto instalado en `extensions`:
-- antes reproduce el 42883 exacto; después crea el usuario nuevo, le asigna el
-- rol, y una segunda llamada con el mismo correo actualiza el rol sin recrear.
--
-- Idempotente (create or replace). Solo cambia la línea del search_path
-- respecto a la 20260807130000.
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
set search_path = public, extensions, pg_temp
as $$
declare
  v_company  uuid := app.membego_company(p_membego_company_id);
  v_rol_in   text := upper(trim(coalesce(p_rol, '')));
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

  -- Roles que EXISTEN en Membego pero no operan aquí: mensaje propio, para que
  -- no se confundan con un mapeo olvidado.
  if v_rol_in in ('CLIENTE', 'MARKETING') then
    raise exception 'El rol % de Membego no tiene acceso a este sistema.', v_rol_in
      using errcode = 'insufficient_privilege';
  end if;

  v_role_txt := case v_rol_in
    when 'SUPERADMIN'    then 'superadmin'
    when 'ADMINISTRADOR' then 'administrador'  -- nombre moderno
    when 'ADMIN_EMPRESA' then 'administrador'  -- legacy, mismo poder
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

  -- Perfil en la empresa del token, con el rol mapeado.
  update public.profiles
     set company_id = v_company, role = v_role, email = lower(trim(p_email)), is_active = true
   where id = v_uid;

  return v_uid;
end;
$$;

comment on function public.membego_sso_upsert_user is
  'SSO Membego: asegura el usuario local y su perfil en la empresa del token, con el rol mapeado (los 8 roles de equipo de Membego; CLIENTE y MARKETING sin acceso). La firma la verifica el borde.';

-- `create or replace` conserva los permisos, pero se reafirman por si la
-- función se recreara desde cero: nunca ejecutable por anon/PUBLIC.
revoke all on function public.membego_sso_upsert_user(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.membego_sso_upsert_user(text, text, text, text)
  to service_role;
