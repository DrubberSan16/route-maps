import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PROVIDER, type CacheProvider } from '../../../infrastructure/cache/cache.provider';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from '../../geocoding/domain/geocoding-provider';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from '../../routing/domain/interfaces/routing-provider';

export type ServiceState = 'up' | 'down' | 'disabled';

export interface HealthReport {
  /** ok: everything up; degraded: optional dependency down; error: database down. */
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  services: {
    api: 'up';
    database: ServiceState;
    redis: ServiceState;
    routing: ServiceState;
    geocoding: ServiceState;
  };
  providers: { routing: string; geocoding: string };
}

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_PROVIDER) private readonly cache: CacheProvider,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(GEOCODING_PROVIDER) private readonly geocoding: GeocodingProvider,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis, routing, geocoding] = await Promise.all([
      withTimeout(
        this.prisma.ping().then(
          () => 'up' as const,
          () => 'down' as const,
        ),
        3000,
        'down' as const,
      ),
      withTimeout(this.cache.status(), 3000, 'down' as const),
      withTimeout(this.routing.health(), 4000, 'down' as const),
      withTimeout(this.geocoding.health(), 4000, 'down' as const),
    ]);
    const services = { api: 'up' as const, database, redis, routing, geocoding };
    const status =
      database !== 'up'
        ? 'error'
        : [redis, routing, geocoding].some((state) => state === 'down')
          ? 'degraded'
          : 'ok';
    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      services,
      providers: { routing: this.routing.name, geocoding: this.geocoding.name },
    };
  }
}
