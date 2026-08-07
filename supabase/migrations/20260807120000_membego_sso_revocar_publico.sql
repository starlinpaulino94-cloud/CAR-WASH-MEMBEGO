-- SEGURIDAD · las RPC del SSO dejan de ser ejecutables por PUBLIC/anon.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUÉ PASÓ (y por qué no se vio antes)
--
-- PostgreSQL concede EXECUTE a PUBLIC por DEFECTO en cada función nueva. El
-- `revoke all on all functions in schema public from anon` del esquema base
-- corrió ANTES de que estas dos funciones existieran, así que no las alcanzó:
-- un REVOKE solo afecta a lo que ya existe, no a lo que se cree después.
--
-- Resultado comprobado en producción con pg_proc.proacl:
--   membego_sso_upsert_user → =X/postgres, anon=X/postgres, authenticated=X/…
--   membego_sso_saliente    → =X/postgres, anon=X/postgres, authenticated=X/…
--
-- POR QUÉ IMPORTA
--
-- `membego_sso_upsert_user` es SECURITY DEFINER y crea filas en auth.users y
-- asigna company_id + role en profiles. Es la pieza que el borde llama SOLO
-- después de verificar la firma HMAC del token de Membego. Con EXECUTE
-- abierto a `anon` —y la clave anon viaja en el bundle del navegador, es
-- pública por diseño— cualquiera podía llamarla directamente y saltarse la
-- verificación de firma por completo: crear un usuario con el correo que
-- quisiera y asignarse un rol en una empresa vinculada.
--
-- Las validaciones internas (empresa vinculada, correo con @, rol reconocido)
-- limitan el daño pero NO lo impiden: son comprobaciones de forma, no de
-- autorización. La autorización era, y vuelve a ser, el grant.
--
-- `membego_sso_saliente` es menos grave (devuelve la identidad de auth.uid(),
-- que para anon es nula), pero se acota igual: solo `authenticated`.
--
-- Idempotente: se puede correr varias veces.

revoke all on function public.membego_sso_upsert_user(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.membego_sso_upsert_user(text, text, text, text)
  to service_role;

revoke all on function public.membego_sso_saliente()
  from public, anon;
grant execute on function public.membego_sso_saliente()
  to authenticated;

-- Que no vuelva a pasar con las funciones FUTURAS de este esquema: por
-- defecto, nada de lo que se cree de aquí en adelante nace ejecutable por
-- anon. Cada función nueva tendrá que conceder su acceso a propósito.
alter default privileges in schema public revoke execute on functions from anon;

-- Centinela: ninguna de las dos debe seguir teniendo PUBLIC (=X) ni anon.
do $$
declare
  v_abiertas int;
begin
  select count(*) into v_abiertas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('membego_sso_upsert_user', 'membego_sso_saliente')
    and (
      array_to_string(p.proacl, ',') like '%anon=X%'
      or array_to_string(p.proacl, ',') like '%,=X%'
      or array_to_string(p.proacl, ',') like '=X%'
    );
  if v_abiertas > 0 then
    raise exception 'Quedan % función(es) del SSO ejecutables por anon/PUBLIC', v_abiertas;
  end if;
  raise notice 'SSO: EXECUTE acotado (upsert → service_role, saliente → authenticated).';
end $$;
