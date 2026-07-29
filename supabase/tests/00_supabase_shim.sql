-- Shim local del entorno que Supabase provee de fábrica.
-- NO forma parte de las migraciones: existe solo para validar el esquema y las
-- políticas RLS en un PostgreSQL limpio.

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text unique,
  raw_user_meta_data    jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

-- En Supabase auth.uid() lee el claim `sub` del JWT. Localmente lo simulamos
-- con una variable de sesión, que es exactamente lo que hace PostgREST.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;
