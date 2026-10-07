# Cartografía autónoma

## Flujo

1. `native-data download ecuador` lee el registro `infrastructure/sources/sources.json` y descarga, valida
   y guarda cada capa oficial en `storage/imports/native/ecuador/`:
   - **Marco Geoestadístico Nacional del INEC** (tipo `inec-geostatistical`): un GeoPackage por provincia
     (y el nacional solo para la malla de población). Cada paquete se descarga, se verifica, se reproyecta
     de UTM 17S a WGS 84 y se guarda comprimido en `inec/<provincia>/`; el paquete original se borra.
     Una provincia solo se vuelve a procesar si cambia su tamaño, fecha o ETag remotos.
   - Capas ArcGIS/WFS (red vial estatal, límites, salud, educación, turismo, agua, clima, barrios):
     GeoJSON EPSG:4326 validado (tipo, coordenadas, conteo, límites) con SHA-256 en `manifest.json`.
   - Las capas que una descarga no pide (`--layer`, o las opcionales y grandes sin `--include-optional` ni
     `--include-large`) conservan su registro en `manifest.json` mientras sigan en la caché, porque `build`
     las usa y la huella de la construcción sale de ese registro.
2. `native-data build ecuador` genera, a partir de esas capas:
   - `graph.bin`: grafo nacional de rutas (calles del censo + red vial estatal), ver `docs/routing.md`;
   - `search.ndjson`: índice de búsqueda (lugares, calles, puntos de interés, parroquias, barrios);
   - `map-*.geojson`: capas del mapa con clases, nombres legibles y rangos (calles, lugares, POI, parques,
     manzanas, edificaciones, población).
3. `region.sh map ecuador` genera con el generador propio (Planetiler) dos archivos PMTiles: el mapa
   (`--native_layers=map`) y, aparte, la población y el clima (`--native_layers=overlays`, hasta el zoom
   12) en `ecuador.overlays.pmtiles`. Así la primera carga del mapa no descarga capas que empiezan
   ocultas.
4. `region.sh rasters ecuador` (`raster-data download` + `build`) genera el relieve
   (`ecuador.terrain.pmtiles`) y la vista satélite (`ecuador.satellite.pmtiles`) de las regiones que los
   declaran en `regions.json` (`rasters`, con su zoom máximo).
5. `region.sh manifest` calcula checksum, cobertura y versión del mapa y de esos archivos extra
   (`assets`). El backend registra el manifiesto; Nginx sirve los archivos.

`make prepare-region REGION=ecuador` ejecuta todos los pasos (`--skip-rasters` omite el 4). No hay
solicitudes de datos cartográficos durante el uso del mapa.

## Nombres

Las fuentes guardan los nombres en mayúsculas y casi siempre sin tildes. La construcción los convierte a
títulos en español (`12 S-E (MALECON SIMON BOLIVAR PALACIOS)` → `Av. 12 S-E - Malecón Simón Bolívar
Palacios`), restaura tildes con un diccionario curado más las grafías con tilde de las propias fuentes,
repara la "Ñ" que el censo exporta como "NI" (`BANIOS` → `Baños`) y los caracteres dañados por
exportaciones. Los nombres populares que no están en las fuentes (p. ej. "Malecón 2000") se declaran en
`infrastructure/sources/aliases.json` y se resuelven contra la entrada oficial; si no se encuentra, la
construcción lo informa y no lo inventa.

Los barrios que el municipio publica por etapas o sectores ("Alborada I … XII Etapa", "Urdesa Central" y
"Urdesa Norte") reciben además una entrada de búsqueda con el nombre que usa la gente ("Alborada",
"Urdesa"), que cubre la unión de sus etapas. `region.sh aliases <región>` aplica grupos y alias al índice
sin reconstruir la geometría (segundos en lugar de la construcción completa).

## Capas del mapa

| Capa | Contenido |
|---|---|
| `transportation` | Calles del censo con su jerarquía (autopista, avenida, calle, pasaje, peatonal, escalinata…), nombre y numeración de la red estatal; la red estatal completa en los zooms bajos |
| `landuse` | Áreas urbanas (zooms bajos), manzanas (z13+), parques, canchas, cementerios y plazas |
| `building` | Huellas de edificaciones del censo (z14, se amplían en zooms mayores) |
| `place` | Ciudades, cabeceras cantonales y parroquiales, localidades, barrios de Guayaquil y parroquias urbanas de Quito |
| `poi` | Terminales, aeropuertos, centros comerciales, mercados, hospitales, centros de salud, farmacias, universidades, escuelas, iglesias, parques, estadios, bancos, UPC, bomberos, oficinas públicas, hoteles, restaurantes, gasolineras… (`class`, `subclass`, `rank`) |
| `boundary` | Provincia, cantón y parroquia |
| `water`, `waterway` | Cuerpos de agua y ríos |
| `population` | Malla censal de 1 km² (mapa de calor), en el archivo de capas |
| `climate` | Regiones de precipitación anual y pisos térmicos, en el archivo de capas |

El estilo se genera con `infrastructure/maps/style/build-style.py` (web, SDK y app móvil). Los iconos de los
puntos de interés los dibujan los clientes a partir de `poi-<class>` (`/sdk/map-icons.js` en la web,
`poi_icons.dart` en la app) con los colores de `maps-platform:poi-colors`. Las capas
`overlay-precipitation`, `overlay-temperature` y `overlay-population` empiezan ocultas y leen la fuente
`overlays` (`__OVERLAYS_URL__`): el archivo de capas de la región o, en mapas generados antes de que
existiera, el propio mapa.

