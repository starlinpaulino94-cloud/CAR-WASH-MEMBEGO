-- =============================================================================
-- SSO Membego · AUTO-VINCULACIÓN: el sistema es para TODO el vertical car wash
-- =============================================================================
-- SÍNTOMA: entrar por SSO desde cualquier empresa de Membego que no sea la
-- fundadora respondía «La empresa de Membego (…) no está vinculada en este
-- sistema» (42501). La tabla de vínculos solo conocía a una empresa.
--
-- DECISIÓN DE PRODUCTO (12-08-2026, dueño de la plataforma): este sistema debe
-- estar disponible para TODAS las empresas de la categoría car wash de
-- Membego, no para una lista blanca sembrada a mano.
--
-- POR QUÉ AUTO-VINCULAR ES SEGURO AQUÍ: llegar a esta función ya exige un
-- token firmado con el secreto compartido (verificado en el borde) y la RPC
-- solo es ejecutable por service_role. Y Membego NO despacha el SSO a
-- cualquiera: su registro (`decidirAcceso`) solo lo ofrece a empresas con el
-- sistema habilitado para su vertical. La firma ES la autorización; mantener
-- además una lista blanca local era pedir el mismo permiso dos veces — y la
-- segunda copia siempre se olvida.
--
-- LO QUE NO CAMBIA: un vínculo DESACTIVADO a mano (is_active = false) se
-- sigue rechazando — desactivar es una decisión deliberada del operador y la
-- auto-vinculación no debe resucitarla. Solo se crea empresa cuando NO HAY
-- fila de vínculo en absoluto.
--
-- La empresa local nace mínima y activa: nombre real si el token lo trae
-- (claim `companyName`, opcional), sucursal principal, y un `tax_id` marcador
-- (la columna es NOT NULL UNIQUE; el RNC real lo pone su administrador en
-- Configuración). El catálogo de servicios lo configura cada empresa dentro.
--
-- Idempotente (create or replace + drop condicional de la firma vieja). La
-- carrera de dos SSO simultáneos la resuelve el unique(membego_company_id):
-- el segundo relee el vínculo que ganó el primero.
-- =============================================================================

-- La firma cambia (parámetro nuevo con default): se retira la de 4 argumentos
-- para que PostgREST no encuentre dos candidatas y falle por ambigüedad.
drop function if exists public.membego_sso_upsert_user(text, text, text, text);

create or replace function public.membego_sso_upsert_user(
  p_membego_company_id text,
  p_sub                text,   -- id estable del usuario en Membego
  p_email              text,
  p_rol                text,
  p_company_name       text default null  -- nombre real para la auto-vinculación
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
  -- Vínculo existente, activo o no. La distinción importa: sin fila se
  -- auto-vincula; con fila desactivada se rechaza (decisión del operador).
  select company_id, is_active into v_company, v_link_activa
  from public.membego_company_links
  where membego_company_id = p_membego_company_id;

  if v_company is not null and not v_link_activa then
    raise exception 'La empresa de Membego (%) está desactivada en este sistema.', p_membego_company_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_company is null then
    -- AUTO-VINCULACIÓN: primera visita de esta empresa. Nace mínima y activa.
    v_nombre := coalesce(
      nullif(trim(p_company_name), ''),
      'Car Wash ' || right(p_membego_company_id, 6)
    );
    begin
      insert into public.companies (trade_name, legal_name, tax_id)
      values (
        v_nombre,
        v_nombre,
        -- tax_id es NOT NULL UNIQUE: marcador derivado del id de Membego
        -- (único por construcción) hasta que el administrador ponga su RNC.
        'MBGO-' || p_membego_company_id
      )
      returning id into v_company;

      insert into public.membego_company_links (company_id, membego_company_id, is_active)
      values (v_company, p_membego_company_id, true);

      -- La operación (cola, caja, reportes) asume una sucursal principal.
      insert into public.branches (company_id, name, is_main)
      values (v_company, 'Sucursal principal', true);
    exception when unique_violation then
      -- Otro SSO simultáneo ganó la carrera: usar el vínculo que dejó.
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

  -- El usuario se enlaza por correo (identidad de Membego). Si no existe, se
  -- crea sin contraseña: entra siempre por SSO (magic link).
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
  'SSO Membego con AUTO-VINCULACIÓN: si la empresa del token no existe aquí, se crea (nombre del claim companyName o marcador) y se vincula activa — la firma del Core es la autorización. Un vínculo desactivado a mano se sigue rechazando. Asegura el usuario local y su perfil con el rol mapeado.';

revoke all on function public.membego_sso_upsert_user(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.membego_sso_upsert_user(text, text, text, text, text)
  to service_role;
