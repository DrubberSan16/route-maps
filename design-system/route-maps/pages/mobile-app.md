# App móvil (`mobile/`) — override de MASTER.md

Estas reglas **sobrescriben** a `MASTER.md` para la app Flutter. Lo no
mencionado aquí sigue el MASTER y, en lo visual, el visor web
(`pages/viewer.md`): la app y el visor deben sentirse como el mismo producto.

## Tema

- Material 3 (`lib/presentation/theme.dart`), sembrado con el primario
  `#2563EB` y con los tokens del MASTER en `BrandColors`: primario, secundario,
  acento, fondo `#F0F9FF`, superficie blanca, texto `#0F172A`, texto atenuado
  `#475569`, borde `#E4ECFC` y seleccionado `#DBEAFE`.
- Botones de 48 px de alto mínimo y radio 12; tarjetas radio 20; hojas
  inferiores radio 24 con asa; chips en píldora; avisos flotantes.
- Tipografía del sistema (Roboto / San Francisco) con los pesos del visor:
  títulos 600-700, botones 600.

## Pantalla del mapa

- Mapa a pantalla completa. Arriba, una barra de búsqueda en píldora con el
  logo, «Buscar destino...» y el menú; debajo, una etiqueta discreta con el
  origen del mapa (descargado, en línea o sin mapa) y, con el tráfico activo,
  su leyenda.
- Abajo: el botón «Capas» (miniatura de 64 px del tipo de mapa al que cambia)
  a la izquierda y el botón redondo de ubicación a la derecha.
- Sin destino: «Mapas offline» (secundario, blanco) y «Trazar ruta»
  (primario) como botones grandes. Con destino o ruta, su tarjeta lleva sus
  propias acciones y esos botones se ocultan.
- Controles flotantes sobre el mapa: superficie blanca, radio 16 y la sombra
  `MapChrome.shadow`.

## Panel de capas

- Hoja inferior con «Tipo de mapa» (Mapa, Satélite, Relieve con las
  miniaturas del visor; el elegido con borde primario; uno sin datos en la
  zona se atenúa y dice por qué) y «Detalles del mapa» (Tráfico, Lluvia,
  Clima, Población), con la leyenda y la nota de cada capa activa: los mismos
  textos que el visor.

## Mapa

- Rutas y marcadores con los colores del visor: ruta `#2563EB` con borde
  blanco, alternativa `#7FA3E8`, origen `#047857`, destino `#DC2626`, paradas
  numeradas en el primario.
- Íconos de puntos de interés dibujados en la app (`poi_icons.dart`): disco
  del color de su clase con glifo blanco, como en la web.

## Accesibilidad

- Botones solo icono con `tooltip`; objetivos táctiles de 48 px o más.
- Los textos de los botones grandes se ajustan (`FittedBox`) en vez de
  desbordarse con tamaños de letra grandes.
