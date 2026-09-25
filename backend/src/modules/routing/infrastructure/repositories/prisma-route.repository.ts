import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { LineStringGeometry, PointGeometry, fromPoint } from '../../../../common/geo/geojson';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import {
  RouteChangeCursor,
  RouteChanges,
  RouteRepository,
  SavedRoute,
  SaveRouteInput,
} from '../../domain/entities/saved-route';
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

interface ChangeRow extends RouteRow {
  change_id: string;
  changed_at: Date;
  deleted: boolean;
}

/** Route columns of the table (or alias) `table`, which is always a fixed identifier. */
const columns = (includeGeometry: boolean, table = 'routes') => {
  const t = Prisma.raw(table);
  return Prisma.sql`
  ${t}.id, ${t}.user_id, ${t}.name, ${t}.profile,
  ST_AsGeoJSON(${t}.origin)::json AS origin,
  ST_AsGeoJSON(${t}.destination)::json AS destination,
  ${t}.distance_meters, ${t}.duration_seconds,
  ${includeGeometry ? Prisma.sql`ST_AsGeoJSON(${t}.geometry)::json` : Prisma.sql`NULL::json`} AS geometry,
  ${includeGeometry ? Prisma.sql`${t}.steps` : Prisma.sql`NULL::jsonb`} AS steps,
  ${t}.region_code, ${t}.provider, ${t}.created_at, ${t}.updated_at`;
};

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

      // Saved again after a deletion: the route is alive, its tombstone must not reach
      // other devices (they would delete the route they have just received).
      await tx.$executeRaw`
        DELETE FROM route_tombstones
        WHERE user_id = ${userId}::uuid AND route_id = ${input.id}::uuid`;
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
    options: { limit: number; offset: number; includeGeometry: boolean },
  ): Promise<{ items: SavedRoute[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<RouteRow[]>`
        SELECT ${columns(options.includeGeometry)} FROM routes
        WHERE user_id = ${userId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${options.limit} OFFSET ${options.offset}`,
      this.prisma.route.count({ where: { userId } }),
    ]);
    return { items: rows.map(toEntity), total };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.route.deleteMany({ where: { id, userId } });
      if (deleted.count === 0) return false;
      await tx.$executeRaw`
        INSERT INTO route_tombstones (user_id, route_id, deleted_at)
        VALUES (${userId}::uuid, ${id}::uuid, now())
        ON CONFLICT (user_id, route_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`;
      return true;
    });
  }

  /**
   * One feed of saved routes (by updated_at) and tombstones (by deleted_at), ordered by
   * (timestamp, id) so that a page boundary between changes with the same millisecond
   * never skips one. A route id is never in both tables, so a page holds each id once.
   */
  async changes(userId: string, after: RouteChangeCursor, limit: number): Promise<RouteChanges> {
    const since = after.changedAt.toISOString();
    const rows = await this.prisma.$queryRaw<ChangeRow[]>`
      WITH page AS (
        SELECT change.* FROM (
          SELECT id AS change_id, updated_at AS changed_at, false AS deleted
          FROM routes
          WHERE user_id = ${userId}::uuid
            AND (updated_at, id) > (${since}::timestamptz, ${after.id}::uuid)
          UNION ALL
          SELECT route_id, deleted_at, true
          FROM route_tombstones
          WHERE user_id = ${userId}::uuid
            AND (deleted_at, route_id) > (${since}::timestamptz, ${after.id}::uuid)
        ) change
        ORDER BY change.changed_at, change.change_id
        LIMIT ${limit + 1}
      )
      SELECT page.change_id, page.changed_at, page.deleted, ${columns(true, 'r')}
      FROM page LEFT JOIN routes r ON r.id = page.change_id AND NOT page.deleted
      ORDER BY page.changed_at, page.change_id`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      routes: page.filter((row) => !row.deleted).map(toEntity),
      deletedIds: page.filter((row) => row.deleted).map((row) => row.change_id),
      next: last ? { changedAt: last.changed_at, id: last.change_id } : null,
      hasMore: rows.length > limit,
    };
  }
}
