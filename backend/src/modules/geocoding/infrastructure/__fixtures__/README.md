# Test fixtures

Real responses captured from Nominatim 5.1 (`mediagis/nominatim:5.1`, the
`geocoding` compose profile) after importing the Monaco extract:

| File | Request |
| --- | --- |
| `nominatim-search.json` | `/search?q=Casino&format=jsonv2&addressdetails=1&limit=2&accept-language=es` |
| `nominatim-reverse.json` | `/reverse?lat=43.7384&lon=7.4246&format=jsonv2&addressdetails=1&accept-language=es` |
| `nominatim-reverse-not-found.json` | `/reverse?lat=-60&lon=-120&format=jsonv2&addressdetails=1` (nothing nearby) |
| `nominatim-status.json` | `/status?format=json` |

© OpenStreetMap contributors (ODbL): names and coordinates come from OSM data.
