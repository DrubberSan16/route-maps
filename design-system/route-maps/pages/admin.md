# Panel de administración (`infrastructure/nginx/html/admin`) — override de MASTER.md

Estas reglas **sobrescriben** a `MASTER.md` para el panel de administración. Lo
no mencionado aquí sigue el MASTER.

## Patrón de página

- Herramienta de trabajo, no una landing: el "Funnel" y el "Scroll Reveal" del
  MASTER **no aplican**. Densidad alta, lectura rápida de tablas y cifras.
- Layout: barra lateral oscura de 256 px (logo, secciones agrupadas en
  «General», «Operación» y «Plataforma», cuenta y cierre de sesión) y
  contenido de hasta 1400 px. Un operador no ve las secciones solo para
  administradores (integraciones, cuentas, auditoría). Por debajo de 1024 px la barra lateral es un
  cajón con fondo oscurecido y aparece una barra superior de 56 px con el botón
  de menú y el título de la pantalla.
- Cada pantalla: título, descripción corta y, a la derecha, sus acciones; luego
  tarjetas (`.card`). Una sola acción primaria por vista (crear, guardar).
- Listas: filtros arriba, tabla con filas que abren el detalle y paginación.
  Los filtros viven en la dirección (`#/viajes?status=ACTIVE`), así un enlace
  copiado abre la misma vista.
- Detalle: dos columnas (`grid--sidebar`, 2:1) con el mapa o la tabla principal
  a la izquierda y los datos a la derecha; una sola columna por debajo de
  1200 px.
- Acciones destructivas (eliminar, revocar, cerrar sesiones) siempre con un
  diálogo de confirmación con botón rojo que dice qué se pierde. Eliminar una
  cuenta o una integración pide además escribir su correo o su nombre.
- Secretos (llaves de API, secretos de webhooks, contraseñas temporales): un
  diálogo que los muestra una sola vez, con botón «Copiar» y el aviso de que no
  se volverán a mostrar.

## Color

- Tokens del MASTER como variables en `:root` de `admin.css`; ningún componente
  usa hex sueltos y los scripts leen los colores de mapas y gráficos con
  `getComputedStyle` (`--color-chart-*`, `--color-map-*`).
- Añadidos del panel: `--color-sidebar` (#0f172a) con texto `#cbd5e1`
  (11.6:1), `--color-surface` detrás de las tarjetas, `--color-input-border`
  (3.2:1 sobre blanco), `--color-row-hover` y `--color-selected`.
- Estados con fondo suave y texto oscuro, siempre con palabra además del color:
  éxito, aviso, peligro, información y neutro (`--color-*-bg` / `--color-*-fg`,
  todos ≥ 6.4:1).
- Solo modo claro, como el visor y el estilo del mapa.

## Tipografía

- Inter variable autohospedada (la misma del visor, desde `/vendor/fonts`).
- Títulos de pantalla de 26 px (22 px en teléfonos); tarjetas de 16 px; tablas
  de 14 px con cifras tabulares (`font-variant-numeric: tabular-nums`) y
  alineadas a la derecha.
- Identificadores, URL y JSON en monoespaciada.
- Campos de texto a 16 px en teléfonos (sin zoom automático en iOS).

## Componentes

- Tablas: por debajo de 768 px cada fila es una tarjeta y cada celda muestra el
  nombre de su columna (`data-label`).
- Gráficos de barras en HTML y CSS (sin librería), con una tabla equivalente
  para lectores de pantalla.
- Mapas: MapLibre con los PMTiles de la propia instalación; recorridos en el
  primario, inicio en verde, fin en rojo y geocercas en violeta.
- Avisos (`.alert`) para el estado de la plataforma y notificaciones (`.toast`)
  tras cada acción, que se cierran solas (4 s; 8 s las de error).

## Movimiento

- Sin animaciones de entrada. Solo transiciones de color, fondo y borde
  (150 ms) y el deslizamiento del cajón (200 ms), todas a 0 ms con
  `prefers-reduced-motion: reduce`.

## Iconos y marca

- SVG de trazo estilo Lucide (24×24, trazo 2) en un sprite dentro de
  `index.html` (`<symbol>`), como el visor. Decorativos con `aria-hidden`; los
  botones solo icono llevan `aria-label`.
- Logo: el ícono de la app (`/icons/icon.svg`, generado desde `brand/`).

## Seguridad y accesibilidad

- Política de seguridad de contenido estricta: sin estilos ni scripts en línea,
  solo recursos del mismo servidor. Toda la interfaz se construye con
  `textContent` y nodos del DOM, nunca con `innerHTML` de datos.
- Al cambiar de pantalla el foco va al título; los diálogos son `<dialog>`
  nativos (Escape, foco atrapado) y los selectores de cuenta siguen el patrón
  combobox + listbox.
- Áreas táctiles de al menos 40 px; `[hidden]` gana siempre sobre el `display`
  de los componentes.
