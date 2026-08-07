-- =============================================================================
-- SSO Membego · quitar la dependencia de pgcrypto al crear el usuario
-- =============================================================================
-- SÍNTOMA (persistente tras la 20260807140000): «function gen_random_bytes
-- (integer) does not exist» (42883) al entrar por SSO con una cuenta nueva.
--
-- CAUSA REAL: pgcrypto no está instalado en este proyecto. La corrección
-- anterior (añadir `extensions` al search_path) solo sirve si la extensión
-- EXISTE en algún esquema; comprobado contra PostgreSQL real: sin pgcrypto
-- instalado, ningún search_path puede resolver gen_random_bytes.
--
-- ARREGLO: dejar de necesitar pgcrypto. La contraseña que se generaba aquí era
-- aleatoria y NUNCA se usa —estos usuarios entran siempre por SSO (magic
-- link)—, así que su único propósito era rellenar la columna. Se pone
-- `encrypted_password = null`, que es como Supabase deja a los usuarios que
-- solo entran por proveedor externo.
--
-- Además es MÁS seguro: un hash bcrypt de una cadena aleatoria es un secreto
-- que hay que custodiar y que en teoría se puede atacar; `null` significa
-- literalmente «esta cuenta no tiene contraseña», y no hay nada que romper.
-- El SSO por magic link no toca esa columna.
--
-- `gen_random_uuid()` NO viene de pgcrypto: es del núcleo de PostgreSQL desde
-- la 13 (Supabase corre 15+), así que se conserva tal cual.
--
-- Se mantiene `extensions` en el search_path de la migración anterior: no
-- estorba, y deja la función preparada si algún día se instala pgcrypto.
--
-- Verificado contra PostgreSQL real CON pgcrypto desinstalado del todo: los 8
-- roles de equipo crean el usuario de cero y reciben su rol; CLIENTE,
-- MARKETING y un rol desconocido siguen rechazándose con su mensaje; una
-- segunda entrada del mismo correo actualiza el rol sin recrear; EXECUTE sigue
-- cerrado a anon. Idempotente (create or replace).
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
      lower(trim(p_email)), null,
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
