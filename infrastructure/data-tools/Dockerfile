# syntax=docker/dockerfile:1
#
# Region data tools: downloads auditable public/official sources, builds the visual map
# (PMTiles, own vector tile schema), the relief and satellite layers (raster PMTiles) and
# routing data, and writes the region manifests that the backend registers. It only runs on demand
# (`docker compose --profile tools run --rm data-tools ...`), never on `up`.
#
# Build context: ./infrastructure

ARG MAVEN_IMAGE=maven:3.9-eclipse-temurin-21
ARG JRE_IMAGE=eclipse-temurin:21-jre

# ---------------------------------------------------------------- tilegen
# Tile generator (Planetiler + the platform's vector tile profile). Unit tests run here.
FROM ${MAVEN_IMAGE} AS tilegen
WORKDIR /build
COPY maps/tilegen/pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp dependency:go-offline
COPY maps/tilegen/src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp package \
 && mkdir -p /out \
 && cp target/tilegen.jar /out/ \
 && cp -r target/lib /out/lib

FROM ${JRE_IMAGE} AS jre

# ---------------------------------------------------------------- runtime
# Runtime only for audited downloads, the platform's Java tile generator and the raster layers.
FROM ${JRE_IMAGE}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates coreutils curl jq python3 python3-venv unzip \
      util-linux \
 && rm -rf /var/lib/apt/lists/*

# Relief and satellite layers: numpy, rasterio (with its own GDAL), Pillow and pmtiles, apart from the
# system Python that the rest of the pipeline uses with the standard library only.
COPY data-tools/requirements-raster.txt /opt/raster/requirements.txt
RUN python3 -m venv /opt/raster \
 && /opt/raster/bin/pip install --no-cache-dir --disable-pip-version-check -r /opt/raster/requirements.txt

ENV JAVA_HOME=/opt/java/openjdk \
    LANG=C.UTF-8 \
    REGIONS_CATALOG=/etc/maps-platform/regions.json \
    SOURCES_CATALOG=/etc/maps-platform/sources.json \
    TILEGEN_HOME=/opt/tilegen \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=tilegen /out/ /opt/tilegen/
COPY --chmod=755 data-tools/bin/region.sh /usr/local/bin/region.sh
COPY --chmod=755 data-tools/bin/native-data.py /usr/local/bin/native-data
COPY --chmod=755 data-tools/bin/raster-data.py /usr/local/bin/raster-data
COPY data-tools/lib/mapsdata /opt/mapsdata/mapsdata
COPY data-tools/tests /opt/mapsdata/tests
COPY regions/regions.json /etc/maps-platform/regions.json
COPY sources/sources.json /etc/maps-platform/sources.json
COPY sources/aliases.json /etc/maps-platform/aliases.json

# The pipeline library is tested while the image is built: with the system Python (standard library
# only, the raster tests are skipped) and with the raster environment (all of them).
RUN sed -i '1s|.*|#!/opt/raster/bin/python3|' /usr/local/bin/raster-data \
 && java -version \
 && jq empty /etc/maps-platform/regions.json \
 && jq empty /etc/maps-platform/sources.json \
 && jq empty /etc/maps-platform/aliases.json \
 && python3 -m py_compile /usr/local/bin/native-data \
 && /opt/raster/bin/python3 -m py_compile /usr/local/bin/raster-data \
 && cd /opt/mapsdata \
 && PYTHONPATH=/opt/mapsdata python3 -m unittest discover -s tests -t /opt/mapsdata \
 && PYTHONPATH=/opt/mapsdata /opt/raster/bin/python3 -m unittest discover -s tests -t /opt/mapsdata

WORKDIR /data
ENTRYPOINT ["region.sh"]
CMD ["help"]
