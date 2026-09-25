# Arquitectura

Visión general de los componentes de la plataforma, cómo se despliegan y cómo
fluyen los datos entre ellos. El comportamiento sin conexión está en
[offline-architecture.md](offline-architecture.md), el cálculo de rutas en
[routing.md](routing.md) y la generación de mapas en [maps.md](maps.md).

## Despliegue

```mermaid
flowchart TB
  subgraph clients["Clientes"]
    app["App Flutter<br/>Android / iOS"]
    viewer["Visor web<br/>(MapLibre GL JS)"]
  end

  subgraph edge["Red edge"]
    nginx["nginx<br/>único puerto publicado"]
    tools["data-tools<br/>(perfil tools, bajo demanda)"]
  end

  subgraph internal["Red maps-network (internal: true, sin salida a Internet)"]
    backend["backend<br/>NestJS :3000"]
    postgres[("postgres<br/>PostGIS")]
    redis[("redis")]
    routing["routing<br/>Valhalla :8002"]
    nominatim["nominatim<br/>(perfil geocoding)"]
  end

  storage[("./storage<br/>imports · maps · routing")]
  geofabrik["Geofabrik<br/>extractos .osm.pbf"]

  app -->|HTTPS| nginx
  viewer --> nginx
  nginx -->|/api, /health| backend
  nginx -->|PMTiles con Range<br/>descargas X-Accel-Redirect| storage
  backend --> postgres
  backend --> redis
  backend --> routing
  backend --> nominatim
  backend -->|manifiestos, solo lectura| storage
  routing -->|grafo, solo lectura| storage
  tools -->|descarga| geofabrik
  tools -->|escribe PMTiles, grafos y manifiestos| storage
```

- **Nginx** es el único servicio con puertos publicados. Hace de proxy de la
  API, sirve los PMTiles por rangos de bytes, entrega las descargas de regiones
  que autoriza el backend (`X-Accel-Redirect`) y publica el visor web.
- **maps-network** es una red interna de Docker: PostgreSQL, Redis, Valhalla,
  Nominatim y el backend no son accesibles desde fuera ni tienen salida a
  Internet.
- **data-tools** solo existe mientras se prepara una región
  (`make prepare-region`); es el único contenedor que descarga datos.
- **./storage** separa los datos geográficos (regenerables) de la base de datos:
  `imports/` (extractos), `maps/<carpeta>/` (PMTiles y manifiestos) y
  `routing/<región>/` (grafos de Valhalla).

## Backend

Monolito modular en NestJS. Cada módulo agrupa su dominio y separa en capas lo
que necesita: `domain` (entidades, contratos), `application` (casos de uso,
DTO), `infrastructure` (Prisma, HTTP a motores externos) y `presentation`
(controladores).

```mermaid
flowchart LR
  subgraph api["Módulos de la API"]
    auth[auth] --> users[users]
    routing[routing]
    trips[trips] --> users
    tracking[tracking] --> trips
    places[places]
    geofences[geofences]
    geocoding[geocoding]
    regions[regions] --> maps[maps]
    sync[synchronization] --> trips & tracking & routing & places & regions & users
    health[health] --> routing & geocoding
  end
  subgraph infra["Infraestructura compartida"]
    prisma[(Prisma / PostGIS)]
    cache[(Caché Redis)]
    config[Configuración validada]
  end
  api --> prisma
  routing & regions & geocoding --> cache
```

| Módulo | Responsabilidad |
| --- | --- |
| `auth` | Registro, login, JWT de acceso y refresh con rotación (refresh guardado como hash) |
| `users` | Perfil y dispositivos (`installationId` estable por instalación) |
| `maps` | Almacenamiento de mapas: lectura de manifiestos y rutas de archivos en `MAP_STORAGE_PATH` |
| `regions` | Catálogo de regiones, versiones, actualizaciones, localización por coordenada y descargas con `Range` |
| `routing` | Cálculo de rutas con Valhalla u OSRM (adaptadores intercambiables) y rutas guardadas |
| `trips` / `tracking` | Recorridos y puntos GPS (lotes idempotentes por `trip_id` + `recorded_at`) |
| `places` / `geofences` | Lugares, favoritos y geocercas (círculo o polígono, consultas PostGIS) |
| `geocoding` | Búsqueda y geocodificación inversa con Nominatim (o desactivado) |
| `synchronization` | `push` de operaciones offline y `pull` de cambios de otros dispositivos |
| `health` | Estado de base de datos, Redis, routing y geocoding |

Transversal: validación global (`class-validator`, `whitelist`), filtro de
errores con respuesta uniforme y `requestId`, logs JSON con Pino (sin
contraseñas ni tokens), límite de peticiones (`@nestjs/throttler`), guardas JWT
y de rol (`@Public`, `@Roles(ADMIN)`), Swagger generado desde los DTO.

### Modelo de datos

