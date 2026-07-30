-- =============================================================================
-- MEMBEGO CAR WASH — Bootstrap: tu empresa, tu sucursal y tu usuario propietario
-- =============================================================================
-- Ejecútalo UNA sola vez, DESPUÉS de haber aplicado membego_schema_completo.sql.
--
-- Por diseño de seguridad, un perfil nace SIN empresa y SIN rol (anti-escalada):
-- nadie se asigna a sí mismo a un tenant. Este script es el "primer empujón"
-- que sí puede hacerlo, porque el editor SQL corre como `postgres` (superusuario,
-- se salta RLS). Crea la empresa y la sucursal, y asciende tu perfil a
-- `propietario`, el rol de negocio más alto (gestiona empresa, usuarios y todo).
--
-- -----------------------------------------------------------------------------
-- PASO 1 · Crea tu usuario de acceso (correo + contraseña)
-- -----------------------------------------------------------------------------
-- La forma recomendada y a prueba de versiones es el panel de Supabase:
--
--     Authentication  →  Users  →  Add user
--       · Email:     el que uses para entrar
--       · Password:  tu contraseña
--       · MARCA  "Auto Confirm User"   (si no, no podrás iniciar sesión)
--
-- Al crearlo, un trigger de la base crea automáticamente tu perfil vacío.
--
-- ¿Prefieres NO usar el panel? Al final de este archivo hay un bloque OPCIONAL
-- (PASO 1-BIS) que crea el usuario por SQL. Úsalo solo si sabes lo que haces.
--
-- -----------------------------------------------------------------------------
-- PASO 2 · Edita los valores de abajo y pulsa "Run"
-- -----------------------------------------------------------------------------
-- Todo ocurre dentro de una transacción: o se crea todo, o no se crea nada.
-- Es idempotente: volver a ejecutarlo NO duplica la empresa (se identifica por
-- el RNC/tax_id) ni la sucursal; solo reafirma la asignación de tu perfil.
-- =============================================================================

do $bootstrap$
declare
  -- ╔═══════════════════════════════════════════════════════════════════════╗
  -- ║  EDITA ESTOS VALORES CON LOS DATOS REALES DE TU NEGOCIO                ║
  -- ╚═══════════════════════════════════════════════════════════════════════╝

  -- El correo EXACTO con el que creaste el usuario en el Paso 1.
  v_owner_email   text := 'starlin.eltanquemotors@gmail.com';
  v_owner_name    text := 'Starlin Paulino';          -- tu nombre completo

  -- Empresa
  v_trade_name    text := 'Membego Car Wash';         -- nombre comercial
  v_legal_name    text := 'Membego Car Wash, SRL';    -- razón social
  v_tax_id        text := '000000000';                -- RNC (identificador único de la empresa)
  v_currency      char(3) := 'DOP';
  v_currency_sym  text := 'RD$';
  v_timezone      text := 'America/Santo_Domingo';
  v_tax_rate_bps  integer := 1800;                    -- ITBIS 18,00 % en puntos base

  -- Sucursal principal
  v_branch_name   text := 'Sucursal Principal';
  v_branch_addr   text := null;                        -- p. ej. 'Av. Duarte #123, Santiago'
  v_branch_phone  text := null;                        -- p. ej. '809-555-0100'

  -- PIN de caja (opcional; 4-6 dígitos). Se guarda HASHEADO, nunca en claro.
  -- Déjalo en null si aún no lo usas.
  v_cash_pin      text := null;

  -- ── No hace falta tocar nada debajo de esta línea ──────────────────────────
  v_user_id    uuid;
  v_company_id uuid;
  v_branch_id  uuid;
