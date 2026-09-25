import { HttpStatus, Logger } from '@nestjs/common';
import { AppException } from '../../../../common/errors/app.exception';
import { ErrorCode } from '../../../../common/errors/error-codes';
import { AppConfigService } from '../../../../config/app-config.service';
import { CacheProvider } from '../../../../infrastructure/cache/cache.provider';
import {
  CalculateRouteInput,
  RouteCalculation,
  RouteResult,
} from '../../domain/entities/route-result';
import {
  InvalidRouteRequestError,
  RouteNotFoundError,
  RoutingProfileNotSupportedError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { RoutingProvider } from '../../domain/interfaces/routing-provider';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';
import { CalculateRouteCommand, CalculateRouteUseCase } from './calculate-route.use-case';

const ROUTING_CONFIG = { maxAlternatives: 2, language: 'es-ES', cacheTtlSeconds: 600 };

const route = (distanceMeters: number): RouteResult => ({
  distanceMeters,
  durationSeconds: distanceMeters / 10,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.8862, -2.1962],
      [-79.8975, -2.1894],
    ],
  },
  steps: [],
  bbox: [-79.8975, -2.1962, -79.8862, -2.1894],
});

class FakeProvider implements RoutingProvider {
  readonly name = 'fake';
  calls: CalculateRouteInput[] = [];
  result: RouteCalculation | Error = {
    primary: route(1500),
    alternatives: [route(1700), route(1900)],
    provider: 'fake',
  };

  supportedProfiles(): RoutingProfile[] {
    return ['CAR'];
  }

  calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation> {
    this.calls.push(input);
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(structuredClone(this.result));
  }

  health(): Promise<'up' | 'down'> {
    return Promise.resolve('up');
  }
}

class MemoryCache implements CacheProvider {
  readonly entries = new Map<string, { value: unknown; ttl: number }>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.entries.get(key)?.value as T | undefined);
  }

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value: structuredClone(value), ttl: ttlSeconds });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  status(): Promise<'up'> {
    return Promise.resolve('up');
  }
}

