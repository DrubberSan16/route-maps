import { LineStringGeometry } from '../../../common/geo/geojson';
import { RoutingProfile, TripStatus } from '../../../generated/prisma/enums';

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
  /** Null until the trip has at least two points. */
  geometry: LineStringGeometry | null;
  distanceMeters: number;
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
