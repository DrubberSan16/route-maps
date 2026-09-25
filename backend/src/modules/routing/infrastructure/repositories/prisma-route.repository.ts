import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { LineStringGeometry, PointGeometry, fromPoint } from '../../../../common/geo/geojson';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { RouteRepository, SavedRoute, SaveRouteInput } from '../../domain/entities/saved-route';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';

interface RouteRow {
  id: string;
  user_id: string;
  name: string;
  profile: RoutingProfile;
  origin: PointGeometry;
  destination: PointGeometry;
  distance_meters: number;
  duration_seconds: number;
  geometry: LineStringGeometry | null;
  steps: unknown[] | null;
  region_code: string | null;
  provider: string | null;
  created_at: Date;
  updated_at: Date;
}

const toEntity = (row: RouteRow): SavedRoute => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  profile: row.profile,
  origin: fromPoint(row.origin),
  destination: fromPoint(row.destination),
  distanceMeters: row.distance_meters,
  durationSeconds: row.duration_seconds,
  ...(row.geometry ? { geometry: row.geometry } : {}),
  ...(row.steps ? { steps: row.steps } : {}),
  regionCode: row.region_code,
  provider: row.provider,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const columns = (includeGeometry: boolean) => Prisma.sql`
  id, user_id, name, profile,
  ST_AsGeoJSON(origin)::json AS origin,
  ST_AsGeoJSON(destination)::json AS destination,
  distance_meters, duration_seconds,
  ${includeGeometry ? Prisma.sql`ST_AsGeoJSON(geometry)::json` : Prisma.sql`NULL::json`} AS geometry,
  ${includeGeometry ? Prisma.sql`steps` : Prisma.sql`NULL::jsonb`} AS steps,
  region_code, provider, created_at, updated_at`;

const point = (c: { latitude: number; longitude: number }) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${c.longitude}, ${c.latitude}), 4326)`;

@Injectable()
export class PrismaRouteRepository implements RouteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, input: SaveRouteInput & { id: string }): Promise<SavedRoute | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO routes (id, user_id, name, profile, origin, destination, distance_meters,
                            duration_seconds, geometry, steps, region_code, provider,
                            created_at, updated_at)
        VALUES (${input.id}::uuid, ${userId}::uuid, ${input.name},
                ${input.profile}::"RoutingProfile", ${point(input.origin)},
                ${point(input.destination)}, ${input.distanceMeters}, ${input.durationSeconds},
                ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}), 4326),
                ${JSON.stringify(input.steps)}::jsonb, ${input.regionCode ?? null},
                ${input.provider ?? null}, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          profile = EXCLUDED.profile,
          origin = EXCLUDED.origin,
          destination = EXCLUDED.destination,
          distance_meters = EXCLUDED.distance_meters,
          duration_seconds = EXCLUDED.duration_seconds,
          geometry = EXCLUDED.geometry,
          steps = EXCLUDED.steps,
          region_code = EXCLUDED.region_code,
          provider = EXCLUDED.provider,
          updated_at = now()
        WHERE routes.user_id = EXCLUDED.user_id
        RETURNING id`;
      if (rows.length === 0) return null;

      await tx.$executeRaw`DELETE FROM route_points WHERE route_id = ${input.id}::uuid`;
      await tx.$executeRaw`
        INSERT INTO route_points (id, route_id, sequence, type, location) VALUES
          (gen_random_uuid(), ${input.id}::uuid, 0, 'ORIGIN'::"RoutePointType", ${point(input.origin)}),
          (gen_random_uuid(), ${input.id}::uuid, 1, 'DESTINATION'::"RoutePointType",
           ${point(input.destination)})`;

      const saved = await tx.$queryRaw<RouteRow[]>`
        SELECT ${columns(true)} FROM routes WHERE id = ${input.id}::uuid`;
      return toEntity(saved[0]);
    });
  }

  async findById(userId: string, id: string): Promise<SavedRoute | null> {
    const rows = await this.prisma.$queryRaw<RouteRow[]>`
      SELECT ${columns(true)} FROM routes WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list(
    userId: string,
    options: { limit: number; offset: number; includeGeometry: boolean; updatedSince?: Date },
  ): Promise<{ items: SavedRoute[]; total: number }> {
    const since = options.updatedSince
      ? Prisma.sql`AND updated_at > ${options.updatedSince}::timestamptz`
      : Prisma.empty;
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<RouteRow[]>`
        SELECT ${columns(options.includeGeometry)} FROM routes
        WHERE user_id = ${userId}::uuid ${since}
        ORDER BY ${options.updatedSince ? Prisma.sql`updated_at ASC` : Prisma.sql`created_at DESC`}
        LIMIT ${options.limit} OFFSET ${options.offset}`,
      this.prisma.route.count({
        where: {
          userId,
          ...(options.updatedSince ? { updatedAt: { gt: options.updatedSince } } : {}),
        },
      }),
    ]);
    return { items: rows.map(toEntity), total };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.route.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }
}
