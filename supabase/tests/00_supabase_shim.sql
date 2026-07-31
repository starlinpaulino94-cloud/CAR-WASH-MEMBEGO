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

-- Modela las columnas de GoTrue que usa el alta de empleados (create_employee).
-- En Supabase real ya existen; aquí las reproducimos para poder probar en local.
create table auth.users (
  instance_id            uuid default '00000000-0000-0000-0000-000000000000',
  id                     uuid primary key default gen_random_uuid(),
  aud                    varchar(255) default 'authenticated',
  role                   varchar(255) default 'authenticated',
  email                  text unique,
  encrypted_password     varchar(255),
  email_confirmed_at     timestamptz,
  raw_app_meta_data      jsonb not null default '{}'::jsonb,
  raw_user_meta_data     jsonb not null default '{}'::jsonb,
  confirmation_token     varchar(255) default '',
  recovery_token         varchar(255) default '',
  email_change           varchar(255) default '',
  email_change_token_new varchar(255) default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table auth.identities (
  provider_id     text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (provider, provider_id)
);

-- En Supabase auth.uid() lee el claim `sub` del JWT. Localmente lo simulamos
-- con una variable de sesión, que es exactamente lo que hace PostgREST.
-- Definición equivalente a la real de Supabase: acepta tanto el claim suelto
-- (que usan las pruebas SQL) como el JSON completo que inyecta PostgREST.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Rol de conexión de PostgREST: no tiene privilegios propios, solo puede
-- cambiar a anon o authenticated según el JWT. Igual que en Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login noinherit password 'authpass';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
