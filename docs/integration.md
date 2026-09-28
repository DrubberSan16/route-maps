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

La red vial oficial admite `CAR`, `TRUCK` y `MOTORCYCLE`. Se aceptan hasta 23
paradas intermedias en `waypoints`. La respuesta incorpora `conditions` con
tráfico medido, zonas climáticas, tiempo base y tiempo ajustado.

## Mapas offline

1. Consultar `GET /api/v1/maps/regions`.
2. Descargar `mapDownloadUrl` con soporte de `Range` para reanudar.
3. Verificar `X-Checksum-Sha256` contra `checksum` antes de activar el archivo.
4. Consultar periódicamente `POST /api/v1/maps/regions/updates` con las
   versiones instaladas.

La aplicación móvil incluida implementa ese flujo con archivo `.part`, control
de espacio, reanudación, SHA-256 y reemplazo atómico.

## CORS, capacidad y procedencia

- `CORS_ORIGINS=*` habilita el API para aplicaciones web de cualquier origen.
  En una instalación privada debe ser una lista explícita.
- Rutas y búsqueda tienen límites por IP. Para clientes de alto volumen conviene
  definir contratos de cuota o claves de API antes de elevar esos límites.
- La interfaz no muestra marcas de motores o librerías internas. La procedencia
  y licencia de cada conjunto oficial se conserva en el registro auditable de
  fuentes y debe acompañar cualquier redistribución de los datos.
