# Route Maps

Plataforma cartográfica autónoma para Ecuador. La instalación descarga
instantáneas auditables de fuentes oficiales, genera sus propias teselas
vectoriales, calcula rutas con su propio grafo, busca lugares localmente y
publica mapas descargables para uso sin conexión. Ninguna vista solicita mapas,
rutas o geocodificación a proveedores externos durante la ejecución.

## Capacidades

- Mapa vectorial PMTiles de Ecuador, servido con peticiones HTTP Range.
- Red vial estatal nacional y motor de rutas nativo para auto, camión y moto.
- Provincias, cantones, parroquias, localidades, cuerpos de agua, salud,
  educación y turismo.
- Regiones climáticas de precipitación incluidas en el mapa.
- Validación de cada ruta contra tráfico reciente propio y climatología local.
- Geocodificación local de localidades y puntos de interés oficiales.
- API pública, visor web y SDK JavaScript servidos por la misma instalación.
- Descarga offline del archivo de mapa con checksum y manifiesto versionado.
- Actualización programable, atómica y con registro de procedencia.

## Arquitectura de ejecución

```text
Aplicación / SDK / móvil
          |
        Nginx
       /     \
  PMTiles    API NestJS
               |-- rutas nativas (roads.geojson)
               |-- geocodificación nativa
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
- `GET /api/v1/tracking/traffic`: tráfico agregado, solo cuando hay al menos
  tres viajes y cinco muestras por celda.
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
`infrastructure/systemd/`.

Las ortofotos no se descargan automáticamente: el IGM exige un flujo controlado
de acceso/licencia. El catálogo deja preparada esa fuente, pero evita publicar
imágenes sin autorización.

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
- Los motores heredados están bajo perfiles opcionales y no arrancan por
  defecto.

Más detalle: `docs/maps.md`, `docs/integration.md` y `docs/architecture.md`.
