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
- Tres tipos de mapa: mapa vectorial, vista satélite (compuesto Sentinel-2 de
  10 m sin nubes) y relieve (alturas Copernicus de 30 m con sombreado), todos
  servidos por la propia instalación.
- Tráfico sobre las vías: las principales en verde mientras no haya demoras
  reportadas y, encima, los tramos medidos por los recorridos propios en vivo
  (15 min) o con lo habitual a esa hora. Nunca se inventa congestión.
- Capas de actividad, lluvia anual, pisos térmicos y densidad de población
  (mapa de calor), en un archivo aparte que solo se descarga al mostrarlas.
- Validación de cada ruta contra tráfico reciente propio y climatología local.
- API pública, visor web y SDK JavaScript servidos por la misma instalación.
- App Android/iOS (Flutter) con los mismos tipos de mapa, tráfico y capas, y un
  botón «Instalar app» en el visor web: descarga el APK publicado en el
  servidor o instala el visor como aplicación (PWA).
- Descarga offline por región del mapa y de su paquete sin conexión, con
  checksum y manifiesto versionado: sin Internet, el teléfono calcula rutas,
  busca lugares y nombra direcciones con el mismo motor que el servidor.
- Panel de administración web en `/admin/` para administradores y operadores:
  resumen, mapa en vivo, viajes, dispositivos, geocercas, lugares, rutas,
  sincronización, regiones de mapa, eventos, integraciones, cuentas y
  auditoría.
- Integraciones con otras aplicaciones (un ERP, un CRM, reportes): llaves de API
  con permisos y cuota, eventos de viajes, geocercas y regiones, y webhooks
  firmados con reintentos.

## Arquitectura de ejecución

```text
Aplicación / SDK / móvil / panel /admin/ / aplicaciones integradas
          |
        Nginx ------------- /descargas/ (APK de la app), /admin/ (panel)
       /     \
  PMTiles    API NestJS
  (mapa,       |-- rutas nativas (graph.bin)
   relieve,    |-- geocodificación nativa (search.ndjson)
   satélite,   |-- tráfico agregado propio (en vivo y habitual)
   capas)      |-- administración, llaves de API y eventos
               |-- PostgreSQL/PostGIS + Redis
               |
             Worker ---- webhooks firmados hacia las aplicaciones integradas
```

Los portales oficiales solo se consultan en la fase de ingesta. Los archivos
descargados se validan, se resumen en `manifest.json` y se conservan en
`storage/imports/native/`. El servicio en producción lee exclusivamente copias
locales.

## Inicio local

```bash
make init
make prepare-region REGION=ecuador
make up
```

Abrir `http://localhost:8080`. Los datos generados no se versionan en Git.
`make init` crea `.env` con secretos aleatorios y, si ya existe, le agrega las
variables nuevas (por ejemplo `INTEGRATIONS_SECRET_KEY` al actualizar).

El panel de administración está en `http://localhost:8080/admin/`. En
desarrollo entra con `admin@maps.local` y `Admin1234!` (datos de demostración);
en producción crea el primer administrador con el stack en marcha:

```bash
make admin-create EMAIL=tu@correo.com NAME="Tu nombre"
```

Ver `docs/admin.md`.

`prepare-region` también genera el relieve y la vista satélite de las regiones
que los tienen en `infrastructure/regions/regions.json` (`rasters`); para
omitirlos: `docker compose --profile tools run --rm data-tools prepare ecuador
--skip-rasters`. Al actualizar una instalación existente, `docker compose up -d`
recrea Nginx con el volumen nuevo de `storage/app`.

## API para otras aplicaciones

- `GET /api/v1/maps/regions`: regiones y versiones publicadas, con sus
  archivos extra (`assets`: relieve, satélite y capas).
- `GET /api/v1/maps/regions/{id}/download`: mapa PMTiles offline.
- `GET /api/v1/maps/regions/{id}/routing/download`: paquete sin conexión de la
  app (red vial e índice de búsqueda de la región; reanudable, con checksum).
- `GET /api/v1/maps/regions/{id}/assets/{terrain|satellite|overlays}/download`:
  relieve, satélite o capas de la región (reanudable, con checksum).
