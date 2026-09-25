import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs before each e2e test file is loaded, so the configuration module sees
// these values instead of the developer's .env (dotenv never overrides them).
const storage = mkdtempSync(join(tmpdir(), 'maps-e2e-'));

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.E2E_DATABASE_URL,
  JWT_SECRET: 'e2e-access-token-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'e2e-refresh-token-secret-0123456789abcdef',
  REDIS_ENABLED: process.env.E2E_REDIS_ENABLED ?? 'false',
  GEOCODING_PROVIDER: 'none',
  SWAGGER_ENABLED: 'true',
  LOG_LEVEL: 'silent',
  LOG_PRETTY: 'false',
  RATE_LIMIT_MAX: '100000',
  MAP_DOWNLOAD_ACCEL_REDIRECT: 'false',
  MAP_STORAGE_PATH: join(storage, 'maps'),
  ROUTING_STORAGE_PATH: join(storage, 'routing'),
  E2E_STORAGE_PATH: storage,
});
