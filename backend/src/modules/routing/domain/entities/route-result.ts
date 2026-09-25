import {
  BoundingBox,
  Coordinate,
  LineStringGeometry,
  Position,
} from '../../../../common/geo/geojson';
import { RoutingProfile } from '../value-objects/routing-profile';

export const MANEUVER_TYPES = [
  'DEPART',
  'ARRIVE',
  'CONTINUE',
  'TURN_LEFT',
  'TURN_RIGHT',
  'SLIGHT_LEFT',
  'SLIGHT_RIGHT',
  'SHARP_LEFT',
  'SHARP_RIGHT',
  'UTURN',
  'ROUNDABOUT_ENTER',
  'ROUNDABOUT_EXIT',
  'MERGE',
  'RAMP',
  'EXIT',
  'FERRY',
  'WAYPOINT',
  'OTHER',
] as const;

export type ManeuverType = (typeof MANEUVER_TYPES)[number];

/** One normalised navigation instruction. */
export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  maneuver: ManeuverType;
  /** Where the maneuver happens, GeoJSON order [lng, lat]. */
  location: Position;
  streetNames: string[];
  /** Index range of the step inside the route geometry. */
  geometryIndex: [number, number];
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LineStringGeometry;
  steps: RouteStep[];
  bbox: BoundingBox;
  hasTolls?: boolean;
  hasFerry?: boolean;
}

export interface RouteCalculation {
  primary: RouteResult;
  alternatives: RouteResult[];
  provider: string;
}

export interface RouteOptions {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
}

export interface CalculateRouteInput {
  origin: Coordinate;
  destination: Coordinate;
  /** Intermediate stops (multi-stop). */
  waypoints?: Coordinate[];
  profile: RoutingProfile;
  alternatives: number;
  language: string;
  options?: RouteOptions;
}

export const bboxOf = (positions: Position[]): BoundingBox => {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of positions) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
};
