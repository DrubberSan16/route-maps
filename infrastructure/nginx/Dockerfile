# syntax=docker/dockerfile:1
# Nginx image of the platform: configuration, glyphs, style template and the
# developer map viewer. Build context: ./infrastructure
ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.28-alpine

# Viewer libraries (MapLibre GL JS + PMTiles) and its font (Inter, SIL OFL 1.1)
# taken from the npm registry at build time, so no third-party CDN is needed at
# runtime.
FROM ${NODE_IMAGE} AS viewer-libs
ARG MAPLIBRE_GL_VERSION=6.11.2
ARG PMTILES_VERSION=4.5.0
ARG INTER_VERSION=5.3.0
WORKDIR /libs
RUN npm pack --silent "maplibre-gl@${MAPLIBRE_GL_VERSION}" "pmtiles@${PMTILES_VERSION}" \
       "@fontsource-variable/inter@${INTER_VERSION}" \
 && mkdir -p maplibre pmtiles inter vendor/fonts \
 && tar -xzf "maplibre-gl-${MAPLIBRE_GL_VERSION}.tgz" -C maplibre \
 && tar -xzf "pmtiles-${PMTILES_VERSION}.tgz" -C pmtiles \
 && tar -xzf "fontsource-variable-inter-${INTER_VERSION}.tgz" -C inter \
 && cp maplibre/package/dist/maplibre-gl.mjs maplibre/package/dist/maplibre-gl-shared.mjs \
       maplibre/package/dist/maplibre-gl-worker.mjs maplibre/package/dist/maplibre-gl.css vendor/ \
 && cp maplibre/package/LICENSE.txt vendor/maplibre-gl.LICENSE.txt \
 && cp pmtiles/package/dist/pmtiles.js vendor/ \
 && (cp pmtiles/package/LICENSE vendor/pmtiles.LICENSE 2>/dev/null || true) \
 && cp inter/package/files/inter-latin-wght-normal.woff2 vendor/fonts/ \
 && cp inter/package/LICENSE vendor/fonts/inter.LICENSE.txt

FROM ${NGINX_IMAGE}
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/snippets/ /etc/nginx/snippets/
COPY nginx/conf.d/ /etc/nginx/conf.d/
COPY nginx/tls/ /etc/nginx/tls/
COPY nginx/html/ /usr/share/nginx/html/
COPY --from=viewer-libs /libs/vendor/ /usr/share/nginx/html/vendor/
COPY maps/fonts/ /usr/share/nginx/maps-assets/fonts/
COPY maps/style/style.json /usr/share/nginx/maps-assets/style/style.json
RUN mkdir -p /data/maps /data/routing
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
