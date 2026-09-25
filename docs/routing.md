# Routing

El cálculo de rutas es autohospedado: el backend habla con un motor propio
(Valhalla por defecto, OSRM como alternativa) que corre en la red interna y
nunca se expone a Internet. No se usa ningún servicio externo de rutas.

## Motor elegido: Valhalla

| Criterio | Valhalla | OSRM |
| --- | --- | --- |
| Perfiles | auto, camión, moto, bicicleta y a pie en **un solo grafo** | un grafo y un proceso por perfil |
| Indicaciones | narrativa propia en español (`es-ES`) | solo tipos de maniobra; el backend redacta las indicaciones en español |
| Alternativas | sí (rutas de dos puntos) | sí (rutas de dos puntos) |
| Evitar peajes, autopistas, ferris | sí, por perfil | con `exclude` si el perfil lo define |
| Uso en el móvil (Modo 2) | el paquete `.valhalla.tar` sirve también en el dispositivo | — |
| Consultas | rápidas | muy rápidas (MLD/CH) |

Valhalla cubre todos los perfiles que pide la plataforma con un único grafo por
región, da indicaciones en español sin trabajo adicional y su paquete de
teselas es el mismo que puede usar la app en el futuro para calcular rutas sin
conexión. Por eso es el motor por defecto (`ROUTING_PROVIDER=valhalla`). El
backend accede a los motores mediante una interfaz (`RoutingProvider`), así que
cambiar de motor no afecta a la API ni a la app.

Imagen: `ghcr.io/valhalla/valhalla:3.9.0` (última versión publicada al momento
de escribir esto; se cambia con `VALHALLA_IMAGE`).

## Preparar el grafo

```bash
make prepare-region REGION=guayaquil   # extracto + mapa + grafo + manifiesto
make build-routing REGION=guayaquil    # solo el grafo (el extracto ya debe existir)
```

El grafo se construye en el contenedor `data-tools`
(`infrastructure/valhalla/scripts/build-routing.sh`), nunca al arrancar los
servicios:

1. `valhalla_build_admins`: áreas administrativas (lado de conducción y reglas
   de acceso por país). Si falla, continúa sin ellas.
2. `valhalla_build_tiles`: teselas del grafo.
3. `valhalla_build_extract`: empaqueta las teselas en
   `storage/routing/<región>/<región>.valhalla.tar`.
4. Escribe `valhalla.json` (configuración de ejecución) y reemplaza el grafo
   anterior de forma atómica: el servicio nunca ve un grafo a medio escribir.

`VALHALLA_BUILD_THREADS` limita los hilos (por defecto, todos los núcleos).

## Servir una región

El servicio `routing` sirve la región de `ROUTING_REGION`:

```bash
# .env
ROUTING_REGION=guayaquil
```

```bash
docker compose up -d routing
```

- Si el grafo todavía no existe, el contenedor espera y lo revisa cada 30 s;
  mientras tanto su healthcheck falla y la API responde
  `503 ROUTING_PROVIDER_UNAVAILABLE`.
- `make prepare-region` reinicia `routing` cuando reconstruye la región que
  está sirviendo.
- `VALHALLA_SERVER_THREADS` fija los hilos del servidor (2 por defecto).

**Una región por servicio.** Para rutas en varias regiones hay dos opciones:
preparar una región que las contenga a todas (por ejemplo `ecuador` en lugar de
`guayaquil` y `quito`) o levantar un servicio de routing por región y enrutar
cada petición al que corresponda (no incluido en esta versión).

## API

`POST /api/v1/routes/calculate` (público; con sesión se pueden guardar las
rutas con `POST /api/v1/routes`).

```json
{
  "origin": { "latitude": -2.1709, "longitude": -79.9224 },
  "destination": { "latitude": -2.145, "longitude": -79.89 },
  "waypoints": [],
  "profile": "CAR",
  "alternatives": true,
  "language": "es-ES",
  "options": { "avoidTolls": false, "avoidHighways": false, "avoidFerries": false }
}
```

- `profile`: `CAR`, `TRUCK`, `MOTORCYCLE`, `BICYCLE` o `PEDESTRIAN`
  (costings `auto`, `truck`, `motorcycle`, `bicycle`, `pedestrian`).
- `waypoints`: hasta 23 paradas intermedias; con paradas no hay alternativas.
- `alternatives`: `true` o un número; el servidor devuelve como máximo
  `ROUTING_MAX_ALTERNATIVES` (2 por defecto, hasta 3).
- `language`: idioma de las indicaciones (`ROUTING_LANGUAGE`, `es-ES` por
  defecto).

Respuesta (extracto real, Mónaco):

