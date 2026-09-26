import { LineStringGeometry } from '../../../common/geo/geojson';
import { RoutingProfile, TripStatus } from '../../../generated/prisma/enums';

/** Most points `GET /trips/:id/path` returns; longer tracks are sampled evenly. */
export const MAX_PATH_POINTS = 10_000;

export interface Trip {
  id: string;
  userId: string;
  deviceId: string | null;
  routeId: string | null;
  name: string | null;
  profile: RoutingProfile;
  status: TripStatus;
  startedAt: Date;
  endedAt: Date | null;
  distanceMeters: number | null;
  pointCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TripPath {
  tripId: string;
  /** Line through `points`; null until the trip has at least two points. */
  geometry: LineStringGeometry | null;
  /** Measured over every recorded point. */
  distanceMeters: number;
  /** Points recorded; `points` holds all of them or an even sample of long tracks. */
  totalPoints: number;
  points: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    altitude: number | null;
    recordedAt: Date;
  }[];
}
