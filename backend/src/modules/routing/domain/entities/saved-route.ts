import { Coordinate, LineStringGeometry } from '../../../../common/geo/geojson';
import { RoutingProfile } from '../value-objects/routing-profile';
import { RouteStep } from './route-result';

/** A step to store: the engine's RouteStep, whose maneuver, streets and range may be absent. */
export type SavedRouteStep = Pick<
  RouteStep,
  'instruction' | 'distanceMeters' | 'durationSeconds' | 'location'
> &
  Partial<Pick<RouteStep, 'maneuver' | 'streetNames' | 'geometryIndex'>>;

export interface SavedRoute {
  id: string;
  userId: string;
  name: string;
  profile: RoutingProfile;
  origin: Coordinate;
  destination: Coordinate;
  distanceMeters: number;
  durationSeconds: number;
  /** Omitted in list responses unless explicitly requested. */
  geometry?: LineStringGeometry;
  steps?: unknown[];
  regionCode: string | null;
  provider: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveRouteInput {
  id?: string;
  name: string;
  profile: RoutingProfile;
  origin: Coordinate;
  destination: Coordinate;
  distanceMeters: number;
  durationSeconds: number;
  geometry: LineStringGeometry;
  steps: SavedRouteStep[];
  regionCode?: string | null;
  provider?: string | null;
}

/** Position in the change feed of a user's routes, ordered by (changedAt, id). */
export interface RouteChangeCursor {
  changedAt: Date;
  id: string;
}

/** A page of the change feed: saved (created or updated) and deleted routes. */
export interface RouteChanges {
  routes: SavedRoute[];
  deletedIds: string[];
  /** Cursor of the last change of the page; null when the page is empty. */
  next: RouteChangeCursor | null;
  hasMore: boolean;
}

export interface RouteRepository {
  /**
   * Idempotent upsert by id. Returns null when the id belongs to another user.
   * Saving a route removes its tombstone.
   */
  upsert(userId: string, input: SaveRouteInput & { id: string }): Promise<SavedRoute | null>;
  findById(userId: string, id: string): Promise<SavedRoute | null>;
  list(
    userId: string,
    options: { limit: number; offset: number; includeGeometry: boolean },
  ): Promise<{ items: SavedRoute[]; total: number }>;
  /** Deletes the route and leaves a tombstone for the change feed, in one transaction. */
  delete(userId: string, id: string): Promise<boolean>;
  /** Changes strictly after `after`, oldest first, at most `limit`. */
  changes(userId: string, after: RouteChangeCursor, limit: number): Promise<RouteChanges>;
}

export const ROUTE_REPOSITORY = Symbol('ROUTE_REPOSITORY');
