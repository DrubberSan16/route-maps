# Integración con aplicaciones externas

Una instalación de Route Maps es a la vez el visor y el servicio cartográfico.
En producción no llama a APIs de mapas, rutas o búsqueda de terceros: Nginx
sirve el SDK, estilo, glifos y PMTiles; el backend ofrece geocodificación y
routing desde los motores privados de la misma instalación.

## SDK web

```html
<div id="map" style="height: 480px"></div>
<script type="module">
  import { createMap } from
    'https://route-map.softwareeasydev.com/sdk/route-maps.js';

  const platform = await createMap({
    container: 'map',
    region: 'ecuador',
  });
</script>
```

El SDK carga desde la misma instalación todos sus recursos de ejecución; no
usa CDN. Exporta:

| Función | Resultado |
| --- | --- |
| `createMap(options)` | mapa, catálogo y funciones enlazadas a la instalación |
| `getRegions(options?)` | regiones publicadas y sus versiones/checksums |
| `searchPlaces(query, options?)` | países, ciudades, direcciones y puntos de interés |
| `calculateRoute(input, options?)` | ruta principal, alternativas, geometría e indicaciones |
| `offlineMapUrl(regionId, options?)` | URL de descarga PMTiles reanudable |

Opciones de `createMap` además de `container`: `baseUrl`, `region` (por defecto `ecuador`), `center`,
`zoom`, `minZoom`, `maxZoom`, `navigationControl`, `mapType` (`map`, `satellite` o `relief`), `traffic`
(`true` para empezar con el tráfico visible) y `onTrafficStatus(text)` (qué muestra el tráfico en la zona).

El objeto devuelto por `createMap` incluye:

| Miembro | Uso |
| --- | --- |
| `map` | el mapa MapLibre, para añadir capas o eventos propios |
| `mapTypes` | `[{ id, label, available }]`: tipos de mapa y si la región tiene sus datos |
| `setMapType(type)` / `getMapType()` | cambia o lee el tipo; devuelve `false` y deja el mapa normal si la región no publica la imagen o la altura |
| `setTraffic(visible)` | vías principales en verde sin demoras reportadas y, encima, los tramos medidos |
| `setOverlay(kind, visible)` | capas `precipitation` (lluvia anual), `temperature` (pisos térmicos) y `population` (mapa de calor) |

```js
const platform = await createMap({ container: 'map', region: 'guayaquil', mapType: 'satellite' });
platform.setTraffic(true);
platform.setMapType('relief');
```

Los iconos de los puntos de interés se dibujan en el navegador (`/sdk/map-icons.js`). La vista satélite y
el relieve llevan su cita en el control de atribución del mapa.

`baseUrl` es opcional y permite apuntar a otra instalación. Las coordenadas de
la API usan `{ latitude, longitude }`; GeoJSON mantiene el orden estándar
`[longitude, latitude]`.

## Rutas por REST

```http
POST /api/v1/routes/calculate
Content-Type: application/json

{
  "origin": { "latitude": -2.1960, "longitude": -79.8832 },
  "destination": { "latitude": -2.1709, "longitude": -79.9224 },
  "profile": "CAR",
  "alternatives": true
}
```

Perfiles: `CAR`, `TRUCK`, `MOTORCYCLE`, `BICYCLE` y `PEDESTRIAN`. Se aceptan hasta 23
paradas intermedias en `waypoints`. La respuesta incorpora `conditions` con
tráfico medido, zonas climáticas, tiempo base y tiempo ajustado, indicaciones con
nombres de calles y, cuando existen, `approximateSections` (accesos sin vía
registrada que se deben dibujar como aproximados).

## Búsqueda, tráfico y actividad

- `GET /api/v1/geocoding/search?q=…&lat=…&lng=…`: lugares, calles, intersecciones
  ("Av. 9 de Octubre y Boyacá") y puntos de interés de todo el país.
- `GET /api/v1/geocoding/reverse?lat=…&lng=…`: calle, lugar y división administrativa.
- `GET /api/v1/traffic/flow?bbox=…` y `GET /api/v1/traffic/activity?bbox=…`: tráfico por
  tramo (en vivo de los últimos 15 minutos o, donde no hay, lo habitual para ese día y hora;
  `properties.source`: `live` o `typical`) y mapa de calor de actividad (GeoJSON, ver
  `docs/routing.md` y `docs/maps.md`).

## Mapas offline

1. Consultar `GET /api/v1/maps/regions`.
2. Descargar `mapDownloadUrl` con soporte de `Range` para reanudar.
3. Verificar `X-Checksum-Sha256` contra `checksum` antes de activar el archivo.
4. Consultar periódicamente `POST /api/v1/maps/regions/updates` con las
   versiones instaladas.

La aplicación móvil incluida implementa ese flujo con archivo `.part`, control
de espacio, reanudación, SHA-256 y reemplazo atómico.

Cada región puede publicar además `assets` (relieve `terrain`, satélite
`satellite` y capas `overlays`), cada uno con `tilesUrl` para leerlo en línea,
`downloadUrl` reanudable, `checksum`, `size`, `format` y zooms.

## CORS, capacidad y procedencia

- `CORS_ORIGINS=*` habilita el API para aplicaciones web de cualquier origen.
  En una instalación privada debe ser una lista explícita.
- Rutas y búsqueda tienen límites por IP. Para clientes de alto volumen conviene
  definir contratos de cuota o claves de API antes de elevar esos límites.
- La interfaz no muestra marcas de motores o librerías internas. La procedencia
  y licencia de cada conjunto oficial se conserva en el registro auditable de
  fuentes y en `/fuentes.html`. Una aplicación que muestre este mapa debe citar
  las fuentes (el INEC lo exige en todo producto derivado y pide un acuerdo para
  uso comercial); el SDK enlaza esa página desde el control de atribución.
