-- =============================================================================
-- 0016 · SSO saliente: entrar a Membego desde el car wash (car wash → Membego)
-- =============================================================================
-- El inverso de 0015. Aquí el usuario YA autenticado en el car wash pide un
-- "pase" para aterrizar logueado en su cuenta de Membego. El borde (Vercel)
-- llama esta función CON EL TOKEN DEL PROPIO USUARIO (no service_role), así
-- auth.uid() identifica a quien pulsa el botón, y luego firma el token de salida.
--
-- Devuelve lo que Membego necesita para abrir la sesión (contrato § SSO entrada):
--   · email     (respaldo; único en Membego, basta por sí solo)
--   · sub       (preferido; el mismo id que Membego nos dio al entrar, si existe)
--   · companyId (el companyId de Membego de la empresa del usuario)
-- No expone secretos: la firma HMAC la pone el borde con MEMBEGO_SECRETO.
-- =============================================================================

create or replace function public.membego_sso_saliente()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_sub     text;
  v_company uuid;
  v_membego text;
begin
  if v_uid is null then
    raise exception 'No hay sesión activa.' using errcode = 'insufficient_privilege';
  end if;

  -- Correo e id estable de Membego (si el usuario entró alguna vez por su SSO,
  -- 0015 guardó membego_sub en raw_user_meta_data). El dueño creado por bootstrap
  -- no tiene sub → se va por email, que Membego acepta como suficiente.
  select lower(u.email), nullif(u.raw_user_meta_data ->> 'membego_sub', '')
    into v_email, v_sub
    from auth.users u
   where u.id = v_uid;

  -- Empresa del usuario y su companyId de Membego.
  select p.company_id into v_company from public.profiles p where p.id = v_uid;
  if v_company is null then
    raise exception 'Tu usuario no tiene empresa asignada.' using errcode = 'insufficient_privilege';
  end if;

  select l.membego_company_id into v_membego
    from public.membego_company_links l
   where l.company_id = v_company and l.is_active;
  if v_membego is null then
    raise exception 'Tu empresa no está vinculada con Membego.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('email', v_email, 'companyId', v_membego, 'sub', v_sub);
end;
$$;

comment on function public.membego_sso_saliente is
  'SSO saliente: devuelve email/sub/companyId del usuario autenticado para que el '
  'borde firme el pase de entrada a Membego. La firma HMAC la pone el borde.';

-- La llama el usuario final (con su propio token), no la service_role.
grant execute on function public.membego_sso_saliente() to authenticated;
