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

Con `routingFormat: route-maps-pack`, `routingDownloadUrl` es el paquete sin
conexión de la app móvil (`routingSize`, `routingChecksum`): la red vial y el
índice de búsqueda de la región y 5 km alrededor, con los que el teléfono
calcula rutas, busca lugares y nombra direcciones sin Internet. Se descarga
igual que el mapa (Range, `X-Checksum-Sha256`). Su formato binario está descrito
en `infrastructure/data-tools/lib/mapsdata/offline_pack.py`; los límites del
modo sin conexión, en [offline-architecture.md](offline-architecture.md).

## Integraciones: llaves de API, webhooks y eventos

Otra aplicación (un ERP, un CRM, un sistema de reportes) se conecta desde el
[panel de administración](admin.md), en «Integraciones > Nueva integración».
Cada integración:

- actúa como una cuenta: una propia creada para ella
  (`svc-…@integrations.invalid`, que nunca inicia sesión) o una cuenta
  existente. Con sus llaves lee y escribe los viajes, posiciones, geocercas,
  lugares y rutas de esa cuenta, nunca los de otras;
- tiene un límite de solicitudes por minuto que comparten todas sus llaves (600
  por defecto, configurable en el panel);
- recibe los eventos de esa cuenta y los de la plataforma (regiones). Con
  «Recibir los eventos de todas las cuentas» (`eventScope: ALL_ACCOUNTS`)
  recibe también los de todas las personas, con sus posiciones: es para un ERP o
  un sistema de reportes de toda la flota. Sus llaves siguen actuando solo como
  su cuenta.

Pausar una integración, o deshabilitar su cuenta, detiene sus llaves y sus
webhooks hasta que se reactive. Eliminarla borra sus llaves y webhooks; los
datos de la cuenta quedan.

### Llaves de API

Las llaves tienen la forma `rmk_<prefijo>_<secreto>` y se muestran una sola vez
al crearlas (se guarda solo su SHA-256). Se envían en la cabecera `X-API-Key`:

```bash
curl -X POST https://route-map.softwareeasydev.com/api/v1/trips \
  -H "X-API-Key: $ROUTE_MAPS_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Pedido PED-2041","profile":"TRUCK",
       "metadata":{"order":"PED-2041","vehicle":"GYE-1234"}}'
```

`metadata` (hasta 4 KB de JSON) vuelve con el viaje y en sus eventos, para
relacionarlos con los datos propios. Cada llave tiene permisos:

| Permiso | Permite |
| --- | --- |
| `trips:read` | `GET /trips`, `/trips/{id}`, `/trips/{id}/path`, `/tracking/live`, `/tracking/trips/{id}/last` |
| `trips:write` | `POST /trips`, `/trips/{id}/finish`, `/trips/{id}/cancel`, `/tracking/location`, `/tracking/locations/batch` |
| `geofences:read` | `GET /geofences`, `/geofences/{id}`, `/geofences/check` |
| `geofences:write` | `POST /geofences`, `PATCH` y `DELETE /geofences/{id}` |
| `places:read` | `GET /places`, `/places/{id}` |
| `places:write` | `POST /places`, `PATCH` y `DELETE /places/{id}`, `PUT` y `DELETE /places/{id}/favorite` |
| `routes:read` | `GET /routes`, `/routes/{id}` |
| `routes:write` | `POST /routes`, `DELETE /routes/{id}` |
| `events:read` | `GET /events` |

- Las respuestas tienen la forma `{ "success": true, "data": … }`; los errores,
  `{ "success": false, "error": { "code", "message", "requestId" } }`.
- `GET /api/v1/integrations/me` (cualquier llave) dice a qué integración y
  cuenta pertenece la llave, sus permisos, su cuota y su `eventScope`.
- Las rutas públicas (cálculo de rutas, búsqueda, tráfico, mapas) aceptan la
  llave sin permisos especiales: con ella cuentan en la cuota de la integración
  en lugar del límite por dirección IP.
- La administración, las sesiones y la sincronización de la app rechazan las
  llaves (`403 API_KEY_NOT_ALLOWED`).
