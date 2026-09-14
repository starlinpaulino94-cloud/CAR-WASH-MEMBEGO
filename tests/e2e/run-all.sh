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
# `--host 127.0.0.1` explícito, no el `localhost` que pone Vite por defecto.
# Vite pide a Node resolución «verbatim», así que en una máquina donde
# /etc/hosts tiene además `::1 localhost` —los ejecutores de GitHub— el
# servidor puede quedarse escuchando SOLO en IPv6 mientras las suites navegan a
# http://127.0.0.1:4174/. El proxy de aquí al lado ya ata 127.0.0.1 a mano; esto
# lo iguala.
npx vite preview --host 127.0.0.1 --port 4174 --strictPort >/tmp/e2e-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill $PROXY_PID $PREVIEW_PID 2>/dev/null || true' EXIT

# Esperar a que el preview responda.
listo=0
for _ in $(seq 1 20); do
  curl -sS --noproxy 127.0.0.1 -o /dev/null http://127.0.0.1:4174/ 2>/dev/null && { listo=1; break; }
  sleep 1
done

# Si el preview no llegó a levantar, PARAR AQUÍ.
#
# Antes se seguía igual y las siete suites fallaban con el mismo
# ERR_CONNECTION_REFUSED: siete rastros idénticos que parecen siete problemas y
# no son ninguno, y la causa real —que Vite no arrancó, y por qué— se quedaba en
# un registro que nadie miraba. Un arnés que no puede probar tiene que decir que
# no puede probar, no inventar siete fallos.
if [ "$listo" -ne 1 ]; then
  echo "════════════════════════════════════════"
  echo "El servidor de previsualización no respondió en 127.0.0.1:4174 tras 20s."
  echo "No se corre ninguna suite: sin pantalla no hay nada que probar."
  echo "──────── /tmp/e2e-preview.log"
  cat /tmp/e2e-preview.log 2>/dev/null || echo "(sin registro)"
  echo "──────── /tmp/e2e-proxy.log"
  cat /tmp/e2e-proxy.log 2>/dev/null || echo "(sin registro)"
  exit 1
fi

SUITES=(admin-views flujo-completo invoices pos-cash orders-kanban membego-canje responsive)
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
