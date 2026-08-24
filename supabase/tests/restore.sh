#!/usr/bin/env bash
# Prueba de RESTAURACIÓN real (Fase 25 de la auditoría).
#
# "Un backup no vale nada si nunca hemos probado restaurarlo." Esto no prueba el
# backup de Supabase de producción —eso es del dueño, ver DISASTER_RECOVERY.md—
# sino el MECANISMO: que un volcado (pg_dump) de una base poblada se restaura en
# una base limpia sin perder esquema, datos, RLS, funciones ni índices. Si el
# mecanismo falla aquí, fallaría también en producción.
#
# Habla por PGHOST (socket local por defecto, TCP en CI).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGPORT:-5433}"
HOST="${PGHOST:-/tmp}"
ORIGEN=membego_restore_src
DESTINO=membego_restore_dst
DUMP=/tmp/membego_restore.dump
PSQL=(psql -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
Q=(psql -h "$HOST" -p "$PORT" -U postgres -tA)

fallos=0
paso() { echo "  PASA   $1"; }
fallo() { echo "  FALLA  $1"; fallos=$((fallos + 1)); }

echo "· 1) construyendo base ORIGEN (migraciones + datos)"
"${PSQL[@]}" -tAc "drop database if exists $ORIGEN;" postgres >/dev/null
"${PSQL[@]}" -tAc "create database $ORIGEN;" postgres >/dev/null
"${PSQL[@]}" -d "$ORIGEN" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$ORIGEN" -f "$f" >/dev/null 2>&1 || { echo "FALLO migración $(basename "$f")"; exit 1; }
done
"${PSQL[@]}" -d "$ORIGEN" -f "$ROOT/tests/e2e/seed.sql" >/dev/null 2>&1

# Datos conocidos para que la prueba de restauración de DATOS no sea trivial
# (0=0 pasaría sin probar nada). Se insertan como postgres, saltando RLS.
"${PSQL[@]}" -d "$ORIGEN" >/dev/null 2>&1 <<SQL
select set_config('app.branch_ctx','ok',true);
insert into public.customers (company_id, branch_id, name, phone, origin)
select '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
       'Cliente Restore '||g, '809-555-90'||g, 'carwash'
from generate_series(1,7) g;
SQL

# Cifras de referencia ANTES del respaldo.
TABLAS=$("${Q[@]}"  -d "$ORIGEN" -c "select count(*) from pg_tables where schemaname='public'")
POLIT=$("${Q[@]}"   -d "$ORIGEN" -c "select count(*) from pg_policies where schemaname='public'")
FUNC=$("${Q[@]}"    -d "$ORIGEN" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public')")
INDICES=$("${Q[@]}" -d "$ORIGEN" -c "select count(*) from pg_indexes where schemaname='public'")
CLIENTES=$("${Q[@]}" -d "$ORIGEN" -c "select count(*) from public.customers")

echo "· 2) respaldando (pg_dump formato custom)"
pg_dump -h "$HOST" -p "$PORT" -U postgres -Fc -f "$DUMP" "$ORIGEN" 2>/dev/null || { echo "pg_dump falló"; exit 1; }
[ -s "$DUMP" ] && paso "el respaldo se genera y no está vacío  [$(du -h "$DUMP" | cut -f1)]" \
                || fallo "el respaldo salió vacío"

echo "· 3) restaurando en base DESTINO limpia (simula «la base desapareció»)"
"${PSQL[@]}" -tAc "drop database if exists $DESTINO;" postgres >/dev/null
"${PSQL[@]}" -tAc "create database $DESTINO;" postgres >/dev/null
# Los roles (authenticated, service_role, anon) los crea el shim; en un restore
# real de Supabase ya existen. Aquí se siembran antes de restaurar los GRANTs.
"${PSQL[@]}" -d "$DESTINO" -c "$(grep -iE 'create role|do \$\$' "$HERE/00_supabase_shim.sql" >/dev/null 2>&1 && true)" >/dev/null 2>&1 || true
"${PSQL[@]}" -d "$DESTINO" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1
# pg_restore sobre la base ya con shim: --clean --if-exists para no chocar con
# los objetos del shim; --no-owner porque los roles de Supabase difieren.
pg_restore -h "$HOST" -p "$PORT" -U postgres -d "$DESTINO" --no-owner --clean --if-exists "$DUMP" >/dev/null 2>&1 || true

# Cifras DESPUÉS de restaurar: deben cuadrar con el origen.
R_TABLAS=$("${Q[@]}"  -d "$DESTINO" -c "select count(*) from pg_tables where schemaname='public'")
R_POLIT=$("${Q[@]}"   -d "$DESTINO" -c "select count(*) from pg_policies where schemaname='public'")
R_FUNC=$("${Q[@]}"    -d "$DESTINO" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public')")
R_INDICES=$("${Q[@]}" -d "$DESTINO" -c "select count(*) from pg_indexes where schemaname='public'")
R_CLIENTES=$("${Q[@]}" -d "$DESTINO" -c "select count(*) from public.customers")

echo "· 4) verificando que el destino es idéntico al origen"
[ "$R_TABLAS" = "$TABLAS" ]   && paso "las $TABLAS tablas se restauran"          || fallo "tablas: origen=$TABLAS destino=$R_TABLAS"
[ "$R_POLIT" = "$POLIT" ]     && paso "las $POLIT políticas RLS se restauran"    || fallo "políticas: origen=$POLIT destino=$R_POLIT"
[ "$R_FUNC" = "$FUNC" ]       && paso "las $FUNC funciones se restauran"         || fallo "funciones: origen=$FUNC destino=$R_FUNC"
[ "$R_INDICES" = "$INDICES" ] && paso "los $INDICES índices se restauran"        || fallo "índices: origen=$INDICES destino=$R_INDICES"
[ "$R_CLIENTES" = "$CLIENTES" ] && paso "los datos se restauran (clientes=$CLIENTES)" || fallo "datos: origen=$CLIENTES destino=$R_CLIENTES"

# La RLS sigue FORZADA tras el restore (no se pierde el candado de seguridad).
R_FORCE=$("${Q[@]}" -d "$DESTINO" -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity")
[ "$R_FORCE" = "0" ] && paso "la RLS sigue ENABLE+FORCE tras restaurar (0 tablas sin forzar)" \
                     || fallo "$R_FORCE tablas quedaron sin FORCE tras el restore"

echo "════════════════════════════════════════"
if [ "$fallos" -eq 0 ]; then
  echo "RESTAURACIÓN: el mecanismo funciona. Origen y destino coinciden."
else
  echo "RESTAURACIÓN: $fallos comprobación(es) fallaron."
fi
"${PSQL[@]}" -tAc "drop database if exists $ORIGEN;" postgres >/dev/null 2>&1
"${PSQL[@]}" -tAc "drop database if exists $DESTINO;" postgres >/dev/null 2>&1
rm -f "$DUMP"
exit "$fallos"