- Errores: `401 INVALID_API_KEY` (llave desconocida, revocada, vencida o de una
  integración o cuenta deshabilitada), `403 API_KEY_SCOPE_MISSING` (con
  `details.missing`) y `429 RATE_LIMIT_EXCEEDED` (con `Retry-After`). Cada
  respuesta trae `X-RateLimit-Limit`, `X-RateLimit-Remaining` y
  `X-RateLimit-Reset` (segundos).

Una llave puede tener fecha de vencimiento. Para cambiarla sin cortar el
servicio: crea la nueva, cámbiala en la aplicación y revoca la anterior; la
revocación es inmediata.

### Eventos

| Tipo | Cuándo | `data` |
| --- | --- | --- |
| `trip.started` | Se inició un viaje | `trip` |
| `trip.finished` | Terminó (con su distancia) | `trip` |
| `trip.cancelled` | Se canceló | `trip` |
| `geofence.entered` | Un viaje entró en una geocerca de su cuenta | `trip`, `geofence`, `position`, `enteredAt` |
| `geofence.exited` | Salió de ella | lo anterior, `exitedAt` y `dwellSeconds` |
| `region.published` | Se publicó o actualizó una región de mapa | `region` (código, versión, tamaño, checksum, límites) |
| `region.disabled` | Se retiró una región | `region` |
| `webhook.test` | Solo al webhook probado desde el panel | `integration`, `webhook`, `message` |

Todos tienen la misma forma (es el cuerpo de cada webhook y cada elemento de
`items` en `GET /events`):

```json
{
  "id": "6f1c0d0e-2a8b-4f43-9d3e-8a3f4b1f7c21",
  "seq": "1287",
  "type": "geofence.entered",
  "accountId": "b7c4…",
  "account": { "id": "b7c4…", "email": "luis.andrade@empresa.com", "name": "Luis Andrade" },
  "createdAt": "2026-10-07T14:03:11.402Z",
  "data": {
    "trip": { "id": "…", "name": "Pedido PED-2041", "deviceId": null,
              "metadata": { "order": "PED-2041", "vehicle": "GYE-1234" } },
    "geofence": { "id": "…", "name": "Puerto", "type": "POLYGON", "metadata": null },
    "position": { "latitude": -2.2731, "longitude": -79.9093, "accuracy": 6,
                  "recordedAt": "2026-10-07T14:03:09.000Z" },
    "enteredAt": "2026-10-07T14:03:09.000Z"
  }
}
```

`account` es `null` en los eventos de la plataforma (regiones).

### Leer los eventos: `GET /api/v1/events`

Alternativa a los webhooks (o complemento, para ponerse al día): devuelve los
eventos posteriores a una posición, del más antiguo al más nuevo. Parámetros:
`after` (la posición, `0` al empezar), `limit` (1 a 500, 100 por defecto) y
`types` (tipos separados por comas). `data` trae `items`, `next` y `hasMore`:
guarda `next` y vuelve a pedir con `after=next`; mientras `hasMore` sea `true`
hay más esperando. Los eventos aparecen en el orden de su `seq`, así que la
posición guardada nunca deja uno atrás.

```bash
curl "https://route-map.softwareeasydev.com/api/v1/events?after=1286&types=trip.finished,geofence.entered" \
  -H "X-API-Key: $ROUTE_MAPS_KEY"
```

Los eventos se guardan `EVENTS_RETENTION_DAYS` días (30 por defecto), y más
mientras algún webhook tenga pendiente recibirlos.

### Webhooks

Un webhook es una URL de la otra aplicación que recibe los eventos elegidos (o
todos, `*`) como `POST` con el evento en JSON. Reglas de la URL: `https://`
(`http://` solo con `WEBHOOKS_ALLOW_INSECURE=true`), una dirección pública de
Internet (redes privadas solo con `WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true`), sin
usuario ni contraseña y sin `#`. Las redirecciones cuentan como fallo: usa la
URL final.

Cabeceras de cada envío: `Content-Type: application/json`,
`User-Agent: RouteMaps-Webhooks/1.0`, `X-RouteMaps-Event` (tipo),
`X-RouteMaps-Event-Id`, `X-RouteMaps-Delivery` y `X-RouteMaps-Signature`.

