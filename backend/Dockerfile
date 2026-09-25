# syntax=docker/dockerfile:1
#
# Backend image (NestJS modular monolith), multi-stage:
#   deps      -> all dependencies (build tooling included)
#   builder   -> compiles TypeScript (API, CLI and seed) to dist/
#   prod-deps -> production dependencies only
#   runner    -> minimal runtime, non-root user, NODE_ENV=production
#
# Build context: ./backend

ARG NODE_IMAGE=node:24-alpine

# Prisma reads DATABASE_URL from prisma.config.ts even for `prisma generate`
# (run by the postinstall script). It never connects at build time, so a
# syntactically valid placeholder is enough; the real URL is given at runtime.
ARG BUILD_DATABASE_URL=postgresql://build:build@localhost:5432/build

# ---------------------------------------------------------------- deps
FROM ${NODE_IMAGE} AS deps
ARG BUILD_DATABASE_URL
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    DATABASE_URL="${BUILD_DATABASE_URL}" npm ci --no-audit --no-fund

# ---------------------------------------------------------------- builder
FROM deps AS builder
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------- prod-deps
FROM ${NODE_IMAGE} AS prod-deps
ARG BUILD_DATABASE_URL
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    DATABASE_URL="${BUILD_DATABASE_URL}" npm ci --omit=dev --no-audit --no-fund \
 && rm -rf src

# ---------------------------------------------------------------- runner
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    APP_PORT=3000 \
    MAP_STORAGE_PATH=/data/maps \
    ROUTING_STORAGE_PATH=/data/routing
WORKDIR /app
# Application files belong to root and are read-only for the runtime user.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.APP_PORT || 3000) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Signals: run with an init process (`init: true` in Compose, `docker run --init`);
# the application also handles SIGTERM itself (graceful shutdown hooks).
ENTRYPOINT ["backend-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
