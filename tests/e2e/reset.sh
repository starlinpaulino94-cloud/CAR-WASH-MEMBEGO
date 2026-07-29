#!/usr/bin/env bash
# Reconstruye la base del ensayo: migraciones + datos de partida, y arranca PostgREST.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGPORT:-5433}"
PSQL=(psql -h /tmp -p "$PORT" -U postgres)

pkill -f postgrest 2>/dev/null || true
sleep 1
"${PSQL[@]}" -tAc "select pg_terminate_backend(pid) from pg_stat_activity where datname='membego_e2e';" >/dev/null 2>&1 || true
"${PSQL[@]}" -tAc "drop database if exists membego_e2e;" >/dev/null
"${PSQL[@]}" -tAc "create database membego_e2e;" >/dev/null
"${PSQL[@]}" -d membego_e2e -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d membego_e2e -v ON_ERROR_STOP=1 -q -f "$f"
done
"${PSQL[@]}" -d membego_e2e -v ON_ERROR_STOP=1 -q -f "$HERE/seed.sql"

if [ -x "$HERE/postgrest" ]; then
  (cd "$HERE" && ./postgrest postgrest.conf > postgrest.log 2>&1 &)
  sleep 4
  curl -s -o /dev/null -w "base lista · PostgREST HTTP %{http_code}\n" http://127.0.0.1:3001/
else
  echo "base lista. Descargue el binario de PostgREST en $HERE para el ensayo completo."
fi
