import { Position } from '../../../../common/geo/geojson';
import {
  fetchJson,
  UpstreamHttpError,
  UpstreamUnavailableError,
} from '../../../../infrastructure/http/fetch-json';
import {
  bboxOf,
  CalculateRouteInput,
  RouteCalculation,
  RouteResult,
  RouteStep,
} from '../../domain/entities/route-result';
import {
  InvalidRouteRequestError,
  RouteNotFoundError,
  RoutingProfileNotSupportedError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { RoutingProvider } from '../../domain/interfaces/routing-provider';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';
import { buildSpanishInstruction, OsrmManeuver, osrmManeuverType } from './osrm-instructions';

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  maneuver: OsrmManeuver & { location: Position };
  geometry: { coordinates: Position[] };
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: Position[] };
  legs: { steps: OsrmStep[] }[];
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

export interface OsrmConfig {
  /** One osrm-routed instance per prepared profile (OSRM profiles are baked at build time). */
  urls: Partial<Record<RoutingProfile, string>>;
  timeoutMs: number;
}

/**
 * Alternative adapter for OSRM. OSRM ships car, bicycle and foot profiles;
 * TRUCK and MOTORCYCLE require custom Lua profiles and are reported as not
 * supported unless a URL is configured for them.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';

  constructor(private readonly config: OsrmConfig) {}

  supportedProfiles(): RoutingProfile[] {
    return (Object.keys(this.config.urls) as RoutingProfile[]).filter(
      (profile) => !!this.config.urls[profile],
    );
  }

  async calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation> {
    const baseUrl = this.config.urls[input.profile];
    if (!baseUrl) throw new RoutingProfileNotSupportedError(input.profile, this.name);

    const stops = [input.origin, ...(input.waypoints ?? []), input.destination];
    const coordinates = stops.map((stop) => `${stop.longitude},${stop.latitude}`).join(';');
    const params = new URLSearchParams({
      alternatives:
        stops.length === 2 && input.alternatives > 0 ? String(input.alternatives) : 'false',
      steps: 'true',
      geometries: 'geojson',
      overview: 'full',
    });
    const exclude = [
      input.options?.avoidTolls ? 'toll' : null,
      input.options?.avoidHighways ? 'motorway' : null,
      input.options?.avoidFerries ? 'ferry' : null,
    ].filter(Boolean);
    if (exclude.length > 0) params.set('exclude', exclude.join(','));

    const url = `${baseUrl.replace(/\/$/, '')}/route/v1/driving/${coordinates}?${params.toString()}`;
    let response: OsrmResponse;
    try {
      response = await fetchJson<OsrmResponse>(url, { timeoutMs: this.config.timeoutMs });
    } catch (error) {
      throw this.mapError(error);
    }
    if (response.code !== 'Ok' || !response.routes?.length) {
      throw new RouteNotFoundError(response.message ?? 'No route found', response.code);
    }
    const [primary, ...alternatives] = response.routes.map((route) => this.toRouteResult(route));
    return { primary, alternatives, provider: this.name };
  }

  async health(): Promise<'up' | 'down'> {
    const url = this.config.urls.CAR ?? Object.values(this.config.urls).find(Boolean);
    if (!url) return 'down';
    try {
      await fetchJson(`${url.replace(/\/$/, '')}/nearest/v1/driving/0,0`, { timeoutMs: 3000 });
      return 'up';
    } catch (error) {
      // Any HTTP answer (even 400 "NoSegment") means the engine is running.
      return error instanceof UpstreamHttpError && error.status < 500 ? 'up' : 'down';
    }
  }

  toRouteResult(route: OsrmRoute): RouteResult {
    const coordinates = route.geometry.coordinates;
    const steps: RouteStep[] = [];
    let cursor = 0;
    for (const leg of route.legs) {
      for (const step of leg.steps) {
        const length = Math.max(step.geometry.coordinates.length - 1, 0);
        steps.push({
          instruction: buildSpanishInstruction(step.maneuver, step.name),
          distanceMeters: Math.round(step.distance * 10) / 10,
          durationSeconds: Math.round(step.duration * 10) / 10,
          maneuver: osrmManeuverType(step.maneuver),
          location: step.maneuver.location,
          streetNames: step.name ? [step.name] : [],
          geometryIndex: [cursor, Math.min(cursor + length, coordinates.length - 1)],
        });
        cursor += length;
      }
    }
    return {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      geometry: { type: 'LineString', coordinates },
      steps,
      bbox: bboxOf(coordinates),
    };
  }

  private mapError(error: unknown): Error {
    if (error instanceof UpstreamHttpError && error.status < 500) {
      const body = (error.body ?? {}) as { code?: string; message?: string };
      if (body.code === 'NoRoute' || body.code === 'NoSegment') {
        return new RouteNotFoundError(body.message ?? 'No route found', body.code);
      }
      return new InvalidRouteRequestError(body.message ?? 'Routing request rejected');
    }
    if (error instanceof UpstreamHttpError || error instanceof UpstreamUnavailableError) {
      return new RoutingProviderUnavailableError('OSRM is unavailable', { cause: error });
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
