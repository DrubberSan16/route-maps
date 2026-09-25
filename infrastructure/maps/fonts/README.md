# Glyphs (fuentes para etiquetas del mapa)

MapLibre dibuja el texto del mapa con glifos SDF en formato PBF, agrupados en rangos de 256
caracteres (`{fontstack}/{range}.pbf`).

| Fuente | Uso en el estilo |
|---|---|
| `Noto Sans Regular` | calles, lugares menores, POIs, números de casa |
| `Noto Sans Medium` | ciudades, países |
| `Noto Sans Italic` | agua (ríos, lagos, mares) e islas |

Rangos incluidos: `0-255`, `256-511`, `512-767`, `768-1023`, `1024-1279`, `7680-7935`,
`8192-8447` y `8448-8703` (latín completo con tildes y ñ, griego, cirílico, puntuación y
flechas usadas para sentido único). Un nombre con caracteres fuera de estos rangos (por
ejemplo CJK) se dibuja sin esos caracteres; para cubrirlos basta con añadir los rangos que
falten.

- Procedencia: [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
  (generados con [maplibre/font-maker](https://github.com/maplibre/font-maker) a partir de
  [Noto Sans](https://github.com/notofonts/latin-greek-cyrillic)).
- Licencia: SIL Open Font License 1.1, ver [OFL.txt](OFL.txt).

Estos mismos archivos se copian a la app móvil (`mobile/assets/fonts/`) para que las
etiquetas funcionen sin conexión; Nginx también los sirve en `/maps/fonts/`.
