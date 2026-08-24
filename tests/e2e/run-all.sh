#!/usr/bin/env bash
# Corre TODAS las suites e2e de un tirón: levanta el proxy de Supabase y el
# servidor de previsualización, y ejecuta cada suite reconstruyendo la base
# antes de cada una (reset.sh) para que ninguna dependa del estado de otra.
#
# Prerrequisitos (los mismos del arnés local):
#   · PostgreSQL de prueba escuchando en el puerto 5433
#   · el binario de PostgREST en tests/e2e/ (lo descarga quien monta el arnés)
#   · Chromium en la ruta que las suites esperan
#
# Uso:  bash tests/e2e/run-all.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-http://127.0.0.1:3002}"
export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-clave-anon-de-pruebas}"

echo "· build con variables de e2e"
npm run build >/dev/null

echo "· proxy de Supabase (3002→3001)"
node tests/e2e/supabase-proxy.mjs >/tmp/e2e-proxy.log 2>&1 &
PROXY_PID=$!
echo "· servidor de previsualización (4174)"
npx vite preview --port 4174 --strictPort >/tmp/e2e-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill $PROXY_PID $PREVIEW_PID 2>/dev/null || true' EXIT

# Esperar a que el preview responda.
for _ in $(seq 1 20); do
  curl -sS --noproxy 127.0.0.1 -o /dev/null http://127.0.0.1:4174/ 2>/dev/null && break
  sleep 1
done

SUITES=(admin-views flujo-completo invoices pos-cash orders-kanban membego-canje)
fallos=0
for s in "${SUITES[@]}"; do
  echo "──────── $s"
  bash tests/e2e/reset.sh >/dev/null 2>&1
  if ! node "tests/e2e/$s.e2e.mjs"; then
    echo "FALLÓ: $s"
    fallos=$((fallos + 1))
  fi
done

echo "════════════════════════════════════════"
if [ "$fallos" -eq 0 ]; then
  echo "TODAS las suites e2e pasan."
else
  echo "$fallos suite(s) e2e fallaron."
fi
exit "$fallos"
