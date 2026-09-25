import { CacheProvider } from '../../../infrastructure/cache/cache.provider';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GeocodingProvider } from '../../geocoding/domain/geocoding-provider';
import { RoutingProvider } from '../../routing/domain/interfaces/routing-provider';
import { HealthService } from './health.service';

type State = 'up' | 'down' | 'disabled';

describe('HealthService', () => {
  const build = (states: {
    database?: 'up' | 'down' | 'hang';
    redis?: State;
    routing?: 'up' | 'down';
    geocoding?: State;
  }) => {
    const never = new Promise<never>(() => undefined);
    const prisma = {
      ping: () =>
        states.database === 'hang'
          ? never
          : states.database === 'down'
            ? Promise.reject(new Error('ECONNREFUSED'))
            : Promise.resolve(),
    } as unknown as PrismaService;
    const cache = { status: () => Promise.resolve(states.redis ?? 'up') } as CacheProvider;
    const routing = {
      name: 'valhalla',
      health: () => Promise.resolve(states.routing ?? 'up'),
    } as RoutingProvider;
    const geocoding = {
      name: 'none',
      health: () => Promise.resolve(states.geocoding ?? 'disabled'),
    } as GeocodingProvider;
    return new HealthService(prisma, cache, routing, geocoding);
  };

  afterEach(() => jest.useRealTimers());

  it('is ok when every enabled dependency is up (geocoding disabled by default)', async () => {
    const report = await build({}).check();

    expect(report).toMatchObject({
      status: 'ok',
      services: {
        api: 'up',
        database: 'up',
        redis: 'up',
        routing: 'up',
        geocoding: 'disabled',
      },
      providers: { routing: 'valhalla', geocoding: 'none' },
    });
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['redis', { redis: 'down' as const }],
    ['routing', { routing: 'down' as const }],
    ['geocoding', { geocoding: 'down' as const }],
  ])('is degraded when %s is down', async (_service, states) => {
    await expect(build(states).check()).resolves.toMatchObject({ status: 'degraded' });
  });

  it('is error when the database is down', async () => {
    await expect(build({ database: 'down', redis: 'down' }).check()).resolves.toMatchObject({
      status: 'error',
      services: { database: 'down' },
    });
  });

  it('does not hang when a dependency never answers', async () => {
    jest.useFakeTimers();
    const pending = build({ database: 'hang' }).check();
    await jest.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({
      status: 'error',
      services: { database: 'down' },
    });
  });
});
