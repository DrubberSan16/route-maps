# Visor web (`infrastructure/nginx/html`) — override de MASTER.md

Estas reglas **sobrescriben** a `MASTER.md` para el visor de mapas. Lo no
mencionado aquí sigue el MASTER.

## Patrón de página

- El patrón "Funnel (3-Step Conversion)" y el "Scroll Reveal" del MASTER **no
  aplican**: es una herramienta de mapa, no una landing.
- Layout: mapa a pantalla completa con una barra de búsqueda flotante (menú,
  búsqueda y "Cómo llegar") y, al elegir un lugar o pedir indicaciones, un
  panel de 408 px a la izquierda. Por debajo de 768 px el panel es una hoja
  inferior que se puede minimizar y los controles del mapa suben con ella
  (`--sheet-offset`).
- Controles sobre el mapa: botón «Capas» abajo a la izquierda (miniatura del
  tipo de mapa al que cambia; abre el panel de tipo de mapa y detalles),
  «Instalar app» arriba a la derecha (oculto en la app instalada) y zoom,
  escala y ubicación abajo a la derecha. Con el tráfico activo aparece su
  leyenda.
- Menú lateral (`<dialog>`): logo, «Instalar la app», integración, API,
  fuentes y mapas disponibles.
- «Instalar app» abre un diálogo con dos opciones: el APK de Android que
  publica el servidor (`/descargas/android.json`; en iOS no se ofrece) y la app
  web (PWA) cuando el navegador lo permite, con instrucciones si no.
- Una sola acción primaria por vista: "Cómo llegar" en la tarjeta de lugar.

## Color

- Se usan los tokens del MASTER como variables en `:root` de `viewer.css`.
  Ningún componente ni el JS usa hex sueltos: el JS lee los colores de la ruta
  con `getComputedStyle` (`--color-route`, `--color-route-alternative`,
  `--color-route-casing`).
- Añadidos del visor: `--color-input-border` (3.2:1 sobre blanco, borde de
  campos visible), `--color-selected`, colores de marcadores
  (`--color-marker-origin` 5.5:1 con texto blanco, parada = primario, destino =
  acento), del aviso del mapa y de las leyendas de capas (`--color-traffic-*`,
  `--color-rain-*`, `--color-temp-*`, `--color-heat-*`, los mismos valores que
  el estilo del mapa).
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

## Iconos y marca

- SVG de trazo estilo Lucide (24×24, trazo 2) en un sprite inline
  (`<symbol>` en `index.html`). Decorativos con `aria-hidden`; los botones solo
  icono llevan `aria-label`.
- Logo: `brand/logo.svg` (ruta con dos paradas sobre el azul primario). Los
  íconos de la PWA, Android e iOS se generan con `brand/render-icons.mjs`.
- Miniaturas de tipo de mapa: `icons/map-type-{map,satellite,relief}.webp`,
  compartidas con la app.
- Puntos de interés: disco del color de su clase (`maps-platform:poi-colors`)
  con un glifo blanco, dibujado en el cliente (`/sdk/map-icons.js`).

## Accesibilidad

- Búsqueda y campos de ruta: patrón combobox + listbox (flechas, Enter, Escape,
  `aria-activedescendant`).
- Perfiles y rutas encontradas: radios nativos (teclado sin JS extra).
- Arrastrar marcadores tiene alternativa: escribir el lugar en el campo o subir
  y bajar paradas con botones.
- `[hidden]` gana siempre sobre el `display` de los componentes.