begin
  -- 1) El usuario de acceso debe existir ya (Paso 1).
  select id into v_user_id
  from auth.users
  where lower(email) = lower(trim(v_owner_email))
  limit 1;

  if v_user_id is null then
    raise exception
      'No existe ningún usuario con el correo "%". Créalo primero en Authentication → Users → Add user (con "Auto Confirm User"), o usa el bloque opcional del Paso 1-BIS.',
      v_owner_email;
  end if;

  -- 2) Empresa: reutiliza la existente si ya tiene ese RNC (idempotencia).
  select id into v_company_id from public.companies where tax_id = trim(v_tax_id);

  if v_company_id is null then
    insert into public.companies
      (trade_name, legal_name, tax_id, currency, currency_symbol, timezone, tax_rate_bps)
    values
      (trim(v_trade_name), trim(v_legal_name), trim(v_tax_id),
       v_currency, v_currency_sym, v_timezone, v_tax_rate_bps)
    returning id into v_company_id;
    raise notice 'Empresa creada: % (%).', v_trade_name, v_company_id;
  else
    raise notice 'Empresa ya existente con RNC %, se reutiliza (%).', v_tax_id, v_company_id;
  end if;

  -- 3) Sucursal principal: una sola por empresa (índice único on is_main).
  select id into v_branch_id
  from public.branches
  where company_id = v_company_id and is_main;

  if v_branch_id is null then
    insert into public.branches (company_id, name, address, phone, is_main)
    values (v_company_id, trim(v_branch_name), v_branch_addr, v_branch_phone, true)
    returning id into v_branch_id;
    raise notice 'Sucursal principal creada: % (%).', v_branch_name, v_branch_id;
  else
    raise notice 'La empresa ya tenía sucursal principal, se reutiliza (%).', v_branch_id;
  end if;

  -- 4) Tu perfil: lo normal es que el trigger ya lo haya creado vacío al dar de
  --    alta el usuario. Si por lo que fuera no existe, lo creamos.
  insert into public.profiles (id, email, full_name)
  values (v_user_id, lower(trim(v_owner_email)), trim(v_owner_name))
  on conflict (id) do nothing;

  -- 5) Ascenso a propietario, con empresa y sucursal. Aquí es donde el perfil
  --    deja de estar "vacío" y pasa a ver y gobernar su tenant.
  update public.profiles
  set company_id     = v_company_id,
      branch_id      = v_branch_id,
      role           = 'propietario',
      full_name      = trim(v_owner_name),
      email          = lower(trim(v_owner_email)),
      is_active      = true,
      cash_pin_hash  = case
                         when v_cash_pin is null or trim(v_cash_pin) = '' then cash_pin_hash
                         else crypt(trim(v_cash_pin), gen_salt('bf'))
                       end
  where id = v_user_id;

  raise notice 'Perfil % ascendido a propietario de % en la sucursal %.',
    v_owner_email, v_trade_name, v_branch_name;
  raise notice 'Listo. Inicia sesión en la app con ese correo y contraseña.';
end
$bootstrap$;

-- Verificación: revisa que quedó todo enlazado.
select
  p.email,
  p.full_name,
  p.role,
  c.trade_name  as empresa,
  c.tax_id      as rnc,
  b.name        as sucursal,
  b.is_main     as es_principal,
  p.is_active   as activo
from public.profiles p
join public.companies c on c.id = p.company_id
join public.branches  b on b.id = p.branch_id
where lower(p.email) = lower('starlin.eltanquemotors@gmail.com');  -- ← mismo correo del bootstrap


-- =============================================================================
-- PASO 1-BIS (OPCIONAL) · Crear el usuario de acceso por SQL, sin el panel
-- =============================================================================
-- Solo si NO quieres usar Authentication → Add user. Descomenta el bloque,
-- pon correo y contraseña, ejecútalo, y LUEGO corre el bootstrap de arriba.
--
-- Nota: GoTrue gestiona el login sobre estas tablas; los nombres de columna han
-- sido estables por mucho tiempo, pero el panel es siempre la vía más segura.
-- Crea el usuario CONFIRMADO (puede entrar de inmediato) y su identidad `email`.
-- =============================================================================
/*
do $crear_usuario$
declare
  v_email    text := 'starlin.eltanquemotors@gmail.com';   -- ← tu correo
  v_password text := 'CAMBIA-ESTA-CLAVE';                   -- ← tu contraseña
  v_name     text := 'Starlin Paulino';                     -- ← tu nombre
  v_uid      uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where lower(email) = lower(v_email)) then
    raise notice 'Ya existe un usuario con el correo %, no se crea otro.', v_email;
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(trim(v_email)), crypt(v_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name),
    '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(trim(v_email)), 'email_verified', true),
    'email', now(), now(), now()
  );

  raise notice 'Usuario % creado y confirmado. Ahora ejecuta el bootstrap.', v_email;
end
$crear_usuario$;
*/
