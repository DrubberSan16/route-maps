# syntax=docker/dockerfile:1
#
# Region data tools: downloads auditable public/official sources, builds the visual map
# (PMTiles, own vector tile schema) and routing data, and writes the
# region manifests that the backend registers. It only runs on demand
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
# Runtime only for audited downloads and the platform's Java tile generator.
FROM ${JRE_IMAGE}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates coreutils curl jq python3 unzip util-linux \
 && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/opt/java/openjdk \
    LANG=C.UTF-8 \
    REGIONS_CATALOG=/etc/maps-platform/regions.json \
    SOURCES_CATALOG=/etc/maps-platform/sources.json \
    TILEGEN_HOME=/opt/tilegen
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=tilegen /out/ /opt/tilegen/
COPY --chmod=755 data-tools/bin/region.sh /usr/local/bin/region.sh
COPY --chmod=755 data-tools/bin/native-data.py /usr/local/bin/native-data
COPY regions/regions.json /etc/maps-platform/regions.json
COPY sources/sources.json /etc/maps-platform/sources.json

RUN java -version \
 && jq empty /etc/maps-platform/regions.json \
 && jq empty /etc/maps-platform/sources.json \
 && python3 -m py_compile /usr/local/bin/native-data

WORKDIR /data
ENTRYPOINT ["region.sh"]
CMD ["help"]
