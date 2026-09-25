# Arquitectura offline

La app está pensada para funcionar sin conexión: el mapa, la ubicación, las
rutas guardadas y la grabación de recorridos no dependen de la red, y todo lo
que el usuario hace sin conexión se sincroniza después sin perder ni duplicar
datos.

## Qué funciona sin conexión

| Funcionalidad | Sin conexión | Detalle |
| --- | --- | --- |
| Ver el mapa | ✅ en regiones descargadas | PMTiles local + glifos locales |
| Ubicación GPS | ✅ | El GPS no necesita datos móviles |
| Buscar por coordenadas | ✅ | "latitud, longitud" en el buscador |
| Buscar rutas guardadas por nombre | ✅ | Consulta a la base local |
| Buscar direcciones | ❌ | Necesita Nominatim en el servidor |
| Rutas guardadas (Modo 1) | ✅ | Tramos de rutas almacenadas en el dispositivo |
| Ruta nueva calculada en el dispositivo (Modo 2) | ❌ pendiente | Ver [Modo 2](#modo-2-motor-de-rutas-en-el-dispositivo-pendiente) |
| Grabar recorridos | ✅ | Puntos en SQLite, se envían al volver la conexión |
| Guardar y borrar rutas | ✅ | Cambio local + operación en la cola |
| Descargar regiones | ❌ | Se reanudan solas al volver la conexión |

## Conectividad real

La app no confía en que haya Wi-Fi o datos: considera que hay conexión solo
cuando el servidor responde `GET /health/live` (Wi-Fi sin Internet o un portal
cautivo cuentan como sin conexión).

- Vuelve a comprobar cada 20 s mientras está sin conexión y cada 2 min con
  conexión, además de cada vez que cambia la red.
- Si una petición a la API falla por red, el estado pasa a sin conexión de
  inmediato y se confirma con una nueva comprobación.

## Mapas offline

### Almacenamiento

```
<Application Support>/offline/
├── regions/<región>/<versión>/<región>.pmtiles   mapa de la región
├── regions/<región>/<versión>/<región>.pmtiles.part   descarga en curso
└── glyphs/<fuente>/<rango>.pbf                    fuentes de las etiquetas
```

- La base local (`downloaded_regions`) guarda la versión, el tamaño, el
  SHA-256, el bbox y la ruta relativa de cada archivo.
- En iOS el directorio `offline/` se marca como excluido de iCloud (los mapas
  se pueden volver a descargar); en Android la app no participa en las copias
  de seguridad.
- Al arrancar, la app olvida las regiones cuyos archivos ya no existen.

### Descarga

1. El usuario elige una región del catálogo (`GET /api/v1/maps/regions`, que se
   guarda en caché para verlo sin conexión).
2. Se comprueba el espacio libre: lo que falta por descargar más un margen de
   50 MB o el 5 %, lo que sea mayor.
3. Los bytes se escriben en `<archivo>.part`. Si la descarga se corta, se
   cancela o se cierra la app, la siguiente continúa con `Range` e `If-Range`
   (ETag): si el archivo del servidor cambió, empieza de nuevo.
4. Al terminar se verifican el tamaño y el SHA-256 (en un isolate, sin bloquear
   la interfaz) y el `.part` se renombra de forma atómica. Un archivo corrupto
   nunca se usa.
5. La región queda activa y se encola una operación `downloaded_region` para
   que el servidor sepa qué versión tiene el dispositivo.

Las descargas interrumpidas por falta de conexión o por cerrar la app se
reanudan solas al volver la conexión o al abrirla de nuevo. El usuario puede
pausar, reanudar, reintentar o descartar cada descarga.

### Actualización

`POST /api/v1/maps/regions/updates` recibe las versiones instaladas y devuelve
las que tienen una versión nueva. La nueva versión se descarga en su propia
carpeta junto a la actual, que se sigue usando hasta que la nueva está completa
y verificada; solo entonces se borran los archivos anteriores.

### Qué mapa se muestra

1. Una región descargada que contenga la posición (o el centro del mapa); la
   más amplia primero.
2. Con conexión y sin región local: el PMTiles del servidor
   (`/maps/<carpeta>/<región>.pmtiles`, leído por rangos).
3. Sin conexión y fuera de toda región descargada: la región descargada más
   reciente, o solo el fondo del mapa si no hay ninguna (las rutas y los
   marcadores se siguen dibujando encima).

El estilo es el mismo que sirve Nginx (`assets/map/style.json`); la app
reemplaza la fuente `basemap` por `pmtiles://file:///…` o
`pmtiles://https://…` y apunta los glifos a los archivos copiados en el
dispositivo, así que las etiquetas se dibujan sin conexión.

## Rutas sin conexión

`HybridRoutingService` decide:

- **Con conexión**: calcula el servidor (ruta principal y alternativas).
- **Sin conexión, o si falla la red, el motor está caído o el servidor da un
  error 5xx**: responde `OfflineRoutingService`.
- Si tampoco hay ruta sin conexión, la app lo explica (motor caído o falta de
  conexión) y **nunca inventa una línea recta**.

### Modo 1: rutas almacenadas (implementado)

Las rutas guardadas (propias o sincronizadas desde otros dispositivos) incluyen
geometría, pasos, distancia y tiempo. Una ruta guardada del mismo perfil
responde la petición cuando:

- el origen está a menos de 150 m de la ruta, y
- el destino está a menos de 150 m de la ruta, más adelante en el sentido de
  la ruta (no se recorren al revés: podría violar sentidos únicos y giros
  prohibidos).

Se devuelve el tramo entre ambos puntos con sus pasos, distancia y tiempo
proporcionales; hasta 2 rutas guardadas más se ofrecen como alternativas. Las
mejores son las que requieren menos desvío para entrar y salir de la ruta.

### Modo 2: motor de rutas en el dispositivo (pendiente)

Calcular una ruta nueva sin conexión requiere el grafo vial de la región y un
motor que corra en el teléfono. **No está implementado**; la arquitectura ya
deja preparado:

- El contrato `OfflineRoutingProvider` (`canRoute`, `calculateRoute`) y su
  registro en `offlineRoutingProviderProvider`; hoy se usa
  `UnavailableOfflineRoutingProvider`, que responde `OFFLINE_ROUTE_UNAVAILABLE`.
- El paquete de routing por región: `make prepare-region` genera
  `storage/routing/<región>/<región>.valhalla.tar` (el mismo grafo que usa el
  servidor), el manifiesto incluye su SHA-256 y la API lo sirve con `Range` en
  `GET /api/v1/maps/regions/{id}/routing/download`. El catálogo que guarda la
  app ya incluye su URL y tamaño.

Pasos para completarlo:

1. Compilar Valhalla para Android (NDK) e iOS (xcframework) y exponer una
   función `route(json) → json` a Flutter por FFI o canal de plataforma.
2. Descargar el paquete de routing junto al mapa (opcional por región, mostrando
   su tamaño) con el mismo gestor de descargas: `.part`, reanudación y SHA-256.
3. Implementar `OfflineRoutingProvider` con Valhalla leyendo el `.tar`
   (`mjolnir.tile_extract`): `canRoute` comprueba que origen y destino estén en
   una región con paquete instalado; `calculateRoute` envía la misma petición que
   el backend y reutiliza el mismo formato de respuesta.
4. Registrarlo en `offlineRoutingProviderProvider`.

## Recorridos y GPS

- Cada punto GPS se escribe en SQLite en cuanto llega (filtro de 3 m; se
  descartan los que tienen una precisión peor que 50 m) y se pasa a la cola de
  sincronización en lotes cada 60 s.
- La grabación sigue con la pantalla apagada: servicio en primer plano con
  notificación en Android y ubicación en segundo plano en iOS.
- Si la app se cierra, el recorrido activo se restaura al abrirla.
- El servidor ignora puntos repetidos (`trip_id` + `recorded_at` es único), así
  que reenviar un lote no duplica datos.

## Sincronización

Cada cambio local se guarda junto con una operación en `sync_queue` **en la
misma transacción**: no hay cambio sin operación ni operación sin cambio.

### Envío (`POST /api/v1/sync/push`)

- Las operaciones se envían en orden (FIFO), en lotes de hasta 100 operaciones
  o 1 MB. El id de cada operación, generado en el dispositivo, es la clave de
  idempotencia: el servidor responde `DUPLICATE` si ya la aplicó.
- Resultado por operación:
  - `APPLIED` o `DUPLICATE`: completada, sale de la cola.
  - `FAILED` con `retryable: true` (error del servidor, límite de peticiones):
    se reintenta con espera exponencial (5 s, 10 s, 20 s… hasta 15 min, 10
    intentos). Las operaciones que vienen detrás en ese lote se reintentan
    también, en orden, porque pueden depender de ella (los puntos de un
    recorrido cuya creación falló).
  - `FAILED` sin reintento (datos rechazados): queda marcada como fallida y
    visible en la pantalla de cuenta para reintentarla.
- Si el servidor rechaza un lote entero (400 o 413), las operaciones se envían
  de una en una para aislar la que no acepta sin bloquear las demás.
- Sin conexión o con la sesión vencida, el lote vuelve a pendiente sin contar
  un intento.

### Recepción (`GET /api/v1/sync/pull?since=`)

- Trae las rutas guardadas creadas, modificadas o borradas en otros
  dispositivos, en páginas de 200 (hasta 50 páginas por ronda).
- El cursor se guarda por usuario y retrocede 5 s respecto de la hora del
  servidor para no perder cambios concurrentes; aplicar dos veces el mismo
  cambio no tiene efecto.
- Conflictos: un borrado local todavía no enviado gana sobre la copia del
  servidor; en lo demás, la última versión del servidor reemplaza la local.

### Cuándo se sincroniza

Al volver la conexión, al iniciar sesión, 2 s después de encolar operaciones,
cada 5 minutos, cuando vence un reintento programado y a pedido desde la
pantalla de cuenta. La sincronización necesita sesión; sin cuenta la app
funciona igual en local.

## Sesión y datos locales

- Los tokens se guardan en el Keystore (Android) y el Keychain (iOS). El token
  de acceso se renueva solo con el refresh token; si el refresh vence, la
  sincronización se detiene hasta volver a iniciar sesión, sin perder la cola.
- Cerrar sesión borra los tokens del dispositivo (y los revoca en el servidor si
  hay conexión). Los mapas descargados, las rutas y los recorridos quedan en el
  dispositivo.

## Pendiente

- Modo 2 (ruta nueva calculada en el dispositivo), descrito arriba.
- Búsqueda de direcciones sin conexión (requiere un índice local de
  direcciones por región).
- Descargas que continúen con la app cerrada por el sistema: hoy se reanudan al
  volver a abrirla.
