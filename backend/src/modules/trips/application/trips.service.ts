import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PointGeometry } from '../../../common/geo/geojson';
import { Prisma } from '../../../generated/prisma/client';
import { RoutingProfile, TripStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlatformEventsService } from '../../events/application/platform-events.service';
import { UsersService } from '../../users/application/users.service';
import {
  LiveTrip,
  MAX_PATH_POINTS,
  toTrip,
  Trip,
  tripEventData,
  TripPath,
} from '../domain/trip.entity';

export interface StartTripInput {
  id?: string;
  name?: string;
  profile?: RoutingProfile;
  routeId?: string;
  installationId?: string;
  startedAt?: Date;
  /** Data of the client application (vehicle, driver, order ids), echoed in the trip's events. */
  metadata?: Record<string, unknown>;
}

/** The Prisma client or an open transaction. */
type SqlClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/** Most trips `GET /tracking/live` returns. */
const MAX_LIVE_TRIPS = 1000;

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly events: PlatformEventsService,
  ) {}

  /** Starts a trip. Idempotent when the client supplies the id (offline queue retries). */
  async start(userId: string, input: StartTripInput): Promise<Trip> {
    const id = input.id ?? randomUUID();
    const existing = await this.prisma.trip.findUnique({ where: { id } });
    if (existing) {
      if (existing.userId !== userId) {
        throw new AppException(ErrorCode.CONFLICT, 'Trip id already in use', HttpStatus.CONFLICT);
      }
      return this.get(userId, id);
    }
    const device = input.installationId
      ? await this.users.registerDevice(userId, { installationId: input.installationId })
      : null;
    const routeId =
      input.routeId && (await this.prisma.route.count({ where: { id: input.routeId, userId } })) > 0
        ? input.routeId
        : null;
    await this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          id,
          userId,
          deviceId: device?.id ?? null,
          routeId,
          name: input.name,
          profile: input.profile ?? RoutingProfile.CAR,
          startedAt: input.startedAt ?? new Date(),
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      await this.events.emit(
        { type: 'trip.started', accountId: userId, data: tripEventData(trip) },
        tx,
      );
    });
    return this.get(userId, id);
  }

  async get(userId: string, id: string): Promise<Trip> {
    const trip = await this.prisma.trip.findFirst({
      where: { id, userId },
      include: { _count: { select: { points: true } } },
    });
    if (!trip) throw AppException.notFound(ErrorCode.TRIP_NOT_FOUND, 'Trip not found');
    return toTrip(trip);
  }

  async list(
    userId: string,
    options: { limit: number; offset: number; status?: TripStatus },
  ): Promise<{ items: Trip[]; total: number; limit: number; offset: number }> {
    const where = { userId, ...(options.status ? { status: options.status } : {}) };
    const [trips, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: options.limit,
        skip: options.offset,
        include: { _count: { select: { points: true } } },
      }),
      this.prisma.trip.count({ where }),
    ]);
    return {
      items: trips.map(toTrip),
      total,
      limit: options.limit,
      offset: options.offset,
    };
  }

  /** Completes the trip and stores its travelled distance (geodesic length of the track). */
  async finish(userId: string, id: string, endedAt?: Date): Promise<Trip> {
    return this.close(userId, id, TripStatus.COMPLETED, endedAt ?? new Date());
  }

  async cancel(userId: string, id: string): Promise<Trip> {
    return this.close(userId, id, TripStatus.CANCELLED, new Date());
  }

  /**
   * Ends an active trip once: when two requests race (a retried upload, the app and an
   * integration), only the one that changes the status emits the event; the other gets the trip
   * as it ended, or TRIP_NOT_ACTIVE if it ended the other way.
   */
  private async close(
    userId: string,
    id: string,
    status: typeof TripStatus.COMPLETED | typeof TripStatus.CANCELLED,
    endedAt: Date,
  ): Promise<Trip> {
    const trip = await this.get(userId, id);
    if (trip.status === TripStatus.ACTIVE) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.trip.updateMany({
          where: { id, status: TripStatus.ACTIVE },
          data: { status, endedAt },
        });
        if (claimed.count === 0) return;
        if (status === TripStatus.COMPLETED) await this.recomputeDistance(id, tx);
        const closed = await tx.trip.findUniqueOrThrow({ where: { id } });
        await this.events.emit(
          {
            type: status === TripStatus.COMPLETED ? 'trip.finished' : 'trip.cancelled',
            accountId: userId,
            data: tripEventData(closed),
          },
          tx,
        );
      });
    }
    const result = trip.status === TripStatus.ACTIVE ? await this.get(userId, id) : trip;
    if (result.status !== status) {
      throw new AppException(ErrorCode.TRIP_NOT_ACTIVE, 'Trip is not active', HttpStatus.CONFLICT);
    }
    return result;
  }

  /**
   * Active trips of an account with their last position, most recently seen first (fleet
   * monitoring by integrations, the administration panel's live map with every account).
   */
  async live(userId?: string): Promise<LiveTrip[]> {
    const owner = userId ? Prisma.sql`AND t.user_id = ${userId}::uuid` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        user_id: string;
        email: string;
        name: string | null;
        profile: RoutingProfile;
        device_id: string | null;
        metadata: unknown;
        started_at: Date;
        location: PointGeometry | null;
        accuracy: number | null;
        speed: number | null;
        heading: number | null;
        recorded_at: Date | null;
      }[]
    >`
      SELECT t.id, t.user_id, u.email, t.name, t.profile, t.device_id, t.metadata, t.started_at,
             p.location, p.accuracy, p.speed, p.heading, p.recorded_at
      FROM trips t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN LATERAL (
        SELECT ST_AsGeoJSON(location)::json AS location, accuracy, speed, heading, recorded_at
        FROM trip_points WHERE trip_id = t.id ORDER BY recorded_at DESC LIMIT 1
      ) p ON true
      WHERE t.status = 'ACTIVE' ${owner}
      ORDER BY p.recorded_at DESC NULLS LAST, t.started_at DESC
      LIMIT ${MAX_LIVE_TRIPS}`;
    return rows.map((row) => ({
      tripId: row.id,
      userId: row.user_id,
      userEmail: row.email,
      name: row.name,
      profile: row.profile,
      deviceId: row.device_id,
      metadata: row.metadata,
      startedAt: row.started_at,
      position:
        row.location && row.recorded_at
          ? {
              longitude: row.location.coordinates[0],
              latitude: row.location.coordinates[1],
              accuracy: row.accuracy,
              speed: row.speed,
              heading: row.heading,
              recordedAt: row.recorded_at,
            }
          : null,
    }));
  }

  async recomputeDistance(tripId: string, client: SqlClient = this.prisma): Promise<void> {
    await client.$executeRaw`
      UPDATE trips SET distance_meters = COALESCE((
        SELECT ST_Length(ST_MakeLine(location ORDER BY recorded_at)::geography)
        FROM trip_points WHERE trip_id = ${tripId}::uuid
      ), 0), updated_at = now()
      WHERE id = ${tripId}::uuid`;
  }

  /**
   * Recorded track. Longer recordings are thinned out to `maxPoints` fixes spread evenly
   * from the first to the last one, and the geometry is drawn through those same fixes;
   * the distance is still measured over every fix.
   */
  async path(userId: string, id: string, maxPoints = MAX_PATH_POINTS): Promise<TripPath> {
    await this.get(userId, id);
    const rows = await this.prisma.$queryRaw<
      {
        location: PointGeometry;
        accuracy: number | null;
        speed: number | null;
        heading: number | null;
        altitude: number | null;
        recorded_at: Date;
        total: bigint;
        distance: number | null;
      }[]
    >`
      WITH track AS (
        SELECT location, accuracy, speed, heading, altitude, recorded_at,
               row_number() OVER w - 1 AS position,
               count(*) OVER () AS total,
               ST_Distance(location::geography, (lag(location) OVER w)::geography) AS step_meters
        FROM trip_points WHERE trip_id = ${id}::uuid
        WINDOW w AS (ORDER BY recorded_at)
      )
      SELECT ST_AsGeoJSON(location)::json AS location, accuracy, speed, heading, altitude,
             recorded_at, total, (SELECT sum(step_meters) FROM track) AS distance
      FROM track, (SELECT ${Math.max(2, Math.floor(maxPoints))}::int AS max_points) AS params
      WHERE CASE
        WHEN total <= max_points THEN true
        -- Keeps the fix at or right after each of max_points evenly spaced marks.
        ELSE position = 0
          OR position * (max_points - 1) / (total - 1)
             > (position - 1) * (max_points - 1) / (total - 1)
      END
      ORDER BY recorded_at`;

    const points = rows.map((row) => ({
      longitude: row.location.coordinates[0],
      latitude: row.location.coordinates[1],
      accuracy: row.accuracy,
      speed: row.speed,
      heading: row.heading,
      altitude: row.altitude,
      recordedAt: row.recorded_at,
    }));
    return {
      tripId: id,
      geometry:
        points.length >= 2
          ? {
              type: 'LineString',
              coordinates: points.map((point) => [point.longitude, point.latitude]),
            }
          : null,
      distanceMeters: Math.round(rows[0]?.distance ?? 0),
      totalPoints: Number(rows[0]?.total ?? 0),
      points,
    };
  }

  /** Ownership check used by the tracking module before accepting positions. */
  async assertAcceptsPoints(userId: string, tripId: string): Promise<{ status: TripStatus }> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, userId },
      select: { status: true },
    });
    if (!trip) throw AppException.notFound(ErrorCode.TRIP_NOT_FOUND, `Trip ${tripId} not found`);
    if (trip.status === TripStatus.CANCELLED) {
      throw new AppException(
        ErrorCode.TRIP_NOT_ACTIVE,
        'Trip was cancelled and does not accept positions',
        HttpStatus.CONFLICT,
      );
    }
    return trip;
  }
}
