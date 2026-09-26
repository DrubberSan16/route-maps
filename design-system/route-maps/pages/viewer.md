# Visor web (`infrastructure/nginx/html`) — override de MASTER.md

Estas reglas **sobrescriben** a `MASTER.md` para el visor de mapas. Lo no
mencionado aquí sigue el MASTER.

## Patrón de página

- El patrón "Funnel (3-Step Conversion)" y el "Scroll Reveal" del MASTER **no
  aplican**: es una herramienta de mapa, no una landing.
- Layout: panel lateral de 380 px (búsqueda, lugar, "Cómo llegar", mapas
  disponibles) + mapa a pantalla completa. Por debajo de 768 px el panel pasa
  abajo (50 % de alto) y el mapa arriba.
- Una sola acción primaria por vista: "Cómo llegar" en la tarjeta de lugar.

## Color

- Se usan los tokens del MASTER como variables en `:root` de `viewer.css`.
  Ningún componente ni el JS usa hex sueltos: el JS lee los colores de la ruta
  con `getComputedStyle` (`--color-route`, `--color-route-alternative`,
  `--color-route-casing`).
- Añadidos del visor: `--color-input-border` (3.2:1 sobre blanco, borde de
  campos visible), `--color-selected`, colores de marcadores
  (`--color-marker-origin` 5.5:1 con texto blanco, parada = primario, destino =
  acento) y del aviso del mapa.
- Solo modo claro: el estilo del mapa (`infrastructure/maps/style/style.json`)
  es claro y el panel acompaña al mapa.

## Tipografía

- Inter variable, **autohospedada**: la imagen de Nginx la toma de npm
  (`@fontsource-variable/inter`, OFL 1.1) al construir. No se cargan Google
  Fonts en tiempo de ejecución (plataforma autohospedada, sin CDN de terceros).
- Campos de texto a 16 px (sin zoom automático en iOS).

## Movimiento

- Sin capa de movimiento de componentes: no hay reveals ni animaciones de
  entrada. Solo transiciones CSS de color/fondo/borde (150 ms), a 0 ms con
  `prefers-reduced-motion: reduce`.
- Los movimientos de cámara del mapa (`flyTo`, `fitBounds`) son de MapLibre y
  usan duración 0 con `prefers-reduced-motion`.

## Iconos

- SVG de trazo estilo Lucide (24×24, trazo 2) en un sprite inline
  (`<symbol>` en `index.html`). Decorativos con `aria-hidden`; los botones solo
  icono llevan `aria-label`.

## Accesibilidad

- Búsqueda y campos de ruta: patrón combobox + listbox (flechas, Enter, Escape,
  `aria-activedescendant`).
- Perfiles y rutas encontradas: radios nativos (teclado sin JS extra).
- Arrastrar marcadores tiene alternativa: escribir el lugar en el campo o subir
  y bajar paradas con botones.
- `[hidden]` gana siempre sobre el `display` de los componentes.
