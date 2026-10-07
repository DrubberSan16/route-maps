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
  /** Data of the client application, as sent when the trip started. */
  metadata: unknown;
  pointCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A row of `trips` as Prisma returns it, with or without its point count. */
export interface TripRow {
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
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  _count?: { points: number };
}

export const toTrip = (row: TripRow): Trip => ({
  id: row.id,
  userId: row.userId,
  deviceId: row.deviceId,
  routeId: row.routeId,
  name: row.name,
  profile: row.profile,
  status: row.status,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  distanceMeters: row.distanceMeters,
  metadata: row.metadata ?? null,
  pointCount: row._count?.points ?? 0,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** `data` of the trip.started, trip.finished and trip.cancelled events. */
export const tripEventData = (row: TripRow): Record<string, unknown> => ({
  trip: {
    id: row.id,
    name: row.name,
    profile: row.profile,
    status: row.status,
    deviceId: row.deviceId,
    routeId: row.routeId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    distanceMeters: row.distanceMeters === null ? null : Math.round(row.distanceMeters),
    metadata: row.metadata ?? null,
  },
});

/** An active trip and its last known position. */
export interface LiveTrip {
  tripId: string;
  userId: string;
  userEmail: string;
  name: string | null;
  profile: RoutingProfile;
  deviceId: string | null;
  metadata: unknown;
  startedAt: Date;
  position: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    recordedAt: Date;
  } | null;
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