- `POST /api/v1/routes/calculate`: ruta, distancia, tiempo y condiciones.
- `GET /api/v1/geocoding/search`: búsqueda local.
- `GET /api/v1/geocoding/reverse`: lugar oficial cercano.
- `GET /api/v1/traffic/flow`: tráfico por tramo de vía: en vivo (últimos 15
  minutos) y, donde no hay datos en vivo, lo habitual para ese día y hora
  (`source: live | typical`).
- `GET /api/v1/traffic/activity`: mapa de calor de actividad de las últimas 24 h.
- `GET /api/v1/tracking/traffic`: tráfico agregado por celdas (compatibilidad).
- `GET /sdk/route-maps.js`: SDK web sin CDN.
- `GET /developers.html`: ejemplos de integración.

Una aplicación que necesita los datos de una cuenta (viajes, posiciones,
geocercas, lugares, rutas) se registra como integración en el panel y usa una
llave de API en `X-API-Key`. Recibe los eventos por webhooks firmados o con
`GET /api/v1/events`; `GET /api/v1/integrations/me` muestra la integración, la
cuenta, los permisos y la cuota de la llave. Detalle y ejemplos para verificar
la firma en Node.js, Python y PHP: `docs/integration.md`.

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

El relieve (Copernicus DEM GLO-30) y la vista satélite (compuestos Sentinel-2
de ESA WorldCover, CC BY 4.0) se descargan una sola vez con
`raster-data` y se publican como `<región>.terrain.pmtiles` y
`<región>.satellite.pmtiles`; su procedencia y cita están en la sección
`rasters` de `sources.json`. `publish-region.sh` copia también esos archivos y
el de capas (`<región>.overlays.pmtiles`) y verifica su checksum.

Las ortofotos y la cartografía del IGM no se usan: su licencia prohíbe
redistribuir por Internet la información descargada. El catálogo lo deja
registrado para que nadie la incorpore por error.

## App móvil e instalación desde el visor

El botón «Instalar app» del visor ofrece el APK de Android que el servidor
publica en `/descargas/` y, en navegadores compatibles, instalar el visor como
aplicación (PWA; requiere HTTPS salvo en `localhost`). Para publicar una
compilación nueva:

```bash
cd mobile && flutter build apk --release && cd ..
make publish-app                       # copia a storage/app de esta máquina
make publish-app HOST=usuario@servidor # o la sube al servidor por SSH
```

`publish-app.py` lee la versión del propio APK y deja en `storage/app` el
archivo de esta versión, `route-maps.apk` (la última, con nombre fijo para
enlaces y códigos QR) y `android.json` (versión, tamaño, SHA-256 y Android
mínimo), que el visor lee para ofrecer la descarga.

## Validación

```bash
cd backend
npm run typecheck
npm test -- --runInBand
npm run build

cd ../infrastructure/maps/tilegen
mvn test

cd ../../.. && node --test 'infrastructure/nginx/tests/*.test.mjs'

cd mobile && flutter analyze && flutter test

docker compose config
```

## Seguridad y operación

- Solo Nginx publica puertos; base de datos y caché permanecen en red privada.
  El worker es el único servicio que se conecta a otros servidores: envía los
  webhooks por HTTPS y solo a direcciones públicas.
- Los secretos viven en `.env`, nunca en Git. Las llaves de API se guardan como
  SHA-256 y los secretos de los webhooks, cifrados con
  `INTEGRATIONS_SECRET_KEY`.
- El panel tiene una política de seguridad de contenido estricta, roles
  (`ADMIN`, `OPERATOR`) que también aplica la API, y cada cambio queda en la
  auditoría.
- Las descargas offline requieren archivos y checksums registrados.
- El tráfico público es agregado y aplica umbral de privacidad.
- No se ejecuta ningún motor ni servicio cartográfico de terceros: mapa, rutas y
  búsqueda salen de los datos oficiales procesados por la propia plataforma.

Más detalle: `docs/maps.md`, `docs/integration.md`, `docs/admin.md`,
`docs/architecture.md` y `docs/offline-architecture.md`. El diseño del visor y de la app está en
`design-system/route-maps/`.
