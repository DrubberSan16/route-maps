import { join } from 'node:path';

export type RoutingProviderName = 'valhalla' | 'osrm';
export type GeocodingProviderName = 'nominatim' | 'none';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[] | '*';
  trustProxy: boolean;
  swaggerEnabled: boolean;
  logLevel: string;
  /** Human-readable logs (pino-pretty, a dev dependency). JSON otherwise. */
  logPretty: boolean;
  database: { url: string };
  redis: {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  routing: {
    provider: RoutingProviderName;
    valhallaUrl: string;
    osrm: { carUrl?: string; bicycleUrl?: string; footUrl?: string };
    timeoutMs: number;
    language: string;
    cacheTtlSeconds: number;
    maxAlternatives: number;
  };
  geocoding: {
    provider: GeocodingProviderName;
    nominatimUrl: string;
    timeoutMs: number;
    cacheTtlSeconds: number;
    defaultCountryCodes?: string;
    /** Countries and cities of the world base map (world.places.json), searched with Nominatim. */
    placesFile: string;
  };
  maps: {
    storagePath: string;
    routingStoragePath: string;
    /** Public URL prefix (served by Nginx) used to build PMTiles URLs for online rendering. */
    publicTilesBaseUrl: string;
    /** When true, downloads are delegated to Nginx through X-Accel-Redirect. */
    accelRedirect: boolean;
    accelMapsPrefix: string;
    accelRoutingPrefix: string;
  };
  rateLimit: { ttlMs: number; limit: number };
}

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optional = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

/**
 * Builds the typed configuration object from environment variables.
 * Validation of required variables happens in `validateEnv` before this runs.
 */
export const loadConfiguration = (): AppConfig => {
  const env = process.env;
  const cors = (env.CORS_ORIGINS ?? '*').trim();
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: int(env.APP_PORT, 3000),
    corsOrigins:
      cors === '*'
        ? '*'
        : cors
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    trustProxy: bool(env.TRUST_PROXY, true),
    swaggerEnabled: bool(env.SWAGGER_ENABLED, true),
    logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
    logPretty: bool(env.LOG_PRETTY, false),
    database: { url: env.DATABASE_URL ?? '' },
    redis: {
      enabled: bool(env.REDIS_ENABLED, true),
      host: env.REDIS_HOST ?? 'localhost',
      port: int(env.REDIS_PORT, 6379),
      password: optional(env.REDIS_PASSWORD),
      db: int(env.REDIS_DB, 0),
      keyPrefix: env.REDIS_KEY_PREFIX ?? 'maps:',
    },
    jwt: {
      accessSecret: env.JWT_SECRET ?? '',
      refreshSecret: env.JWT_REFRESH_SECRET ?? '',
      accessTtlSeconds: int(env.JWT_ACCESS_TTL_SECONDS, 900),
      refreshTtlSeconds: int(env.JWT_REFRESH_TTL_SECONDS, 60 * 60 * 24 * 30),
    },
    routing: {
      provider: (env.ROUTING_PROVIDER ?? 'valhalla').toLowerCase() as RoutingProviderName,
      valhallaUrl: env.VALHALLA_URL ?? 'http://routing:8002',
      osrm: {
        carUrl: optional(env.OSRM_URL) ?? optional(env.OSRM_CAR_URL),
        bicycleUrl: optional(env.OSRM_BICYCLE_URL),
        footUrl: optional(env.OSRM_FOOT_URL),
      },
      timeoutMs: int(env.ROUTING_TIMEOUT_MS, 10000),
      language: env.ROUTING_LANGUAGE ?? 'es-ES',
      cacheTtlSeconds: int(env.ROUTING_CACHE_TTL_SECONDS, 600),
      maxAlternatives: int(env.ROUTING_MAX_ALTERNATIVES, 2),
    },
    geocoding: {
      provider: (env.GEOCODING_PROVIDER ?? 'none').toLowerCase() as GeocodingProviderName,
      nominatimUrl: env.NOMINATIM_URL ?? 'http://nominatim:8080',
      timeoutMs: int(env.GEOCODING_TIMEOUT_MS, 8000),
      cacheTtlSeconds: int(env.GEOCODING_CACHE_TTL_SECONDS, 86400),
      defaultCountryCodes: optional(env.GEOCODING_COUNTRY_CODES),
      placesFile:
        optional(env.GEOCODING_PLACES_FILE) ??
        join(env.MAP_STORAGE_PATH ?? '/data/maps', 'world', 'world.places.json'),
    },
    maps: {
      storagePath: env.MAP_STORAGE_PATH ?? '/data/maps',
      routingStoragePath: env.ROUTING_STORAGE_PATH ?? '/data/routing',
      publicTilesBaseUrl: env.PUBLIC_TILES_BASE_URL ?? '/maps',
      accelRedirect: bool(env.MAP_DOWNLOAD_ACCEL_REDIRECT, false),
      accelMapsPrefix: env.MAP_DOWNLOAD_ACCEL_MAPS_PREFIX ?? '/_protected/maps/',
      accelRoutingPrefix: env.MAP_DOWNLOAD_ACCEL_ROUTING_PREFIX ?? '/_protected/routing/',
    },
    rateLimit: {
      ttlMs: int(env.RATE_LIMIT_TTL_MS, 60000),
      limit: int(env.RATE_LIMIT_MAX, 120),
    },
  };
};