```json
{
  "success": true,
  "data": {
    "routeId": "d951d5bb-42fd-4c78-a74a-8a274393d1bf",
    "type": "PRIMARY",
    "profile": "CAR",
    "provider": "valhalla",
    "distanceMeters": 2487,
    "durationSeconds": 198,
    "geometry": { "type": "LineString", "coordinates": [[7.424532, 43.738293], "…"] },
    "bbox": ["…"],
    "steps": [
      {
        "instruction": "Conduzca hacia el noroeste por Avenue de l'Hermitage.",
        "distanceMeters": 20,
        "durationSeconds": 2.1,
        "maneuver": "DEPART",
        "location": [7.424532, 43.738293],
        "streetNames": ["Avenue de l'Hermitage"],
        "geometryIndex": [0, 1]
      }
    ],
    "routes": ["ruta principal", "alternativa (type: ALTERNATIVE)"]
  }
}
```

- La geometría es GeoJSON (`[longitud, latitud]`); cada paso indica con
  `geometryIndex` el tramo de la geometría que recorre, para la navegación paso
  a paso.
- Las rutas se guardan en Redis 10 minutos (`ROUTING_CACHE_TTL_SECONDS`) por
  perfil, puntos redondeados a 5 decimales (~1 m), idioma y opciones. Cada
  respuesta lleva ids nuevos.

Errores:

| Código | HTTP | Causa |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Cuerpo inválido (perfil desconocido, latitud fuera de rango…) |
| `INVALID_COORDINATES` | 400 | Coordenadas fuera de rango, origen igual a destino o puntos a más de 2.000 km |
| `ROUTE_NOT_FOUND` | 404 / 422 | El motor no encontró ruta (puntos fuera de la región o sin calles cerca) |
| `ROUTING_PROFILE_NOT_SUPPORTED` | 422 | El motor configurado no tiene ese perfil (OSRM sin grafo de bicicleta, por ejemplo) |
| `ROUTING_PROVIDER_UNAVAILABLE` | 503 | El motor no responde (sin grafo, reiniciando) |

La app usa las rutas guardadas cuando no hay conexión o el motor no está
disponible ([offline-architecture.md](offline-architecture.md)).

## Alternativa: OSRM

El backend incluye un adaptador para OSRM. OSRM necesita un grafo y un proceso
por perfil (auto, bicicleta, a pie; no tiene camión ni moto) y el algoritmo MLD
requiere tres pasos de preparación:

```bash
REGION=guayaquil
OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v26.4.0
DIR="$PWD/storage/routing/osrm/$REGION"
mkdir -p "$DIR" && cp "storage/imports/$REGION.osm.pbf" "$DIR/"
docker run --rm -v "$DIR:/data" $OSRM_IMAGE osrm-extract -p /opt/car.lua /data/$REGION.osm.pbf
docker run --rm -v "$DIR:/data" $OSRM_IMAGE osrm-partition /data/$REGION.osrm
docker run --rm -v "$DIR:/data" $OSRM_IMAGE osrm-customize /data/$REGION.osrm
```

`docker-compose.override.yml` (Docker Compose lo carga automáticamente y no se versiona; si ya
lo usas para publicar puertos en desarrollo, agrega el servicio al mismo archivo):

```yaml
services:
  osrm:
    image: ghcr.io/project-osrm/osrm-backend:v26.4.0
    command: osrm-routed --algorithm mld /data/guayaquil.osrm
    volumes:
      - ./storage/routing/osrm/guayaquil:/data:ro
    networks: [maps-network]
```

`.env`:

```bash
ROUTING_PROVIDER=osrm
OSRM_URL=http://osrm:5000
# Opcionales, un servicio por perfil preparado con /opt/bicycle.lua y /opt/foot.lua:
# OSRM_BICYCLE_URL=http://osrm-bicycle:5000
# OSRM_FOOT_URL=http://osrm-foot:5000
```

Con OSRM el servicio `routing` (Valhalla) no se usa y se puede detener
(`docker compose stop routing`). Los perfiles sin URL responden
`ROUTING_PROFILE_NOT_SUPPORTED`.

## Geocoding (Nominatim)

La búsqueda de direcciones (`GET /api/v1/geocoding/search`,
`GET /api/v1/geocoding/reverse`) es opcional y usa Nominatim autohospedado
(`mediagis/nominatim:5.1`, perfil `geocoding`). Sin él, la API responde que el
geocoding está desactivado y la app ofrece coordenadas, pulsación larga en el
mapa y rutas guardadas.

```bash
make download-region REGION=guayaquil    # el extracto a importar
# .env: GEOCODING_PROVIDER=nominatim, NOMINATIM_REGION=guayaquil, NOMINATIM_PASSWORD=<aleatoria>
make geocoding-up
docker compose up -d backend             # para que tome GEOCODING_PROVIDER
```

- El primer arranque importa el extracto: minutos para una ciudad, horas para
  un país; el healthcheck espera hasta 6 h.
- Requisitos orientativos: 2 GB de RAM para una ciudad; 8 GB o más para
  Ecuador completo (límite en producción: `NOMINATIM_MEMORY_LIMIT`). Los
  parámetros de PostgreSQL de Nominatim se ajustan con `NOMINATIM_PG_*`.
- `GEOCODING_COUNTRY_CODES=ec` limita los resultados a Ecuador; las búsquedas
  se sesgan hacia la posición del usuario cuando la app la conoce.
- Los resultados se guardan en Redis 24 h.