## Tipos de mapa: satélite y relieve

El estilo describe en `maps-platform:map-types` cómo dibujar cada tipo, y los clientes lo aplican solo si
la región publica el archivo que necesita (`assets` del catálogo):

| Tipo | Archivo | Qué hace |
|---|---|---|
| `map` | el mapa | Mapa vectorial |
| `satellite` | `<región>.satellite.pmtiles` (WebP) | Imagen bajo calles y nombres; oculta senderos y bordes de calles y aclara los nombres |
| `relief` | `<región>.terrain.pmtiles` (Terrarium, WebP) | Colorea por altura (`color-relief`) y sombrea las laderas (`hillshade`, método `igor`) |

- **Satélite**: compuestos anuales Sentinel-2 de ESA WorldCover (mediana sin nubes, 10 m). Se usa el de
  2021 y sus vacíos se completan con el de 2020. Zoom máximo 12-14 según la región.
- **Relieve**: Copernicus DEM GLO-30 (~30 m), modelo de superficie: incluye edificios y vegetación; el mar
  se toma como altura 0. Zoom máximo 11-12.

Donde se superponen regiones (país, provincia y ciudad), el visor y la app dibujan la imagen satélite de
todas, la de la región más pequeña encima: en una ciudad se ve la de más zoom. El relieve se toma solo de
la región exterior, porque sombrear dos veces las mismas laderas las oscurece.

Ambas fuentes son abiertas, se descargan una vez (`storage/imports/raster/`) y se sirven desde la propia
instalación con la cita que pide su licencia (control de atribución del mapa y `/fuentes.html`).

## Tráfico

Al activar el tráfico, los clientes muestran `traffic-network` (autopistas, troncales, primarias,
secundarias y terciarias del mapa) en verde, que significa «sin demoras reportadas», y encima los tramos
medidos que devuelve `GET /api/v1/traffic/flow?bbox=…` para vistas de ciudad (zoom 10 o más y hasta 2,5°):
verde, amarillo (moderado), naranja (lento) y rojo (detenido) según `maps-platform:traffic`. Los tramos
salen solo de recorridos anónimos de la propia app: en vivo (últimos 15 minutos) o, más tenues, lo
habitual para ese día y hora en las últimas 4 semanas (`source: typical`, zona horaria
`TRAFFIC_TIME_ZONE`). Sin muestras suficientes no se pinta congestión.

Como en un buscador de mapas, la densidad de puntos crece con el zoom: aeropuertos, terminales,
hospitales y centros comerciales desde el 12; mercados, museos y municipios desde el 13; parques y
centros de salud desde el 14-15; escuelas, templos y restaurantes desde el 16; consultorios desde el 18.
Los puntos principales se colocan antes que los nombres de calles y los menores después, para que las
calles conserven sus nombres.

## Fuentes y citas

La página `/fuentes.html` del visor lista las fuentes con su cita oficial; el visor y el SDK la enlazan desde el
control de atribución del mapa y la app muestra la misma lista, también sin conexión, en «Fuentes», junto al
indicador del mapa. El INEC exige citar la fuente en
todo producto derivado ("Fuente: INSTITUTO NACIONAL DE ESTADÍSTICA Y CENSOS – INEC; Marco Geoestadístico
Nacional; 2026; GeoPackage; Quito, Ecuador.") y un acuerdo específico para uso comercial. La cartografía
1:50.000 del IGM no se usa: su licencia prohíbe redistribuirla por Internet.

## Formato offline

El mapa se distribuye como un único archivo PMTiles. El endpoint de descarga soporta `Range`, reanudación,
ETag y checksum del manifiesto. Una aplicación puede guardar el archivo, sustituir `__PMTILES_URL__` (y
`__OVERLAYS_URL__`) en el estilo y renderizar sin conexión. El relieve, la vista satélite y las capas se
leen de la plataforma mientras hay conexión; también se pueden descargar con
`GET /api/v1/maps/regions/{id}/assets/{tipo}/download`. Las rutas, la búsqueda y las direcciones sin conexión
de la app salen del paquete de la región (`GET /api/v1/maps/regions/{id}/routing/download`, ver
[offline-architecture.md](offline-architecture.md)).

## Calidad y límites

- Las calles provienen de la cartografía censal: cubren todas las áreas amanzanadas del país (ciudades,
  cabeceras y localidades), no tienen sentidos de circulación ni restricciones de giro y la propia fuente
  advierte que no tiene precisión métrica.
- Entre pueblos, la red es la estatal. Si el acceso de un pueblo a su carretera no está en ninguna fuente,
  el grafo lo une con un tramo recto marcado como aproximado (nunca sobre agua); los clientes lo muestran
  punteado.
- El clima es climatología (precipitación anual y pisos térmicos), no pronóstico en vivo.
- El tráfico y la actividad solo aparecen con recorridos recientes de la propia plataforma y con umbrales
  de privacidad. El sistema responde sin datos antes que inventarlos.
- La vista satélite tiene 10 m por píxel: muestra barrios, parques y vías grandes, no el detalle de una
  ortofoto. Las ortofotos requieren autorización/licencia por zona antes de incorporarse.
