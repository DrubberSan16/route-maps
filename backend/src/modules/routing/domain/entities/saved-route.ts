import { Coordinate, LineStringGeometry } from '../../../../common/geo/geojson';
import { RoutingProfile } from '../value-objects/routing-profile';

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
  steps: unknown[];
  regionCode?: string | null;
  provider?: string | null;
}

export interface RouteRepository {
  /** Idempotent upsert by id. Returns null when the id belongs to another user. */
  upsert(userId: string, input: SaveRouteInput & { id: string }): Promise<SavedRoute | null>;
  findById(userId: string, id: string): Promise<SavedRoute | null>;
  list(
    userId: string,
    options: { limit: number; offset: number; includeGeometry: boolean; updatedSince?: Date },
  ): Promise<{ items: SavedRoute[]; total: number }>;
  delete(userId: string, id: string): Promise<boolean>;
}

export const ROUTE_REPOSITORY = Symbol('ROUTE_REPOSITORY');
