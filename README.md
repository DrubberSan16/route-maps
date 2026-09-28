# Route Maps

Plataforma cartográfica autónoma para Ecuador. La instalación descarga
instantáneas auditables de fuentes oficiales, genera sus propias teselas
vectoriales, calcula rutas con su propio grafo, busca lugares localmente y
publica mapas descargables para uso sin conexión. Ninguna vista solicita mapas,
rutas o geocodificación a proveedores externos durante la ejecución.

## Capacidades

- Mapa vectorial PMTiles de todo Ecuador con cada calle del país (610 mil ejes
  viales del Marco Geoestadístico del INEC con su nombre), manzanas,
  edificaciones, parques, ríos, límites, ciudades, barrios y más de 130 mil
  puntos de interés con iconos por categoría.
- Motor de rutas nativo sobre el grafo nacional (calles + red vial estatal)
  para auto, camión, moto, bicicleta y a pie, con indicaciones giro a giro,
  paradas y rutas alternativas.
- Búsqueda local de lugares, calles, intersecciones y puntos de interés, y
  búsqueda inversa por calle.
- Capas de tráfico en vivo y actividad (recorridos propios), lluvia anual,
  pisos térmicos y densidad de población (mapa de calor).
- Validación de cada ruta contra tráfico reciente propio y climatología local.
- API pública, visor web y SDK JavaScript servidos por la misma instalación.
- Descarga offline del archivo de mapa con checksum y manifiesto versionado.

## Arquitectura de ejecución

```text
Aplicación / SDK / móvil
          |
        Nginx
       /     \
  PMTiles    API NestJS
               |-- rutas nativas (graph.bin)
               |-- geocodificación nativa (search.ndjson)
               |-- tráfico agregado propio
               |-- PostgreSQL/PostGIS + Redis
```

Los portales oficiales solo se consultan en la fase de ingesta. Los archivos
descargados se validan, se resumen en `manifest.json` y se conservan en
`storage/imports/native/`. El servicio en producción lee exclusivamente copias
locales.

## Inicio local

```bash
cp .env.example .env
make init
make prepare-region REGION=ecuador
docker compose up -d --build
```

Abrir `http://localhost:8080`. Los datos generados no se versionan en Git.

## API para otras aplicaciones

- `GET /api/v1/maps/regions`: regiones y versiones publicadas.
- `GET /api/v1/maps/regions/{id}/download`: mapa PMTiles offline.
- `POST /api/v1/routes/calculate`: ruta, distancia, tiempo y condiciones.
- `GET /api/v1/geocoding/search`: búsqueda local.
- `GET /api/v1/geocoding/reverse`: lugar oficial cercano.
- `GET /api/v1/traffic/flow`: tráfico de los últimos 15 minutos por tramo de vía.
- `GET /api/v1/traffic/activity`: mapa de calor de actividad de las últimas 24 h.
- `GET /api/v1/tracking/traffic`: tráfico agregado por celdas (compatibilidad).
- `GET /sdk/route-maps.js`: SDK web sin CDN.
- `GET /developers.html`: ejemplos de integración.

Ejemplo de ruta:

```bash
curl -X POST https://route-map.softwareeasydev.com/api/v1/routes/calculate \
  -H 'Content-Type: application/json' \
  -d '{
    "origin":{"latitude":-2.1709,"longitude":-79.9224},
    "destination":{"latitude":-0.1807,"longitude":-78.4678},
    "profile":"CAR"
  }'
```

La respuesta incluye `distanceMeters`, `durationSeconds` y `conditions`:

- `traffic.status=observed` solo con muestras recientes y anónimas suficientes;
  de lo contrario devuelve `insufficient_data`.
- `climate.status=climatology` identifica las zonas de precipitación anual
  atravesadas. No se presenta como meteorología en vivo.
- `baseDurationSeconds` y `adjustedDurationSeconds` separan el tiempo de red vial
  del ajuste medido por tráfico.

## Datos y actualización

El registro completo está en `infrastructure/sources/sources.json`. Para revisar
o regenerar:

```bash
docker compose --profile tools run --rm data-tools list
make prepare-region REGION=ecuador
make regions-sync
```

Cada salida se escribe en un temporal y se renombra al finalizar. El refresco
desatendido usa `infrastructure/scripts/refresh-region.sh` y las unidades de
`infrastructure/systemd/` en equipos con al menos 6 GB de RAM y 10 GB libres. Un
servidor pequeño recibe la región ya generada desde una estación de trabajo:

```bash
./infrastructure/scripts/publish-region.sh ecuador <host-ssh>
./infrastructure/scripts/validate-coverage.sh https://route-map.softwareeasydev.com
```

Las ortofotos y la cartografía del IGM no se usan: su licencia prohíbe
redistribuir por Internet la información descargada. El catálogo lo deja
registrado para que nadie la incorpore por error.

## Validación

```bash
cd backend
npm run typecheck
npm test -- --runInBand
npm run build

cd ../infrastructure/maps/tilegen
mvn test

docker compose config
```

## Seguridad y operación

- Solo Nginx publica puertos; base de datos y caché permanecen en red privada.
- Los secretos viven en `.env`, nunca en Git.
- Las descargas offline requieren archivos y checksums registrados.
- El tráfico público es agregado y aplica umbral de privacidad.
- No se ejecuta ningún motor ni servicio cartográfico de terceros: mapa, rutas y
  búsqueda salen de los datos oficiales procesados por la propia plataforma.

Más detalle: `docs/maps.md`, `docs/integration.md` y `docs/architecture.md`.