```mermaid
erDiagram
  users ||--o{ refresh_tokens : tiene
  users ||--o{ devices : usa
  users ||--o{ routes : guarda
  users ||--o{ trips : graba
  users ||--o{ places : crea
  users ||--o{ favorite_places : marca
  users ||--o{ geofences : define
  users ||--o{ synchronization_events : envía
  devices ||--o{ downloaded_regions : almacena
  map_regions ||--o{ downloaded_regions : "se descarga en"
  routes ||--o{ route_points : "paradas"
  routes ||--o{ trips : "sigue"
  trips ||--o{ trip_points : "puntos GPS"
  places ||--o{ favorite_places : ""
```

Las geometrías son columnas PostGIS en SRID 4326 (`geometry(Point|LineString|Polygon, 4326)`)
con índices GiST; Prisma las declara como `Unsupported` y los repositorios las
leen y escriben con SQL parametrizado (`ST_GeomFromGeoJSON`, `ST_AsGeoJSON`).
`synchronization_events` registra cada operación offline por
`(user_id, client_operation_id)`: es la clave de idempotencia de la
sincronización.

## App móvil

```mermaid
flowchart TB
  features["features/<br/>pantallas y controladores (Riverpod)"]
  presentation["presentation/<br/>composición de dependencias"]
  services["services/<br/>ruteo híbrido, sincronización,<br/>descargas, grabación, estilo"]
  domain["domain/<br/>entidades y contratos"]
  data["data/<br/>Drift (SQLite), cliente HTTP (Dio),<br/>repositorios"]
  infrastructure["infrastructure/<br/>GPS, conectividad, Keystore/Keychain,<br/>archivos, descargas"]

  features --> presentation
  features --> services
  presentation --> services & data & infrastructure
  services --> domain
  data --> domain
  infrastructure --> domain
```

- Los widgets no hacen HTTP ni SQL: leen providers de Riverpod que exponen
  servicios y repositorios definidos por contratos del dominio.
- La base local (Drift/SQLite) es la fuente de verdad de la interfaz: regiones
  descargadas, rutas guardadas, recorridos, puntos GPS y la cola de
  sincronización.
- El mapa es MapLibre con el mismo estilo que sirve Nginx; la fuente de datos
  es el PMTiles descargado o, con conexión, el del servidor.

## Flujos principales

### Calcular una ruta

```mermaid
sequenceDiagram
  participant App
  participant Nginx
  participant API as Backend
  participant Redis
  participant V as Valhalla
  App->>Nginx: POST /api/v1/routes/calculate
  Nginx->>API: proxy (límite 30 r/s por IP)
  API->>API: valida coordenadas, perfil y distancia
  API->>Redis: ¿ruta en caché?
  alt en caché
    Redis-->>API: ruta
  else
    API->>V: /route (costing del perfil, idioma, alternativas)
    V-->>API: trayecto
    API->>Redis: guarda 10 min
  end
  API-->>App: ruta principal + alternativas (GeoJSON, pasos, distancia, tiempo)
```

Sin conexión, o si el motor no responde, la app usa las rutas guardadas en el
dispositivo (ver [offline-architecture.md](offline-architecture.md)).

### Preparar y descargar una región

```mermaid
sequenceDiagram
  participant Op as Operador
  participant T as data-tools
  participant S as ./storage
  participant API as Backend
  participant App
  participant N as Nginx
  Op->>T: make prepare-region REGION=guayaquil
  T->>T: descarga o recorta el extracto (MD5, osmium)
  T->>S: maps/ecuador/guayaquil.pmtiles (Planetiler)
  T->>S: routing/guayaquil/ (Valhalla)
  T->>S: guayaquil.region.json (versión, SHA-256, bbox)
  Op->>API: registro (sync-regions)
  API->>S: lee manifiestos → tabla map_regions
  App->>API: GET /maps/regions
  App->>API: GET /maps/regions/guayaquil/download (Range)
  API-->>N: X-Accel-Redirect /_protected/maps/…
  N-->>App: bytes (206 con Range) + X-Checksum-Sha256
  App->>App: verifica SHA-256 y activa la región
  App->>API: sync: downloaded_region (cuando haya sesión y conexión)
```

### Sincronización offline

```mermaid
sequenceDiagram
  participant UI as App (UI)
  participant DB as SQLite
  participant Q as Cola sync_queue
  participant API as Backend
  UI->>DB: guarda recorrido / ruta / puntos
  DB->>Q: operación con id único (misma transacción)
  Note over Q: sin conexión: la cola espera
  Q->>API: POST /sync/push (lotes en orden)
  API-->>Q: APPLIED · DUPLICATE · FAILED (retryable o no)
  Q->>API: GET /sync/pull?since=cursor
  API-->>DB: rutas cambiadas y borradas en otros dispositivos
```

## Seguridad

- Secretos solo en `.env` (fuera de Git); Compose falla si faltan.
- Contraseñas con Argon2; refresh tokens guardados como hash SHA-256, rotados en
  cada uso y revocados al cerrar sesión. Reutilizar un refresh ya usado revoca
  todas las sesiones del usuario.
- Solo Nginx es accesible; PostgreSQL, Redis, Valhalla y Nominatim están en una
  red interna.
- Validación estricta de entrada y errores sin detalles internos; límites de
  peticiones en Nginx y en la API.
- En la app, los tokens van al Keystore/Keychain y el tráfico sin TLS solo se
  permite en desarrollo.
