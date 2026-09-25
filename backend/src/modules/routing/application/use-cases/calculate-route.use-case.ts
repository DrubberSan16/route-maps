import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppException } from '../../../../common/errors/app.exception';
import { ErrorCode } from '../../../../common/errors/error-codes';
import { haversineMeters, isValidCoordinate } from '../../../../common/geo/geojson';
import { AppConfigService } from '../../../../config/app-config.service';
import {
  CACHE_PROVIDER,
  type CacheProvider,
} from '../../../../infrastructure/cache/cache.provider';
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
import { ROUTING_PROVIDER, type RoutingProvider } from '../../domain/interfaces/routing-provider';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';

export interface CalculatedRoute extends RouteResult {
  routeId: string;
  type: 'PRIMARY' | 'ALTERNATIVE';
}

export interface CalculateRouteOutput extends CalculatedRoute {
  profile: RoutingProfile;
  provider: string;
  routes: CalculatedRoute[];
}

export interface CalculateRouteCommand {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  waypoints?: { latitude: number; longitude: number }[];
  profile: RoutingProfile;
  alternatives?: boolean | number;
  language?: string;
  options?: CalculateRouteInput['options'];
}

/** Maximum straight-line distance accepted for a single request (sanity limit). */
const MAX_REQUEST_DISTANCE_METERS = 2_000_000;

@Injectable()
export class CalculateRouteUseCase {
  private readonly logger = new Logger(CalculateRouteUseCase.name);

  constructor(
    @Inject(ROUTING_PROVIDER) private readonly provider: RoutingProvider,
    @Inject(CACHE_PROVIDER) private readonly cache: CacheProvider,
    private readonly config: AppConfigService,
  ) {}

  async execute(command: CalculateRouteCommand): Promise<CalculateRouteOutput> {
    const input = this.toInput(command);
    const calculation = await this.calculateWithCache(input);

    // Fresh ids on every response: cached geometry may be shared between users.
    const routes: CalculatedRoute[] = [
      { routeId: randomUUID(), type: 'PRIMARY', ...calculation.primary },
      ...calculation.alternatives.map((route) => ({
        routeId: randomUUID(),
        type: 'ALTERNATIVE' as const,
        ...route,
      })),
    ];
    return { ...routes[0], profile: input.profile, provider: calculation.provider, routes };
  }

  private toInput(command: CalculateRouteCommand): CalculateRouteInput {
    const stops = [command.origin, ...(command.waypoints ?? []), command.destination];
    if (!stops.every(isValidCoordinate)) {
      throw new AppException(ErrorCode.INVALID_COORDINATES, 'Coordinates are out of range');
    }
    if (haversineMeters(command.origin, command.destination) < 1 && !command.waypoints?.length) {
      throw new AppException(
        ErrorCode.INVALID_COORDINATES,
        'Origin and destination are the same point',
      );
    }
    for (let i = 1; i < stops.length; i++) {
      if (haversineMeters(stops[i - 1], stops[i]) > MAX_REQUEST_DISTANCE_METERS) {
        throw new AppException(
          ErrorCode.INVALID_COORDINATES,
          'Points are too far apart for a single route request',
        );
      }
    }
    const routing = this.config.get('routing');
    const requested =
      command.alternatives === true
        ? routing.maxAlternatives
        : typeof command.alternatives === 'number'
          ? command.alternatives
          : 0;
    return {
      origin: command.origin,
      destination: command.destination,
      waypoints: command.waypoints,
      profile: command.profile,
      alternatives: Math.max(0, Math.min(requested, routing.maxAlternatives, 3)),
      language: command.language ?? routing.language,
      options: command.options,
    };
  }

  private async calculateWithCache(input: CalculateRouteInput): Promise<RouteCalculation> {
    const key = this.cacheKey(input);
    const cached = await this.cache.get<RouteCalculation>(key);
    if (cached) return cached;

    const calculation = await this.callProvider(input);
    await this.cache.set(key, calculation, this.config.get('routing').cacheTtlSeconds);
    return calculation;
  }

  private async callProvider(input: CalculateRouteInput): Promise<RouteCalculation> {
    try {
      return await this.provider.calculateRoute(input);
    } catch (error) {
      if (error instanceof RouteNotFoundError) {
        throw new AppException(
          ErrorCode.ROUTE_NOT_FOUND,
          'No route could be calculated',
          HttpStatus.NOT_FOUND,
          { reason: error.message },
        );
      }
      if (error instanceof RoutingProfileNotSupportedError) {
        throw new AppException(
          ErrorCode.ROUTING_PROFILE_NOT_SUPPORTED,
          error.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (error instanceof InvalidRouteRequestError) {
        throw new AppException(
          ErrorCode.ROUTE_NOT_FOUND,
          'No route could be calculated',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { reason: error.message },
        );
      }
      if (error instanceof RoutingProviderUnavailableError) {
        this.logger.error({ err: error }, 'Routing provider unavailable');
        throw AppException.unavailable(
          ErrorCode.ROUTING_PROVIDER_UNAVAILABLE,
          'The routing engine is not available, try again later',
          error,
        );
      }
      throw error;
    }
  }

  private cacheKey(input: CalculateRouteInput): string {
    const round = (c: { latitude: number; longitude: number }) => [
      Number(c.latitude.toFixed(5)),
      Number(c.longitude.toFixed(5)),
    ];
    const normalized = JSON.stringify({
      p: this.provider.name,
      f: input.profile,
      o: round(input.origin),
      d: round(input.destination),
      w: (input.waypoints ?? []).map(round),
      a: input.alternatives,
      l: input.language,
      x: input.options ?? {},
    });
    return `route:v1:${createHash('sha1').update(normalized).digest('hex')}`;
  }
}
