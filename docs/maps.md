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
2. `native-data build ecuador` genera, a partir de esas capas:
   - `graph.bin`: grafo nacional de rutas (calles del censo + red vial estatal), ver `docs/routing.md`;
   - `search.ndjson`: índice de búsqueda (lugares, calles, puntos de interés, parroquias, barrios);
   - `map-*.geojson`: capas del mapa con clases, nombres legibles y rangos (calles, lugares, POI, parques,
     manzanas, edificaciones, población).
3. `region.sh map ecuador` genera el PMTiles con el generador propio (Planetiler) y `region.sh manifest`
   calcula checksum, cobertura y versión. El backend registra el manifiesto; Nginx sirve el archivo.

`make prepare-region REGION=ecuador` ejecuta los tres pasos. No hay solicitudes de datos cartográficos
durante el uso del mapa.

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
| `population` | Malla censal de 1 km² (mapa de calor) |
| `climate` | Regiones de precipitación anual y pisos térmicos (capas opcionales) |

El estilo se genera con `infrastructure/maps/style/build-style.py` (web, SDK y app móvil). Los iconos de los
puntos de interés los dibujan los clientes a partir de `poi-<class>` (`/sdk/map-icons.js`). Las capas
`overlay-precipitation`, `overlay-temperature` y `overlay-population` empiezan ocultas.

Como en un buscador de mapas, la densidad de puntos crece con el zoom: aeropuertos, terminales,
hospitales y centros comerciales desde el 12; mercados, museos y municipios desde el 13; parques y
centros de salud desde el 14-15; escuelas, templos y restaurantes desde el 16; consultorios desde el 18.
Los puntos principales se colocan antes que los nombres de calles y los menores después, para que las
calles conserven sus nombres.

## Fuentes y citas

La página `/fuentes.html` del visor lista las fuentes con su cita oficial. El INEC exige citar la fuente en
todo producto derivado ("Fuente: INSTITUTO NACIONAL DE ESTADÍSTICA Y CENSOS – INEC; Marco Geoestadístico
Nacional; 2026; GeoPackage; Quito, Ecuador.") y un acuerdo específico para uso comercial. La cartografía
1:50.000 del IGM no se usa: su licencia prohíbe redistribuirla por Internet.

## Formato offline

El mapa se distribuye como un único archivo PMTiles. El endpoint de descarga soporta `Range`, reanudación,
ETag y checksum del manifiesto. Una aplicación puede guardar el archivo, sustituir `__PMTILES_URL__` en el
estilo y renderizar sin conexión.

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
- Las ortofotos requieren autorización/licencia por zona antes de incorporarse.
