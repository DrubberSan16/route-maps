import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { Coordinate, fromPoint, PointGeometry, PolygonGeometry } from '../../../common/geo/geojson';
import { GeofenceType } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  Geofence,
  GeofenceInput,
  GeofenceRepository,
  GeofenceShape,
} from '../domain/geofence.entity';

interface GeofenceRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  type: GeofenceType;
  center: PointGeometry | null;
  radius_meters: number | null;
  geometry: PolygonGeometry;
  metadata: Record<string, unknown> | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

const SELECT = Prisma.sql`
  SELECT id, user_id, name, description, type,
         ST_AsGeoJSON(center)::json AS center, radius_meters,
         ST_AsGeoJSON(area)::json AS geometry, metadata, active, created_at, updated_at
  FROM geofences`;

const toEntity = (row: GeofenceRow): Geofence => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description,
  type: row.type,
  center: row.center ? fromPoint(row.center) : null,
  radiusMeters: row.radius_meters,
  geometry: row.geometry,
  metadata: row.metadata,
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** SQL fragments (type, center, radius, area) for a shape. */
const shapeSql = (shape: GeofenceShape) => {
  if (shape.type === 'CIRCLE') {
    const center = Prisma.sql`ST_SetSRID(ST_MakePoint(${shape.center.longitude}, ${shape.center.latitude}), 4326)`;
    return {
      type: Prisma.sql`'CIRCLE'::"GeofenceType"`,
      center,
      radius: Prisma.sql`${shape.radiusMeters}::double precision`,
      // Geodesic buffer (meters) converted back to a 4326 polygon, 16 segments per quarter.
      area: Prisma.sql`ST_Buffer(${center}::geography, ${shape.radiusMeters}, 'quad_segs=16')::geometry`,
    };
  }
  return {
    type: Prisma.sql`'POLYGON'::"GeofenceType"`,
    center: Prisma.sql`NULL::geometry`,
    radius: Prisma.sql`NULL::double precision`,
    area: Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(shape.polygon)}), 4326)`,
  };
};

@Injectable()
export class PrismaGeofenceRepository implements GeofenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: GeofenceInput): Promise<Geofence> {
    const shape = shapeSql(input.shape);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO geofences (id, user_id, name, description, type, center, radius_meters, area,
                             metadata, active, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${input.name}, ${input.description ?? null},
              ${shape.type}, ${shape.center}, ${shape.radius}, ${shape.area},
              ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
              ${input.active ?? true}, now(), now())
      RETURNING id`;
    return (await this.findById(userId, rows[0].id))!;
  }

  async update(
    userId: string,
    id: string,
    input: Partial<Omit<GeofenceInput, 'shape'>> & { shape?: GeofenceShape },
  ): Promise<Geofence | null> {
    const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.description !== undefined) sets.push(Prisma.sql`description = ${input.description}`);
    if (input.active !== undefined) sets.push(Prisma.sql`active = ${input.active}`);
    if (input.metadata !== undefined) {
      sets.push(
        Prisma.sql`metadata = ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb`,
      );
    }
    if (input.shape) {
      const shape = shapeSql(input.shape);
      sets.push(
        Prisma.sql`type = ${shape.type}`,
        Prisma.sql`center = ${shape.center}`,
        Prisma.sql`radius_meters = ${shape.radius}`,
        Prisma.sql`area = ${shape.area}`,
      );
    }
    const updated = await this.prisma.$executeRaw`
      UPDATE geofences SET ${Prisma.join(sets, ', ')}
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
    return updated > 0 ? this.findById(userId, id) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.geofence.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }

  async findById(userId: string, id: string): Promise<Geofence | null> {
    const rows = await this.prisma.$queryRaw<GeofenceRow[]>`${SELECT}
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list(userId: string, options: { activeOnly: boolean }): Promise<Geofence[]> {
    const active = options.activeOnly ? Prisma.sql`AND active = true` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GeofenceRow[]>`${SELECT}
      WHERE user_id = ${userId}::uuid ${active}
      ORDER BY created_at DESC`;
    return rows.map(toEntity);
  }

  async findContaining(userId: string, point: Coordinate): Promise<Geofence[]> {
    const rows = await this.prisma.$queryRaw<GeofenceRow[]>`${SELECT}
      WHERE user_id = ${userId}::uuid AND active = true
        AND ST_Intersects(area, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326))
      ORDER BY ST_Area(area) ASC`;
    return rows.map(toEntity);
  }

  async isValidPolygon(polygon: PolygonGeometry): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ valid: boolean }[]>`
      SELECT ST_IsValid(ST_GeomFromGeoJSON(${JSON.stringify(polygon)})) AS valid`;
    return rows[0]?.valid ?? false;
  }
}
