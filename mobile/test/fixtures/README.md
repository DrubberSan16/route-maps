# Test fixtures

Responses captured from a running platform (the Docker Compose stack with
Valhalla routing) through Nginx at `http://localhost:8080`, with the Monaco
region prepared by the platform's own pipeline
(`infrastructure/data-tools/bin/region.sh`: map, routing graph and manifest,
then registered with `make regions-sync`):

| File | Request |
| --- | --- |
| `regions_list.json` | `GET /api/v1/maps/regions` |
| `route_calculate_monaco.json` | `POST /api/v1/routes/calculate` (car, `alternatives: true`, `language: es-ES`) |
| `route_error.json` | `POST /api/v1/routes/calculate` with points more than 2,000 km apart |
| `sync_push_response.json` | `POST /api/v1/sync/push` (trip, points, finish, route and one invalid operation) |
| `sync_pull_response.json` | `GET /api/v1/sync/pull` (captured again when the pull became a change feed with `next`, from the API run from source against PostGIS) |

The input was the Monaco extract published by the OSRM project for its own
tests, copied to `storage/imports/monaco.osm.pbf` (the environment where the
fixtures were captured could not reach Geofabrik). The geometries, street names
and instructions in these files are derived from OpenStreetMap data.

Map data © OpenStreetMap contributors, available under the Open Database
License (ODbL) 1.0: <https://www.openstreetmap.org/copyright>.
