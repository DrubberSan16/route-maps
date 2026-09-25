# Test fixtures

Real responses captured from the routing engines running on the Monaco extract
(`make prepare-region REGION=monaco`), trimmed of fields the adapters do not
read (Valhalla `verbal_*` narrative, OSRM `intersections` and waypoint hints).

| File | Request |
| --- | --- |
| `valhalla-route-monaco.json` | Valhalla 3.3 `/route`, `auto`, 2 locations, `alternates: 1`, `es-ES`, `polyline6` |
| `valhalla-route-monaco-stops.json` | Valhalla 3.3 `/route`, `auto`, 3 `break` locations (one intermediate stop) |
| `osrm-route-monaco.json` | OSRM 5.26 `/route/v1/driving`, car profile, 2 coordinates, `steps=true&geometries=geojson&overview=full` |
| `osrm-route-monaco-stops.json` | Same OSRM request with one intermediate stop |

© OpenStreetMap contributors (ODbL): street names and geometries come from OSM data.
