# Arquitectura

La plataforma tiene una única entrada pública: Nginx. El visor, SDK, estilo,
tipografías, PMTiles y API se sirven desde la misma instalación.

```text
Aplicaciones web/móviles, panel /admin/
y aplicaciones integradas (llaves de API)
          |
       HTTPS
          |
        Nginx ---- PMTiles (mapa, capas, relieve, satélite) / SDK / estilo /
          |        fuentes / /descargas/ (APK) / panel /admin/
       Backend ---- red vial + lugares + límites + agua + clima locales
        |    |
    PostgreSQL  Redis
        |
      Worker ---- webhooks firmados (HTTPS) hacia las aplicaciones integradas
```

## Responsabilidades

- Nginx: TLS, archivos estáticos, solicitudes Range, el APK de `/descargas/`,
  el panel de administración `/admin/` y proxy de `/api`. Los PMTiles se piden
  con su checksum en la URL y se guardan en caché como inmutables; el visor es
  instalable (PWA, `sw.js`). El panel son páginas estáticas sin compilación,
  con una política de seguridad de contenido estricta.
- Backend: autenticación, regiones y sus archivos extra, rutas nativas,
  geocodificación nativa, tráfico propio (en vivo y habitual), condiciones
  climáticas, viajes, tracking, geocercas y sincronización. También la API de
  administración (`/api/v1/admin`, roles `ADMIN` y `OPERATOR`, con auditoría),
  las llaves de API de las integraciones (permisos y cuota por integración) y
  el registro de eventos (viajes, geocercas, regiones).
- Worker: el mismo código del backend en otro proceso (`node
  dist/src/worker.js`). Envía los eventos a los webhooks de las integraciones,
  firmados con HMAC-SHA256, con reintentos durante unas 45 horas y sin seguir
  redirecciones ni conectarse a direcciones privadas; cada hora borra los
  eventos vencidos. Es el único servicio que abre conexiones hacia otros
  servidores.
- PostgreSQL/PostGIS: usuarios y datos operativos; se ejecuta en
  `ovh-serverPostgres` en producción.
- Redis: caché. Los límites de frecuencia (por dirección IP y la cuota de cada
  integración) se cuentan en la memoria del proceso del backend, así que valen
  por instancia.
- `data-tools`: proceso bajo demanda que descarga fuentes auditadas, valida
  geometrías, construye PMTiles (vectoriales y ráster de relieve y satélite) y
  escribe manifiestos atómicos.

## Datos

`infrastructure/sources/sources.json` es el registro de procedencia. Conserva
organización, URL, licencia, frecuencia y método de cada capa. Las URL remotas
solo se usan durante la ingesta; las solicitudes de usuarios se resuelven con
los archivos locales.

Los archivos persistentes viven bajo `storage/`:

- `imports/native/ecuador/*.geojson`: instantáneas verificadas y manifiesto;
- `imports/raster/`: teselas de altura y compuestos satelitales descargados;
- `maps/<región>/<región>.pmtiles`: mapa vectorial descargable;
- `maps/<región>/<región>.{overlays,terrain,satellite}.pmtiles`: población y
  clima, relieve y vista satélite;
- `maps/<región>/*.region.json`: versión, límites, tamaños y checksums del mapa
  y de sus archivos extra;
- `app/`: APK publicado con `publish-app.py` para el botón «Instalar app».

## Exposición a otras aplicaciones

`/sdk/route-maps.js` exporta `createMap`, `getRegions`, `searchPlaces`,
`calculateRoute` y `offlineMapUrl`. El mapa que devuelve `createMap` cambia de
tipo (`setMapType`: mapa, satélite o relieve) y muestra el tráfico y las capas
(`setTraffic`, `setOverlay`). La API equivalente está documentada en
`/api/docs`. CORS se configura explícitamente con `CORS_ORIGINS`.

Otras aplicaciones (un ERP, un CRM) se conectan como integraciones que un
administrador crea en el panel: actúan como una cuenta con llaves de API
(`X-API-Key`) y reciben los eventos por webhooks firmados o con
`GET /api/v1/events`. Ver [integration.md](integration.md) y
[admin.md](admin.md).

## Seguridad y despliegue

Solo Nginx publica puertos. Backend, Redis y PostgreSQL permanecen en red
privada; el worker también usa la red `edge` para enviar los webhooks. Los
datos geográficos se montan como solo lectura en los servicios de ejecución.
Antes de cada despliegue se respaldan configuración y artefactos, y la versión
anterior se conserva hasta validar HTTPS, salud, ruta, búsqueda y descarga
parcial del PMTiles.
