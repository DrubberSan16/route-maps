# Arquitectura offline

Cada región se publica como un archivo PMTiles autocontenido. La API expone
versión, tamaño, SHA-256 y una descarga HTTP reanudable mediante `Range`:

1. `GET /api/v1/maps/regions`
2. `GET /api/v1/maps/regions/{id}/version?localVersion=...`
3. `GET /api/v1/maps/regions/{id}/download`

La aplicación móvil descarga a un archivo temporal, comprueba tamaño y SHA-256
y solo entonces sustituye la copia activa. Un archivo interrumpido no reemplaza
el mapa válido.

## Qué funciona sin conexión

- dibujar el mapa PMTiles ya descargado, con sus nombres (los glifos van en la
  app);
- consultar rutas, viajes y cambios que la aplicación haya guardado localmente;
- encolar tracking y sincronización para enviarlos cuando regrese la conexión.

La vista satélite, el relieve, las capas de lluvia, clima y población y el
tráfico medido se leen de la plataforma: con conexión se suman al mapa
descargado; sin ella la app dibuja el mapa normal y el panel de capas indica
«Necesita conexión». La app recuerda en el teléfono el tipo de mapa y las capas
elegidas.

Al abrir la app, un estado de conexión todavía desconocido se trata como en
línea para no retrasar el mapa; si la red no responde, la app vuelve al mapa
descargado. En línea, fuera de las regiones descargadas, se usa el mapa
detallado de la zona y el mapa mundial solo donde no hay otro.

El cálculo nativo de rutas y la geocodificación se ofrecen actualmente desde la
API de esta instalación. El paquete de mapa sí es offline; el motor completo de
rutas todavía no se distribuye para ejecutarse dentro del teléfono.

## Actualización segura

`infrastructure/scripts/refresh-region.sh` bloquea ejecuciones paralelas,
exige 6 GiB de RAM y 10 GiB libres para el pico de conversión nacional, compara la
huella de las fuentes, conserva los artefactos de ejecución anteriores y valida salud,
cabeceras Range, magic bytes y checksum antes de aceptar una publicación. Las unidades
`infrastructure/systemd/maps-platform-refresh@.*` permiten programar la revisión
mensual de una región en un equipo con esos recursos.

Un servidor más pequeño (como el de producción, 4 GB compartidos) no regenera
datos: la región se genera en una estación de trabajo y se publica con
`infrastructure/scripts/publish-region.sh <región> <host-ssh>`, que copia mapas,
sus archivos de capas, relieve y satélite, manifiestos, grafo, índice de búsqueda y
capa de clima, verifica cada SHA-256 en el servidor, los sustituye (datos primero,
manifiestos al final), reinicia el backend y registra las regiones. Los archivos
reemplazados quedan en `storage/.publish-backup`.