- Responde con cualquier `2xx` en menos de `WEBHOOK_TIMEOUT_MS` (10 s por
  defecto); procesa en segundo plano si tarda más.
- Cualquier otra respuesta se reintenta a los 1 min, 5 min, 30 min, 2 h, 6 h,
  12 h y 24 h. Tras 8 intentos (unas 45 horas) la entrega queda fallida. El
  panel muestra cada entrega con su número de intentos, el resultado del último
  (código, error, duración y el primer KB de la respuesta) y permite
  reenviarla.
- Un mismo evento puede llegar más de una vez (un reintento manual, por
  ejemplo) y el orden no está garantizado: usa `X-RouteMaps-Event-Id` para no
  procesarlo dos veces y `seq` para ordenar.
- Mientras un webhook está pausado no se le encolan eventos nuevos (léelos
  luego con `GET /events`); sus reintentos pendientes esperan a que se reanude.

#### Verificar la firma

`X-RouteMaps-Signature: t=1791379039,v1=5f2c…` es el HMAC-SHA256 (hexadecimal)
de `<t>.<cuerpo>` con el secreto del webhook (`whsec_…`, que se muestra una
sola vez al crearlo o cambiarlo). Calcúlalo sobre el cuerpo tal como llegó,
antes de interpretar el JSON, compáralo en tiempo constante y rechaza las
firmas con más de 5 minutos de diferencia.

Node.js (Express):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const app = express();
app.post('/route-maps', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verify(process.env.ROUTE_MAPS_WEBHOOK_SECRET, req.get('x-routemaps-signature') ?? '', req.body)) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body.toString('utf8'));
  // event.type, event.account, event.data…
  res.sendStatus(204);
});
```

Python:

```python
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.strip().split('=', 1) for part in header.split(',') if '=' in part)
    try:
        timestamp = int(parts.get('t', ''))
    except ValueError:
        return False
    if abs(time.time() - timestamp) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f'{timestamp}.'.encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get('v1', ''))
```

PHP:

```php
function verify(string $secret, string $header, string $rawBody, int $tolerance = 300): bool {
    $parts = [];
    foreach (explode(',', $header) as $part) {
        [$name, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        $parts[$name] = $value;
    }
    $timestamp = (int) ($parts['t'] ?? 0);
    if ($timestamp === 0 || abs(time() - $timestamp) > $tolerance) return false;
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    return hash_equals($expected, $parts['v1'] ?? '');
}

// $ok = verify(getenv('ROUTE_MAPS_WEBHOOK_SECRET'), $_SERVER['HTTP_X_ROUTEMAPS_SIGNATURE'] ?? '',
//              file_get_contents('php://input'));
```

Al cambiar el secreto en el panel, el anterior deja de usarse en ese momento:
actualízalo en la aplicación enseguida (lo que falle mientras tanto se
reintenta). «Enviar prueba» manda un `webhook.test` firmado para comprobar la
configuración.

Un proceso aparte, `worker` (la misma imagen del backend), hace los envíos: es
el único servicio que se conecta a otros servidores. `make ps` muestra su
estado y `make logs SERVICE=worker` sus registros.

## CORS, capacidad y procedencia

- `CORS_ORIGINS=*` habilita el API para aplicaciones web de cualquier origen.
  En una instalación privada debe ser una lista explícita.
- Rutas y búsqueda tienen límites por IP. Un cliente de alto volumen usa una
  llave de API: cuenta en la cuota de su integración, que el panel ajusta.
- Las llaves de API son para servidores: no las incluyas en el código de una
  página web o de una app, donde cualquiera puede leerlas.
- La interfaz no muestra marcas de motores o librerías internas. La procedencia
  y licencia de cada conjunto oficial se conserva en el registro auditable de
  fuentes y en `/fuentes.html`. Una aplicación que muestre este mapa debe citar
  las fuentes (el INEC lo exige en todo producto derivado y pide un acuerdo para
  uso comercial); el SDK enlaza esa página desde el control de atribución.
