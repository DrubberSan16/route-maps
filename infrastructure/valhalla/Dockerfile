# syntax=docker/dockerfile:1
#
# Routing service: Valhalla serving an already built graph from
# /data/routing/<ROUTING_REGION>/ (read-only). Graph generation is a separate
# step run with the data-tools image (`make prepare-region REGION=...`).
#
# Build context: ./infrastructure

ARG VALHALLA_IMAGE=ghcr.io/valhalla/valhalla:3.9.0
FROM ${VALHALLA_IMAGE}
USER root
COPY --chmod=755 valhalla/scripts/serve.sh /usr/local/bin/serve-routing.sh
COPY --chmod=755 valhalla/scripts/healthcheck.sh /usr/local/bin/routing-healthcheck.sh
RUN id -u valhalla >/dev/null 2>&1 \
 || useradd --system --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin valhalla
USER valhalla
ENV ROUTING_DIR=/data/routing
EXPOSE 8002
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 CMD ["routing-healthcheck.sh"]
ENTRYPOINT ["serve-routing.sh"]
