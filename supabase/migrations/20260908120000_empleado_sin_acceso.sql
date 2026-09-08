-- ============================================================================
-- EMPLEADO SIN ACCESO AL SISTEMA (el lavador)
-- ============================================================================
-- Un lavador no usa la aplicación: le entregan un papel, lava el carro y cobra
-- su comisión. Darle correo y contraseña para poder asignarle un trabajo es
-- pedirle al negocio que invente credenciales para gente que nunca va a entrar
-- —y cada credencial que existe es una que puede filtrarse—.
--
-- Hasta aquí no había alternativa: `profiles.id` era clave ajena de
-- `auth.users`, así que NO PODÍA existir una ficha de empleado sin una cuenta
-- detrás. Esta migración rompe esa exigencia sin mover nada más de sitio.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO UNA TABLA APARTE DE «LAVADORES»
--
-- Veintinueve tablas apuntan a `profiles`: las asignaciones de la orden, las
-- comisiones, la nómina, la bitácora. Una tabla paralela obligaría a que cada
-- una supiera de dos clases de persona, y el día que se olvide en una el
-- lavador trabajaría sin cobrar. Es la misma entidad —un empleado—; lo único
-- que cambia es si además tiene llave de la casa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LO QUE SE PIERDE AL QUITAR LA CLAVE AJENA, Y CÓMO SE REPONE
--
-- Esa clave traía `on delete cascade`: borrar la cuenta en el panel de Supabase
-- se llevaba la ficha. Sin ella quedaría una ficha huérfana de alguien que ya
-- no puede entrar. Se repone con un disparador explícito, que hace lo mismo y
-- además se lee.
-- ============================================================================

-- ------------------------------------------------- La ficha ya no exige cuenta
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- Repone el arrastre que daba la clave ajena.
create or replace function app.borrar_perfil_de_cuenta_borrada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.profiles where id = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function app.borrar_perfil_de_cuenta_borrada();

-- ------------------------------------------------------------ Quién tiene llave
-- `true` para todas las fichas que ya existen: todas nacieron de una cuenta.
alter table public.profiles
  add column if not exists has_login boolean not null default true;

comment on column public.profiles.has_login is
  'false = empleado registrado SIN cuenta (no puede entrar al sistema). Se le '
  'asignan trabajos y cobra comisiones igual, pero no tiene credencial.';

-- ============================================================================
-- public.create_staff_no_login · alta de empleado sin credencial
-- ============================================================================
-- Mismos candados que `create_employee` en cuanto a quién puede dar de alta y a
-- qué empresa va la ficha. La diferencia es el TECHO DE ROL, que aquí es mucho
-- más bajo a propósito: solo 'operario'.
--
-- Una ficha sin cuenta con un rol de mando no serviría para nada —nadie puede
-- entrar con ella— pero sí ensuciaría los recuentos que protegen a la empresa:
-- el candado que impide borrar al último administrador cuenta fichas, y un
-- administrador fantasma que no puede entrar haría creer que queda alguien al
-- mando cuando no queda nadie. Por eso lo que no puede entrar tampoco manda.
-- ============================================================================
create or replace function public.create_staff_no_login(
  p_full_name      text,
  p_role           app.user_role default 'operario',
  p_branch_id      uuid          default null,
  p_phone          text          default null,
  p_commission_bps integer       default null
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
  if v_company is null then
    raise exception 'No perteneces a ninguna empresa.' using errcode = 'check_violation';
  end if;
  if v_caller_role not in ('propietario', 'administrador', 'superadmin') then
    raise exception 'Tu rol no permite dar de alta empleados.' using errcode = 'insufficient_privilege';
  end if;

  -- Solo trabajo de patio: lo que no puede entrar, tampoco manda.
  if p_role <> 'operario' then
    raise exception 'Un empleado sin acceso solo puede ser operario (lavador).'
      using errcode = 'check_violation';
  end if;

  if length(trim(coalesce(p_full_name, ''))) < 3 then
    raise exception 'El nombre del empleado es obligatorio.' using errcode = 'check_violation';
  end if;

  if p_branch_id is not null
     and not exists (select 1 from public.branches
                     where id = p_branch_id and company_id = v_company) then
    raise exception 'La sucursal indicada no pertenece a tu empresa.' using errcode = 'check_violation';
  end if;

  -- Sin correo: no hay cuenta que confirmar ni credencial que filtrar. El
  -- campo queda nulo a propósito y no se inventa uno para rellenar el hueco.
  insert into public.profiles (
    id, company_id, branch_id, role, full_name, phone,
    email, commission_bps, is_active, has_login
  ) values (
    v_uid, v_company, p_branch_id, p_role, trim(p_full_name), p_phone,
    null, p_commission_bps, true, false
  )
  returning * into v_profile;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, p_branch_id, 'ALTA_EMPLEADO_SIN_ACCESO', 'Profile', v_uid::text,
          trim(p_full_name) || ' (' || p_role || ', sin acceso al sistema)');

  return v_profile;
end;
$$;

comment on function public.create_staff_no_login is
  'Alta de un empleado SIN cuenta (lavador): ficha para asignarle trabajo y '
  'pagarle comisiones, sin credencial de acceso. Solo rol operario.';

grant execute on function public.create_staff_no_login(text, app.user_role, uuid, text, integer)
  to authenticated;
