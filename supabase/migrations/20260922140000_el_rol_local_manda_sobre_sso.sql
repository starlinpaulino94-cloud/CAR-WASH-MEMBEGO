-- =============================================================================
-- EL ROL QUE PONE EL CAR WASH MANDA SOBRE EL QUE MANDA MEMBEGO
--
-- SÍNTOMA, EN PALABRAS DEL DUEÑO: «cuando le doy acceso a un usuario como
-- administrador, pasado un tiempo se le quita ese rol y vuelve a cajero».
--
-- No era el tiempo. Era el enlace de Membego. `membego_sso_upsert_user`
-- reescribía `role` en CADA entrada con lo que trajera el token:
--
--   rol al entrar por Membego la primera vez: cajero
--   rol tras ascenderlo en el car wash:       administrador
--   rol tras volver a entrar por Membego:     cajero   ← nadie tocó nada
--
-- Y lo hacía en silencio: ni un aviso, ni una línea en la bitácora. El dueño
-- asignaba el rol, la pantalla decía que sí, y días después el permiso ya no
-- estaba. Un sistema que deshace por su cuenta lo que le mandaron y no lo
-- cuenta es peor que uno que se niega.
--
-- LA REGLA NUEVA
--
-- Membego decide el rol la PRIMERA vez que la persona aparece: es como
-- consigue entrar, y hasta ese momento el car wash no sabe nada de ella. En
-- cuanto alguien de la empresa le fija un rol aquí, ese rol es el bueno y el
-- SSO deja de tocarlo. El car wash es quien responde por lo que su gente puede
-- hacer dentro del car wash.
--
-- CÓMO SE SABE CUÁL ES CUÁL
--
-- Una columna, `role_set_locally`, y un trigger que la enciende cuando el rol
-- cambia SIN el contexto del SSO. Se hace con un trigger y no parcheando cada
-- sitio que cambia roles —la pantalla de Personal escribe la tabla directa, y
-- mañana habrá otro— porque una lista de sitios que mantener a mano se queda
-- desfasada en el primer camino nuevo, y entonces el rol se vuelve a perder
-- por un agujero que nadie recuerda. Mismo patrón que `app.branch_ctx` y
-- `app.inventory_ctx`, que ya guardan otras dos puertas.
--
-- LO QUE SE ARRASTRA
--
-- Todos los perfiles que hoy tienen rol quedan marcados como fijados aquí. Lo
-- que hay ahora en el sistema es lo que el dueño ha ido curando, y esa es la
-- verdad que hay que dejar de pisar. Quien llegue nuevo sigue estrenando el rol
-- que diga Membego.
--
-- Y EL ACCESO, QUE ES LA OTRA MITAD
--
-- El mismo update forzaba `is_active = true` en cada entrada. O sea que echar a
-- alguien desde Personal no servía de nada: volvía a entrar por el enlace de
-- Membego y se reactivaba solo. Un empleado despedido recuperando el acceso con
-- un clic es peor que el rol, así que el SSO deja de reactivar perfiles
-- existentes. Los nuevos siguen naciendo activos, que es el valor por defecto
-- de la tabla.
--
-- Membego NO pierde la potestad de cerrar el acceso: sin token de Membego no se
-- entra por aquí, y una empresa desvinculada sigue rechazándose más arriba.
-- =============================================================================

alter table public.profiles
  add column if not exists role_set_locally boolean not null default false;

comment on column public.profiles.role_set_locally is
  'true cuando el rol lo fijó alguien del car wash. Mientras lo sea, el SSO de '
  'Membego no lo reescribe. Lo enciende el trigger profiles_role_origin.';

-- Lo que ya existe queda fijado: es lo que el operador ha curado.
update public.profiles set role_set_locally = true where role is not null;

-- ------------------------------------------------------ Quién cambió el rol
create or replace function app.profiles_role_origin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- El SSO declara su contexto antes de escribir; cualquier otro cambio de rol
  -- viene de dentro del car wash y se marca como propio.
  if new.role is distinct from old.role
     and coalesce(current_setting('app.sso_ctx', true), '') <> 'ok' then
    new.role_set_locally := true;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_origin on public.profiles;
create trigger profiles_role_origin
  before update of role on public.profiles
  for each row execute function app.profiles_role_origin();

-- --------------------------------------------------------------- El SSO
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
  -- `app.sso_ctx` avisa al trigger del rol de que este cambio viene de fuera y
  -- NO debe marcarse como decisión del car wash.
  -- Los dos son locales a la transacción; se limpian al terminar por higiene.
  perform set_config('app.branch_ctx', 'ok', true);
  perform set_config('app.sso_ctx', 'ok', true);
  update public.profiles p
     set company_id = v_company,
         -- El rol de Membego solo estrena. Si aquí ya se decidió, aquí manda.
         role       = case when p.role_set_locally then p.role else v_role end,
         email      = lower(trim(p_email)),
         -- `is_active` NO se toca: si al empleado lo dieron de baja en el car
         -- wash, entrar por Membego no puede devolverle el acceso.
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
  perform set_config('app.sso_ctx', '', true);

  return v_uid;
end;
$$;

comment on function public.membego_sso_upsert_user is
  'SSO Membego. El rol de Membego solo se aplica la primera vez: si el car '
  'wash ya fijó uno (profiles.role_set_locally), ese manda. Tampoco reactiva '
  'perfiles dados de baja aquí.';

revoke all on function public.membego_sso_upsert_user(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.membego_sso_upsert_user(text, text, text, text, text)
  to service_role;
