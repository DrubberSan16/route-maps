# Arquitectura

La plataforma tiene una única entrada pública: Nginx. El visor, SDK, estilo,
tipografías, PMTiles y API se sirven desde la misma instalación.

```text
Aplicaciones web/móviles
          |
       HTTPS
          |
        Nginx ---- PMTiles / SDK / estilo / fuentes
          |
       Backend ---- red vial + lugares + límites + agua + clima locales
        |    |
    PostgreSQL  Redis
```

## Responsabilidades

- Nginx: TLS, archivos estáticos, solicitudes Range y proxy de `/api`.
- Backend: autenticación, regiones, rutas nativas, geocodificación nativa,
  tráfico propio, condiciones climáticas, viajes, tracking y sincronización.
- PostgreSQL/PostGIS: usuarios y datos operativos; se ejecuta en
  `ovh-serverPostgres` en producción.
- Redis: caché y control de frecuencia.
- `data-tools`: proceso bajo demanda que descarga fuentes auditadas, valida
  geometrías, construye PMTiles y escribe manifiestos atómicos.

## Datos

`infrastructure/sources/sources.json` es el registro de procedencia. Conserva
organización, URL, licencia, frecuencia y método de cada capa. Las URL remotas
solo se usan durante la ingesta; las solicitudes de usuarios se resuelven con
los archivos locales.

Los archivos persistentes viven bajo `storage/`:

- `imports/native/ecuador/*.geojson`: instantáneas verificadas y manifiesto;
- `maps/<región>/*.pmtiles`: mapa vectorial descargable;
- `maps/<región>/*.region.json`: versión, límites, tamaños y checksums.

## Exposición a otras aplicaciones

`/sdk/route-maps.js` exporta `createMap`, `getRegions`, `searchPlaces`,
`calculateRoute` y `offlineMapUrl`. La API equivalente está documentada en
`/api/docs`. CORS se configura explícitamente con `CORS_ORIGINS`.

## Seguridad y despliegue

Solo Nginx publica puertos. Backend, Redis y PostgreSQL permanecen en red
privada. Los datos geográficos se montan como solo lectura en los servicios de
ejecución. Antes de cada despliegue se respaldan configuración y artefactos, y
la versión anterior se conserva hasta validar HTTPS, salud, ruta, búsqueda y
descarga parcial del PMTiles.
