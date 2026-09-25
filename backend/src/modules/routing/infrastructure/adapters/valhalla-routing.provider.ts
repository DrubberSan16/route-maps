import { Injectable } from '@nestjs/common';
import { decodePolyline } from '../../../../common/geo/polyline';
import { Position } from '../../../../common/geo/geojson';
import {
  fetchJson,
  UpstreamHttpError,
  UpstreamUnavailableError,
} from '../../../../infrastructure/http/fetch-json';
import {
  bboxOf,
  CalculateRouteInput,
  ManeuverType,
  RouteCalculation,
  RouteResult,
  RouteStep,
} from '../../domain/entities/route-result';
import {
  InvalidRouteRequestError,
  RouteNotFoundError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { RoutingProvider } from '../../domain/interfaces/routing-provider';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';

/** Valhalla costing model for each API profile. All five are native in Valhalla. */
export const VALHALLA_COSTING: Record<RoutingProfile, string> = {
  CAR: 'auto',
  TRUCK: 'truck',
  MOTORCYCLE: 'motorcycle',
  BICYCLE: 'bicycle',
  PEDESTRIAN: 'pedestrian',
};

/** Valhalla maneuver type ids -> normalised maneuver (see valhalla/proto/directions.proto). */
const MANEUVERS: Record<number, ManeuverType> = {
  1: 'DEPART',
  2: 'DEPART',
  3: 'DEPART',
  4: 'ARRIVE',
  5: 'ARRIVE',
  6: 'ARRIVE',
  7: 'CONTINUE',
  8: 'CONTINUE',
  9: 'SLIGHT_RIGHT',
  10: 'TURN_RIGHT',
  11: 'SHARP_RIGHT',
  12: 'UTURN',
  13: 'UTURN',
  14: 'SHARP_LEFT',
  15: 'TURN_LEFT',
  16: 'SLIGHT_LEFT',
  17: 'RAMP',
  18: 'RAMP',
  19: 'RAMP',
  20: 'EXIT',
  21: 'EXIT',
  22: 'CONTINUE',
  23: 'SLIGHT_RIGHT',
  24: 'SLIGHT_LEFT',
  25: 'MERGE',
  26: 'ROUNDABOUT_ENTER',
  27: 'ROUNDABOUT_EXIT',
  28: 'FERRY',
  29: 'FERRY',
  36: 'WAYPOINT',
  37: 'MERGE',
  38: 'MERGE',
};

/** Valhalla error codes meaning "no route" rather than a server problem. */
const NO_ROUTE_CODES = new Set([170, 171, 442, 443, 444, 445]);
const LIMIT_CODES = new Set([150, 154, 155, 156, 157, 158, 167]);

interface ValhallaManeuver {
  type: number;
  instruction: string;
  length: number;
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
  street_names?: string[];
}

interface ValhallaLeg {
  shape: string;
  maneuvers: ValhallaManeuver[];
}

interface ValhallaTrip {
  legs: ValhallaLeg[];
  summary: { length: number; time: number; has_toll?: boolean; has_ferry?: boolean };
  units: string;
}

interface ValhallaRouteResponse {
  trip: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
}

interface ValhallaErrorBody {
  error_code?: number;
  error?: string;
}

export interface ValhallaConfig {
  baseUrl: string;
  timeoutMs: number;
}

@Injectable()
export class ValhallaRoutingProvider implements RoutingProvider {
  readonly name = 'valhalla';

  constructor(private readonly config: ValhallaConfig) {}

  supportedProfiles(): RoutingProfile[] {
    return Object.keys(VALHALLA_COSTING) as RoutingProfile[];
  }

  async calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation> {
    const response = await this.request<ValhallaRouteResponse>('/route', this.buildRequest(input));
    return {
      primary: this.toRouteResult(response.trip),
      alternatives: (response.alternates ?? []).map((alternate) =>
        this.toRouteResult(alternate.trip),
      ),
      provider: this.name,
    };
  }

  async health(): Promise<'up' | 'down'> {
    try {
      await fetchJson(`${this.baseUrl}/status`, { timeoutMs: 3000 });
      return 'up';
    } catch {
      return 'down';
    }
  }

  buildRequest(input: CalculateRouteInput): Record<string, unknown> {
    const stops = [input.origin, ...(input.waypoints ?? []), input.destination];
    const costing = VALHALLA_COSTING[input.profile];
    const costingOptions: Record<string, number> = {};
    if (input.options?.avoidTolls) costingOptions.use_tolls = 0;
    if (input.options?.avoidHighways) costingOptions.use_highways = 0;
    if (input.options?.avoidFerries) costingOptions.use_ferry = 0;

    return {
      locations: stops.map((stop, index) => ({
        lat: stop.latitude,
        lon: stop.longitude,
        type: index === 0 || index === stops.length - 1 ? 'break' : 'via',
      })),
      costing,
      ...(Object.keys(costingOptions).length > 0
        ? { costing_options: { [costing]: costingOptions } }
        : {}),
      // Valhalla only computes alternates for two-location requests.
      alternates: stops.length === 2 ? input.alternatives : 0,
      directions_options: { units: 'kilometers', language: input.language },
      shape_format: 'polyline6',
    };
  }

  toRouteResult(trip: ValhallaTrip): RouteResult {
    const factor = trip.units === 'miles' ? 1609.344 : 1000;
    const coordinates: Position[] = [];
    const steps: RouteStep[] = [];

    for (const leg of trip.legs) {
      const shape = decodePolyline(leg.shape, 6);
      // Consecutive legs share their joint point; keep it once.
      const offset = coordinates.length === 0 ? 0 : coordinates.length - 1;
      coordinates.push(...(coordinates.length === 0 ? shape : shape.slice(1)));
      for (const maneuver of leg.maneuvers) {
        const begin = offset + maneuver.begin_shape_index;
        const end = offset + maneuver.end_shape_index;
        steps.push({
          instruction: maneuver.instruction,
          distanceMeters: Math.round(maneuver.length * factor * 10) / 10,
          durationSeconds: Math.round(maneuver.time * 10) / 10,
          maneuver: MANEUVERS[maneuver.type] ?? 'OTHER',
          location: coordinates[begin] ?? coordinates[coordinates.length - 1],
          streetNames: maneuver.street_names ?? [],
          geometryIndex: [begin, end],
        });
      }
    }

    return {
      distanceMeters: Math.round(trip.summary.length * factor),
      durationSeconds: Math.round(trip.summary.time),
      geometry: { type: 'LineString', coordinates },
      steps,
      bbox: bboxOf(coordinates),
      hasTolls: trip.summary.has_toll ?? false,
      hasFerry: trip.summary.has_ferry ?? false,
    };
  }

  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    try {
      return await fetchJson<T>(`${this.baseUrl}${path}`, {
        method: 'POST',
        body,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof UpstreamHttpError && error.status < 500) {
      const body = (error.body ?? {}) as ValhallaErrorBody;
      const code = body.error_code;
      const message = body.error ?? 'Routing request rejected';
      if (code !== undefined && NO_ROUTE_CODES.has(code))
        return new RouteNotFoundError(message, code);
      if (code !== undefined && LIMIT_CODES.has(code)) return new InvalidRouteRequestError(message);
      return new InvalidRouteRequestError(message);
    }
    if (error instanceof UpstreamHttpError || error instanceof UpstreamUnavailableError) {
      return new RoutingProviderUnavailableError('Valhalla is unavailable', { cause: error });
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