describe('CalculateRouteUseCase', () => {
  let provider: FakeProvider;
  let cache: MemoryCache;
  let useCase: CalculateRouteUseCase;

  // Guayaquil: Malecón 2000 -> Parque Seminario.
  const command = (overrides: Partial<CalculateRouteCommand> = {}): CalculateRouteCommand => ({
    origin: { latitude: -2.1962, longitude: -79.8862 },
    destination: { latitude: -2.1894, longitude: -79.8975 },
    profile: 'CAR',
    ...overrides,
  });

  const expectAppError = async (
    promise: Promise<unknown>,
    code: ErrorCode,
    status: HttpStatus,
  ): Promise<AppException> => {
    const error = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(code);
    expect((error as AppException).getStatus()).toBe(status);
    return error as AppException;
  };

  beforeEach(() => {
    provider = new FakeProvider();
    cache = new MemoryCache();
    const config = { get: () => ROUTING_CONFIG } as unknown as AppConfigService;
    useCase = new CalculateRouteUseCase(provider, cache, config);
  });

  describe('validation', () => {
    it.each([
      ['latitude above 90', { latitude: 91, longitude: -79.9 }],
      ['longitude below -180', { latitude: -2.19, longitude: -181 }],
      ['NaN', { latitude: Number.NaN, longitude: -79.9 }],
    ])('rejects an origin with %s', async (_label, origin) => {
      await expectAppError(
        useCase.execute(command({ origin })),
        ErrorCode.INVALID_COORDINATES,
        HttpStatus.BAD_REQUEST,
      );
      expect(provider.calls).toHaveLength(0);
    });

    it('rejects the same origin and destination', async () => {
      const origin = command().origin;
      await expectAppError(
        useCase.execute(command({ destination: { ...origin } })),
        ErrorCode.INVALID_COORDINATES,
        HttpStatus.BAD_REQUEST,
      );
    });

    it('rejects points more than 2,000 km apart (Guayaquil -> Madrid)', async () => {
      await expectAppError(
        useCase.execute(command({ destination: { latitude: 40.4168, longitude: -3.7038 } })),
        ErrorCode.INVALID_COORDINATES,
        HttpStatus.BAD_REQUEST,
      );
    });

    it('rejects an invalid waypoint', async () => {
      await expectAppError(
        useCase.execute(command({ waypoints: [{ latitude: 0, longitude: 200 }] })),
        ErrorCode.INVALID_COORDINATES,
        HttpStatus.BAD_REQUEST,
      );
    });
  });

  describe('provider input', () => {
    it('uses no alternatives and the configured language by default', async () => {
      await useCase.execute(command());
      expect(provider.calls[0]).toMatchObject({ alternatives: 0, language: 'es-ES' });
    });

    it.each([
      [true, 2],
      [1, 1],
      [5, 2],
      [-1, 0],
      [false, 0],
    ])('alternatives=%p asks the engine for %i', async (alternatives, expected) => {
      await useCase.execute(command({ alternatives }));
      expect(provider.calls[0].alternatives).toBe(expected);
    });

    it('passes profile, stops, language and options through', async () => {
      const waypoints = [{ latitude: -2.19, longitude: -79.89 }];
      await useCase.execute(
        command({
          profile: 'BICYCLE',
          waypoints,
          language: 'en-US',
          options: { avoidFerries: true },
        }),
      );
      expect(provider.calls[0]).toMatchObject({
        profile: 'BICYCLE',
        waypoints,
        language: 'en-US',
        options: { avoidFerries: true },
      });
    });
  });

  describe('result', () => {
    it('returns the primary route at the top level plus every route with its own id', async () => {
      const result = await useCase.execute(command({ alternatives: true }));

      expect(result).toMatchObject({ profile: 'CAR', provider: 'fake', distanceMeters: 1500 });
      expect(result.routes.map((item) => [item.type, item.distanceMeters])).toEqual([
        ['PRIMARY', 1500],
        ['ALTERNATIVE', 1700],
        ['ALTERNATIVE', 1900],
      ]);
      expect(result.routeId).toBe(result.routes[0].routeId);
      expect(new Set(result.routes.map((item) => item.routeId)).size).toBe(3);
    });
  });

  describe('cache', () => {
    it('stores the calculation with the configured TTL and reuses it', async () => {
      const first = await useCase.execute(command());
      const second = await useCase.execute(command());

      expect(provider.calls).toHaveLength(1);
      const [[key, entry]] = [...cache.entries];
      expect(key).toMatch(/^route:v1:[0-9a-f]{40}$/);
      expect(entry.ttl).toBe(600);
      expect(second.distanceMeters).toBe(first.distanceMeters);
      // Cached geometry may be shared between users, route ids never are.
      expect(second.routeId).not.toBe(first.routeId);
    });

    it('shares entries for points closer than ~1 m (5 decimals)', async () => {
      await useCase.execute(command());
      await useCase.execute(
        command({ origin: { latitude: -2.196200004, longitude: -79.886200004 } }),
      );
      expect(provider.calls).toHaveLength(1);
    });

    it('does not share entries across profiles or alternatives', async () => {
      await useCase.execute(command());
      await useCase.execute(command({ profile: 'PEDESTRIAN' }));
      await useCase.execute(command({ alternatives: true }));
      expect(provider.calls).toHaveLength(3);
    });

    it('does not cache failures', async () => {
      provider.result = new RouteNotFoundError('No path could be found for input', 442);
      await expect(useCase.execute(command())).rejects.toBeInstanceOf(AppException);
      expect(cache.entries.size).toBe(0);
    });
  });

  describe('engine errors', () => {
    it('maps RouteNotFoundError to 404 ROUTE_NOT_FOUND with the reason', async () => {
      provider.result = new RouteNotFoundError('No suitable edges near location', 171);
      const error = await expectAppError(
        useCase.execute(command()),
        ErrorCode.ROUTE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
      expect(error.details).toEqual({ reason: 'No suitable edges near location' });
    });

    it('maps InvalidRouteRequestError to 422 ROUTE_NOT_FOUND', async () => {
      provider.result = new InvalidRouteRequestError('Exclude flag combination is not supported.');
      await expectAppError(
        useCase.execute(command()),
        ErrorCode.ROUTE_NOT_FOUND,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    });

    it('maps RoutingProfileNotSupportedError to 422 ROUTING_PROFILE_NOT_SUPPORTED', async () => {
      provider.result = new RoutingProfileNotSupportedError('TRUCK', 'osrm');
      await expectAppError(
        useCase.execute(command({ profile: 'TRUCK' })),
        ErrorCode.ROUTING_PROFILE_NOT_SUPPORTED,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    });

    it('maps RoutingProviderUnavailableError to 503 and logs it', async () => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      provider.result = new RoutingProviderUnavailableError('Valhalla is unavailable');
      await expectAppError(
        useCase.execute(command()),
        ErrorCode.ROUTING_PROVIDER_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(log).toHaveBeenCalledTimes(1);
      log.mockRestore();
    });

    it('lets unexpected errors bubble up to the global filter', async () => {
      provider.result = new Error('boom');
      await expect(useCase.execute(command())).rejects.toThrow('boom');
    });
  });
});
