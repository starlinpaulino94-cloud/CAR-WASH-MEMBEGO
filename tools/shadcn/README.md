# shadcn en este proyecto (preset b0, estilo base-nova)

El proyecto usa shadcn con el preset **b0**: estilo `base-nova` sobre
[Base UI](https://base-ui.com), color base neutral, fuente Inter Variable
(autoalojada con @fontsource, sin depender de Google Fonts), iconos lucide.
La configuración vive en `components.json`; los componentes, en
`src/components/ui/`; el helper `cn()`, en `src/lib/utils.ts`.

## Añadir un componente

En una máquina con internet normal:

    npx shadcn@latest add popover

En el entorno remoto de Claude Code, donde `ui.shadcn.com` está bloqueado por
la política de red:

    bash tools/shadcn/agregar.sh popover

## Qué hay aquí y por qué

- `registro/` — los 152 items del estilo `base-nova` (componentes, hooks y
  fuentes), construidos con el pipeline oficial (`build-registry.mts`) desde el
  código abierto MIT de <https://github.com/shadcn-ui/ui>, con las dependencias
  entre items reescritas a rutas de este directorio para que el CLI no salga a
  la red.
- `mirror/` — lo único que el CLI pide por HTTP aparte de los items
  (`/r/colors/neutral.json` y el índice de estilos); `agregar.sh` lo sirve en
  `127.0.0.1:4123` mientras dura el comando.
- `b0-init.json` — el registry-item exacto que `ui.shadcn.com/init?preset=b0`
  habría devuelto, generado con el mismo código del sitio. Es lo que se aplicó
  con `npx shadcn init` y queda como referencia; no hace falta volver a correrlo.

## Las costuras con el tema de la casa

- El modo oscuro de shadcn se puenteó al mecanismo del proyecto: la variante
  `dark:` y los tokens oscuros siguen a `data-theme` en `<html>` (y al sistema
  cuando no hay atributo), no a la clase `.dark`. Ver `src/index.css`.
- `--color-accent` sigue siendo el acento Membego (`--mb-accent`), que ya se
  usaba en decenas de vistas; `--accent-foreground` se apunta a
  `--mb-on-accent` para que los componentes shadcn que pintan
  `bg-accent text-accent-foreground` queden legibles en ambos temas.
- Los estilos base de shadcn van en `@layer base`, así que las reglas propias
  del proyecto (que no están en capa) siguen ganando donde chocan.
