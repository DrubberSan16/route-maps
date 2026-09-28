# Cartografía autónoma

## Flujo

1. `native-data` lee el registro `infrastructure/sources/sources.json`.
2. Descarga por lotes ArcGIS/WFS, convierte a GeoJSON EPSG:4326 y valida tipo,
   coordenadas, conteo y límites.
3. Calcula SHA-256 y escribe `storage/imports/native/ecuador/manifest.json`.
4. El generador traduce campos oficiales al esquema interno y crea PMTiles.
5. `region.sh manifest ecuador` calcula checksum, cobertura y versión.
6. El backend registra el manifiesto; Nginx sirve el archivo local.

No hay solicitudes de datos cartográficos durante el uso del mapa.

## Capas actuales

| Capa interna | Contenido |
|---|---|
| `transportation` | Red vial estatal nacional |
| `boundary` | Provincia, cantón y parroquia |
| `place` | Localidades y etiquetas administrativas |
| `poi` | Salud, educación y turismo |
| `water` | Cuerpos de agua y ríos en área |
| `waterway` | Red hidrográfica lineal opcional |
| `climate` | Regiones de precipitación anual |

El archivo de estilo es propio y no contiene atribuciones de proveedores de
mapas anteriores. La procedencia y licencia de los datos se conserva en el
catálogo auditable y en la documentación de la instalación.

## Preparación

```bash
make prepare-region REGION=ecuador
make regions-sync
```

Para descargar una capa opcional concreta:

```bash
docker compose --profile tools run --rm --entrypoint native-data data-tools \
  download ecuador --layer climate-precipitation-regions
```

La red hidrográfica lineal es grande y se activa explícitamente con
`--include-large`. Esto evita que una actualización rutinaria agote disco.

## Formato offline

El mapa se distribuye como un único archivo PMTiles. El endpoint de descarga
soporta `Range`, reanudación, ETag y checksum del manifiesto. Una aplicación
puede guardar el archivo, sustituir `__PMTILES_URL__` en el estilo y renderizar
sin conexión.

El grafo de rutas nativo se construye al iniciar el backend desde la instantánea
oficial de carreteras. Actualmente el paquete offline publicado corresponde al
mapa; el cálculo de rutas offline en el dispositivo requiere portar este mismo
lector de grafo al cliente móvil.

## Calidad y límites

- La ruta cubre la red vial estatal, no cada calle urbana.
- La geocodificación cubre localidades y puntos oficiales disponibles.
- El clima es climatología de precipitación, no pronóstico en vivo.
- El tráfico solo aparece con muestras recientes generadas por los propios
  usuarios y con umbral de privacidad.
- Las ortofotos requieren autorización/licencia por zona antes de incorporarse.

El sistema responde `insufficient_data` o `unavailable` cuando no existe una
medición fiable; nunca fabrica cobertura.
