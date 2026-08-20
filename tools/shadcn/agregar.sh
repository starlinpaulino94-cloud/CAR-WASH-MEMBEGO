#!/usr/bin/env bash
# Añade componentes shadcn (estilo base-nova, preset b0) SIN acceso a ui.shadcn.com.
#
# En una máquina normal no hace falta esto: `npx shadcn@latest add botón` va
# directo al registro oficial. Este script existe porque el entorno remoto de
# Claude Code bloquea ese dominio; el registro se reconstruyó desde el código
# abierto (MIT) de github.com/shadcn-ui/ui y vive vendido en tools/shadcn.
#
# Uso: bash tools/shadcn/agregar.sh button dialog popover ...
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

RUTAS=()
for c in "$@"; do
  f="tools/shadcn/registro/$c.json"
  [ -f "$f" ] || { echo "No existe $f (¿el componente se llama así?)"; exit 1; }
  RUTAS+=("$f")
done

# Espejo mínimo para lo único que el CLI pide por red aparte de los items:
# /r/colors/<baseColor>.json. Se sirve local y se apaga al salir.
python3 -m http.server 4123 --bind 127.0.0.1 --directory "$HERE/mirror" >/dev/null 2>&1 &
MIRROR_PID=$!
trap 'kill $MIRROR_PID 2>/dev/null || true' EXIT
sleep 1

REGISTRY_URL=http://127.0.0.1:4123/r NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  npx -y shadcn@4.17.0 add "${RUTAS[@]}" -y
