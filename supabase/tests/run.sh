#!/usr/bin/env bash
# Verifica el esquema y las políticas RLS contra un PostgreSQL limpio.
# No requiere Docker ni conexión al proyecto alojado.
#
# Uso:  supabase/tests/run.sh [puerto]
set -euo pipefail

PORT="${1:-5433}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL=(psql -h "${PGHOST:-/tmp}" -p "$PORT" -U postgres)

command -v psql >/dev/null || { echo "psql no está instalado"; exit 1; }
"${PSQL[@]}" -tAc "select 1" >/dev/null 2>&1 || {
  echo "No hay PostgreSQL escuchando en el puerto $PORT."
  echo "Arránquelo con:  pg_ctl -D <datadir> -o '-p $PORT -k /tmp' start"
  exit 1
}

"${PSQL[@]}" -tAc "drop database if exists membego_test;" >/dev/null
"${PSQL[@]}" -tAc "create database membego_test;" >/dev/null
"${PSQL[@]}" -d membego_test -v ON_ERROR_STOP=1 -q -f "$HERE/00_supabase_shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d membego_test -v ON_ERROR_STOP=1 -q -f "$f" \
    || { echo "FALLO al aplicar $(basename "$f")"; exit 1; }
done

# El prefijo admite letras además de dígitos: la numeración pasó de 99 y
# seguir con A0, A1… mantiene el orden alfabético, que es el de ejecución.
for t in "$HERE"/[0-9A-Z][0-9A-Z]_*tests*.sql; do
  "${PSQL[@]}" -d membego_test -q -f "$t" >/dev/null 2>&1 || true
done

"${PSQL[@]}" -d membego_test -tAF'|' -c \
  "select case when passed then 'PASA ' else 'FALLA' end, name, coalesce(nullif(detail,''),'')
     from test.results order by id;" \
  | awk -F'|' '{printf "  %s  %s%s\n", $1, $2, ($3!=""?"  ["$3"]":"")}'

echo
"${PSQL[@]}" -d membego_test -tAc \
  "select count(*) filter (where passed) || '/' || count(*) || ' comprobaciones pasan' from test.results;"

FAILED=$("${PSQL[@]}" -d membego_test -tAc "select count(*) from test.results where not passed;")
[ "$FAILED" = "0" ] || { echo "FALLOS: $FAILED"; exit 1; }
