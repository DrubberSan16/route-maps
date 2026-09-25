# Test fixtures

Responses captured from a running platform (`docker compose up` with the
Monaco extract loaded by `scripts/import-osm.sh` and the routing graph built by
`scripts/prepare-routing.sh`), through Nginx at `http://localhost:8080`:

| File | Request |
| --- | --- |
| `regions_list.json` | `GET /api/v1/maps/regions` |
| `route_calculate_monaco.json` | `POST /api/v1/routes/calculate` (car, `alternatives: true`, `language: es-ES`) |
| `route_error.json` | `POST /api/v1/routes/calculate` with a point in the sea |
| `sync_push_response.json` | `POST /api/v1/sync/push` (trip, points, finish, route and one invalid operation) |
| `sync_pull_response.json` | `GET /api/v1/sync/pull` |

The Monaco extract is the one published by the OSRM project for its own tests;
the geometries, street names and instructions in these files are derived from
OpenStreetMap data.

Map data © OpenStreetMap contributors, available under the Open Database
License (ODbL) 1.0: <https://www.openstreetmap.org/copyright>.
