import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { LineStringGeometry, PointGeometry } from '../../../common/geo/geojson';
import { RoutingProfile, TripStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UsersService } from '../../users/application/users.service';
import { Trip, TripPath } from '../domain/trip.entity';

export interface StartTripInput {
  id?: string;
  name?: string;
  profile?: RoutingProfile;
  routeId?: string;
  installationId?: string;
  startedAt?: Date;
}

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
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
    await this.prisma.trip.create({
      data: {
        id,
        userId,
        deviceId: device?.id ?? null,
        routeId,
        name: input.name,
        profile: input.profile ?? RoutingProfile.CAR,
        startedAt: input.startedAt ?? new Date(),
      },
    });
    return this.get(userId, id);
  }

  async get(userId: string, id: string): Promise<Trip> {
    const trip = await this.prisma.trip.findFirst({
      where: { id, userId },
      include: { _count: { select: { points: true } } },
    });
    if (!trip) throw AppException.notFound(ErrorCode.TRIP_NOT_FOUND, 'Trip not found');
    const { _count, ...rest } = trip;
    return { ...rest, pointCount: _count.points };
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
      items: trips.map(({ _count, ...trip }) => ({ ...trip, pointCount: _count.points })),
      total,
      limit: options.limit,
      offset: options.offset,
    };
  }

  /** Completes the trip and stores its travelled distance (geodesic length of the track). */
  async finish(userId: string, id: string, endedAt?: Date): Promise<Trip> {
    const trip = await this.get(userId, id);
    if (trip.status === TripStatus.COMPLETED) return trip;
    if (trip.status !== TripStatus.ACTIVE) {
      throw new AppException(ErrorCode.TRIP_NOT_ACTIVE, 'Trip is not active', HttpStatus.CONFLICT);
    }
    await this.prisma.trip.update({
      where: { id },
      data: { status: TripStatus.COMPLETED, endedAt: endedAt ?? new Date() },
    });
    await this.recomputeDistance(id);
    return this.get(userId, id);
  }

  async cancel(userId: string, id: string): Promise<Trip> {
    const trip = await this.get(userId, id);
    if (trip.status === TripStatus.CANCELLED) return trip;
    if (trip.status !== TripStatus.ACTIVE) {
      throw new AppException(ErrorCode.TRIP_NOT_ACTIVE, 'Trip is not active', HttpStatus.CONFLICT);
    }
    await this.prisma.trip.update({
      where: { id },
      data: { status: TripStatus.CANCELLED, endedAt: new Date() },
    });
    return this.get(userId, id);
  }

  async recomputeDistance(tripId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE trips SET distance_meters = COALESCE((
        SELECT ST_Length(ST_MakeLine(location ORDER BY recorded_at)::geography)
        FROM trip_points WHERE trip_id = ${tripId}::uuid
      ), 0), updated_at = now()
      WHERE id = ${tripId}::uuid`;
  }

  async path(userId: string, id: string, maxPoints = 10000): Promise<TripPath> {
    await this.get(userId, id);
    const [line] = await this.prisma.$queryRaw<
      { geometry: LineStringGeometry | null; distance: number | null }[]
    >`
      SELECT CASE WHEN count(*) >= 2
               THEN ST_AsGeoJSON(ST_MakeLine(location ORDER BY recorded_at))::json END AS geometry,
             ST_Length(ST_MakeLine(location ORDER BY recorded_at)::geography) AS distance
      FROM trip_points WHERE trip_id = ${id}::uuid`;
    const points = await this.prisma.$queryRaw<
      {
        location: PointGeometry;
        accuracy: number | null;
        speed: number | null;
        heading: number | null;
        altitude: number | null;
        recorded_at: Date;
      }[]
    >`
      SELECT ST_AsGeoJSON(location)::json AS location, accuracy, speed, heading, altitude, recorded_at
      FROM trip_points WHERE trip_id = ${id}::uuid
      ORDER BY recorded_at ASC LIMIT ${maxPoints}`;
    return {
      tripId: id,
      geometry: line?.geometry ?? null,
      distanceMeters: Math.round(line?.distance ?? 0),
      points: points.map((point) => ({
        longitude: point.location.coordinates[0],
        latitude: point.location.coordinates[1],
        accuracy: point.accuracy,
        speed: point.speed,
        heading: point.heading,
        altitude: point.altitude,
        recordedAt: point.recorded_at,
      })),
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
