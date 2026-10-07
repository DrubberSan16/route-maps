# Design system de route-maps: con qué se implementa

- **Identidad**: `MASTER.md` (generado con la skill `ui-ux-pro-max`: "navigation
  map utility tool", variance 3, motion 3, density 7). Overrides por página en
  `pages/`: `pages/viewer.md` (visor web) y `pages/mobile-app.md` (app).
- **Visor web**: HTML + CSS + JS sin paso de build en
  `infrastructure/nginx/html/` (MapLibre GL JS y PMTiles vendorizados por la
  imagen de Nginx). Tokens como variables CSS en `:root` de `viewer.css`.
- **Movimiento**: sin capa de movimiento propia (ver `pages/viewer.md`); si el
  visor llegara a necesitarla, sería `framer-motion`/`motion` según el playbook
  del fleet, nunca un segundo motor.
- **App móvil**: Flutter (`mobile/`) con un tema Material 3 en los colores de
  este design system (`lib/presentation/theme.dart`); ver `pages/mobile-app.md`.
- **Marca**: `brand/` (logo SVG y el script que genera los íconos de la web,
  Android e iOS).
