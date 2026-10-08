# Arquitectura offline

Cada región se publica con dos archivos autocontenidos:

- el mapa, un archivo PMTiles (`mapDownloadUrl`);
- el paquete sin conexión (`routingDownloadUrl`, con `routingFormat: route-maps-pack`): la red vial y el
  índice de búsqueda de la región y 5 km alrededor, con los que el teléfono calcula rutas, busca lugares
  y nombra direcciones sin Internet. `region.sh pack` lo genera desde el mismo `graph.bin` y
  `search.ndjson` que usa el backend; los mismos datos dan siempre los mismos bytes.

La API expone versión, tamaño, SHA-256 y una descarga HTTP reanudable mediante `Range` de ambos:

1. `GET /api/v1/maps/regions`
2. `GET /api/v1/maps/regions/{id}/version?localVersion=...`
3. `GET /api/v1/maps/regions/{id}/download` (mapa)
4. `GET /api/v1/maps/regions/{id}/routing/download` (paquete sin conexión)

La aplicación móvil descarga los dos archivos en una sola tarea, con una sola barra de progreso. Cada
uno va a un archivo temporal, se comprueban su tamaño y su SHA-256 y solo entonces sustituye la copia
activa: un archivo interrumpido nunca reemplaza al válido. El mapa queda listo en cuanto se verifica,
aunque el paquete falle después; «Reintentar» baja solo lo que falta. Una versión nueva baja solo lo
que cambió: si el mapa o el paquete conservan su SHA-256, el teléfono conserva los suyos.

## Qué funciona sin conexión

- dibujar el mapa PMTiles ya descargado, con sus nombres (los glifos van en la app);
- calcular rutas nuevas en auto, camión, moto, bicicleta y a pie dentro de las regiones descargadas,
  con paradas, alternativas e indicaciones giro a giro;
- buscar lugares, calles, intersecciones y puntos de interés de las regiones descargadas, y obtener la
  dirección de un punto al mantener presionado el mapa;
- abrir las rutas guardadas y consultar los viajes y cambios guardados en el teléfono;
- encolar tracking y sincronización para enviarlos cuando regrese la conexión.

El teléfono usa el mismo motor que el backend, portado a Dart: con el mismo paquete da las mismas
rutas, búsquedas y direcciones. Lo comprueban las pruebas con la ciudad de prueba de
`infrastructure/data-tools/tests/fixtures/offline`, cuyas respuestas esperadas genera el propio backend
(`npm run fixtures:offline`).

Con conexión, rutas y búsquedas las calcula la plataforma. Si la conexión se cae durante la consulta o
el motor del servidor no responde, la app contesta con el paquete del teléfono. Una ruta calculada en el
teléfono lo indica («Calculada en el teléfono con los mapas descargados») y la búsqueda marca sus
resultados («sin conexión, en tus mapas descargados»).

### Límites del modo sin conexión

- El paquete cubre la región y 5 km alrededor. Una ruta con el origen, el destino o una parada fuera de
  las regiones descargadas no se calcula: la app pide descargar la región o conectarse.
- Cada ruta sale de un solo paquete, el más pequeño que cubre todos sus puntos: para ir de Guayaquil a
  Quito sin conexión hace falta la región «Ecuador».
- Sin conexión no hay ajuste por tráfico ni avisos de clima (`conditions`): la duración es la del grafo.
- La búsqueda sin conexión no incluye el índice mundial (países y ciudades de otros países).
- El teléfono lee el paquete en memoria la primera vez que lo usa (la red vial al calcular una ruta, el
  índice al buscar). El de todo el país es el más grande; en teléfonos con poca memoria conviene
  descargar la provincia o la ciudad.
- La app no usa los paquetes Valhalla de las regiones OSM heredadas (`routingFormat: valhalla-tiles`).

La vista satélite, el relieve, las capas de lluvia, clima y población y el
tráfico medido se leen de la plataforma: con conexión se suman al mapa
descargado; sin ella la app dibuja el mapa normal y el panel de capas indica
«Necesita conexión». La app recuerda en el teléfono el tipo de mapa y las capas
elegidas.

Al abrir la app, un estado de conexión todavía desconocido se trata como en
línea para no retrasar el mapa; si la red no responde, la app vuelve al mapa
descargado. En línea, fuera de las regiones descargadas, se usa el mapa
detallado de la zona y el mapa mundial solo donde no hay otro.

## Generar y publicar los paquetes

`make prepare-region REGION=guayaquil` (en Windows, `.\make.ps1 prepare-region -Region guayaquil`)
genera el paquete junto con el mapa; `SKIP_ROUTING=1` (`-SkipRouting`) lo omite. En una instalación que
ya tiene la región preparada basta con `make build-pack REGION=guayaquil` (`.\make.ps1 build-pack -Region
guayaquil`): genera el paquete, reescribe el manifiesto y registra la región sin rehacer el mapa, y los
teléfonos que ya tienen ese mapa bajan solo el paquete.

El paquete sale del grafo y del índice de búsqueda: después de `build` o `aliases` hay que volver a
generarlo, y `region.sh manifest` avisa si quedó más antiguo que ellos. Al registrar la región, el
backend comprueba que el SHA-256 del paquete coincide con el de su manifiesto.

## Actualización segura

`infrastructure/scripts/refresh-region.sh` bloquea ejecuciones paralelas,
exige 6 GiB de RAM y 10 GiB libres para el pico de conversión nacional, compara la
huella de las fuentes, conserva los artefactos de ejecución anteriores (incluido el
paquete sin conexión) y valida salud, cabeceras Range, magic bytes y checksum del mapa
y del paquete antes de aceptar una publicación. Las unidades
`infrastructure/systemd/maps-platform-refresh@.*` permiten programar la revisión
mensual de una región en un equipo con esos recursos.

Un servidor más pequeño (como el de producción, 4 GB compartidos) no regenera
datos: la región se genera en una estación de trabajo y se publica con
`infrastructure/scripts/publish-region.sh <región> <host-ssh>`, que copia mapas,
sus archivos de capas, relieve y satélite, paquetes sin conexión, manifiestos, grafo,
índice de búsqueda y capa de clima, verifica cada SHA-256 en el servidor, los
sustituye (datos primero, manifiestos al final), reinicia el backend y registra las
regiones. Los archivos reemplazados quedan en `storage/.publish-backup`.
