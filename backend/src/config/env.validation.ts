// class-transformer reads design:type metadata for the implicit conversions below.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const WEAK_SECRETS = new Set(['CHANGE_ME', 'changeme', 'secret', 'dev-secret']);

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT?: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(16, { message: 'JWT_SECRET must be at least 16 characters long' })
  JWT_SECRET: string;

  @IsString()
  @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters long' })
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsIn(['native', 'valhalla', 'osrm'])
  ROUTING_PROVIDER?: string;

  @IsOptional()
  @IsIn(['native', 'nominatim', 'none'])
  GEOCODING_PROVIDER?: string;

  @IsOptional()
  @IsString()
  GEOCODING_PLACES_FILE?: string;

  @IsOptional()
  @IsTimeZone({ message: 'TRAFFIC_TIME_ZONE must be an IANA time zone, e.g. America/Guayaquil' })
  TRAFFIC_TIME_ZONE?: string;

  @IsOptional()
  @IsString()
  @MinLength(32, { message: 'INTEGRATIONS_SECRET_KEY must be at least 32 characters long' })
  INTEGRATIONS_SECRET_KEY?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(30000)
  WEBHOOK_TIMEOUT_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  EVENTS_RETENTION_DAYS?: number;
}

/** Validates the environment at bootstrap so misconfiguration fails fast. */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  if (config.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = String(config[key]);
      if (WEAK_SECRETS.has(value) || /change_?me/i.test(value) || value.length < 32) {
        throw new Error(`${key} must be a strong secret (>= 32 chars) in production`);
      }
    }
    if (config.JWT_SECRET === config.JWT_REFRESH_SECRET) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different in production');
    }
    const integrationsKey = config.INTEGRATIONS_SECRET_KEY;
    if (typeof integrationsKey === 'string' && /change_?me/i.test(integrationsKey)) {
      throw new Error('INTEGRATIONS_SECRET_KEY must be a strong secret in production');
    }
  }
  return config;
}
