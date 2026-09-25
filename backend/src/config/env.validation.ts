import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
  @IsIn(['valhalla', 'osrm'])
  ROUTING_PROVIDER?: string;

  @IsOptional()
  @IsIn(['nominatim', 'none'])
  GEOCODING_PROVIDER?: string;
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
  }
  return config;
}
