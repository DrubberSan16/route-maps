# syntax=docker/dockerfile:1
#
# Region data tools: downloads OpenStreetMap extracts, builds the visual map
# (PMTiles, own vector tile schema) and the Valhalla routing graph, and writes the
# region manifests that the backend registers. It only runs on demand
# (`docker compose --profile tools run --rm data-tools ...`), never on `up`.
#
# Build context: ./infrastructure

ARG MAVEN_IMAGE=maven:3.9-eclipse-temurin-21
ARG JRE_IMAGE=eclipse-temurin:21-jre
ARG VALHALLA_IMAGE=ghcr.io/valhalla/valhalla:3.9.0

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
# Valhalla image (graph builder binaries) + Java runtime + osmium.
FROM ${VALHALLA_IMAGE}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq osmium-tool unzip \
 && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/opt/java/openjdk \
    LANG=C.UTF-8 \
    REGIONS_CATALOG=/etc/maps-platform/regions.json \
    TILEGEN_HOME=/opt/tilegen
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=tilegen /out/ /opt/tilegen/
COPY --chmod=755 valhalla/scripts/build-routing.sh /usr/local/bin/build-routing.sh
COPY --chmod=755 data-tools/bin/region.sh /usr/local/bin/region.sh
COPY regions/regions.json /etc/maps-platform/regions.json

RUN java -version \
 && osmium --version | head -n 1 \
 && command -v valhalla_build_tiles valhalla_build_extract valhalla_build_admins valhalla_build_config \
 && jq empty /etc/maps-platform/regions.json

WORKDIR /data
ENTRYPOINT ["region.sh"]
CMD ["help"]
