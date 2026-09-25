import { Coordinate, PolygonGeometry } from '../../../common/geo/geojson';
import { GeofenceType } from '../../../generated/prisma/enums';

export interface Geofence {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  type: GeofenceType;
  center: Coordinate | null;
  radiusMeters: number | null;
  /** Polygon area (for CIRCLE, the circle approximated with 64 vertices). */
  geometry: PolygonGeometry;
  metadata: Record<string, unknown> | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type GeofenceShape =
  | { type: 'CIRCLE'; center: Coordinate; radiusMeters: number }
  | { type: 'POLYGON'; polygon: PolygonGeometry };

export interface GeofenceInput {
  name: string;
  description?: string | null;
  shape: GeofenceShape;
  metadata?: Record<string, unknown> | null;
  active?: boolean;
}

export interface GeofenceRepository {
  create(userId: string, input: GeofenceInput): Promise<Geofence>;
  update(
    userId: string,
    id: string,
    input: Partial<Omit<GeofenceInput, 'shape'>> & { shape?: GeofenceShape },
  ): Promise<Geofence | null>;
  delete(userId: string, id: string): Promise<boolean>;
  findById(userId: string, id: string): Promise<Geofence | null>;
  list(userId: string, options: { activeOnly: boolean }): Promise<Geofence[]>;
  /** Active geofences of the user containing the point. */
  findContaining(userId: string, point: Coordinate): Promise<Geofence[]>;
  isValidPolygon(polygon: PolygonGeometry): Promise<boolean>;
}

export const GEOFENCE_REPOSITORY = Symbol('GEOFENCE_REPOSITORY');
