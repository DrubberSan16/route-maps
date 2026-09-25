import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { isValidCoordinate, PointGeometry } from '../../../common/geo/geojson';
import { TripStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TripsService } from '../../trips/application/trips.service';
import { LocationPoint, TrackingBatchResult } from '../domain/location-point';

const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  async record(userId: string, point: LocationPoint): Promise<{ status: 'CREATED' | 'DUPLICATE' }> {
    const result = await this.recordBatch(userId, [point]);
    return { status: result.inserted === 1 ? 'CREATED' : 'DUPLICATE' };
  }

  /**
   * Stores GPS fixes. (trip_id, recorded_at) is unique, so re-sending the same
   * fixes from the offline queue never duplicates rows and never loses data.
   */
  async recordBatch(userId: string, points: LocationPoint[]): Promise<TrackingBatchResult> {
    if (points.length === 0) return { received: 0, inserted: 0, duplicates: 0 };
    for (const point of points) this.validate(point);

    const tripIds = [...new Set(points.map((point) => point.tripId))];
    const completedTrips: string[] = [];
    for (const tripId of tripIds) {
      const trip = await this.trips.assertAcceptsPoints(userId, tripId);
      if (trip.status === TripStatus.COMPLETED) completedTrips.push(tripId);
    }

    const rows = points.map(
      (point) => Prisma.sql`(
        gen_random_uuid(), ${point.tripId}::uuid,
        ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326),
        ${point.accuracy ?? null}::double precision, ${point.speed ?? null}::double precision,
        ${point.heading ?? null}::double precision, ${point.altitude ?? null}::double precision,
        ${point.recordedAt}::timestamptz, now())`,
    );
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO trip_points (id, trip_id, location, accuracy, speed, heading, altitude,
                               recorded_at, received_at)
      VALUES ${Prisma.join(rows, ', ')}
      ON CONFLICT (trip_id, recorded_at) DO NOTHING
      RETURNING id`;

    // Late fixes for an already finished trip (offline upload) update its distance.
    if (inserted.length > 0) {
      for (const tripId of completedTrips) await this.trips.recomputeDistance(tripId);
    }
    return {
      received: points.length,
      inserted: inserted.length,
      duplicates: points.length - inserted.length,
    };
  }

  async lastPosition(userId: string, tripId: string) {
    await this.trips.assertAcceptsPoints(userId, tripId).catch((error: unknown) => {
      // A cancelled trip still has a readable history.
      if (error instanceof AppException && error.code === ErrorCode.TRIP_NOT_ACTIVE) return;
      throw error;
    });
    const rows = await this.prisma.$queryRaw<
      {
        location: PointGeometry;
        accuracy: number | null;
        speed: number | null;
        heading: number | null;
        recorded_at: Date;
      }[]
    >`
      SELECT ST_AsGeoJSON(location)::json AS location, accuracy, speed, heading, recorded_at
      FROM trip_points WHERE trip_id = ${tripId}::uuid
      ORDER BY recorded_at DESC LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      tripId,
      longitude: row.location.coordinates[0],
      latitude: row.location.coordinates[1],
      accuracy: row.accuracy,
      speed: row.speed,
      heading: row.heading,
      recordedAt: row.recorded_at,
    };
  }

  private validate(point: LocationPoint): void {
    if (!isValidCoordinate(point)) {
      throw new AppException(ErrorCode.INVALID_COORDINATES, 'Coordinates are out of range');
    }
    const time = point.recordedAt.getTime();
    if (!Number.isFinite(time) || time < MIN_TIMESTAMP || time > Date.now() + MAX_FUTURE_SKEW_MS) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'timestamp is not a plausible date');
    }
  }
}
