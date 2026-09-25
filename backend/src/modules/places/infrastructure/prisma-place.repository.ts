import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { fromPoint, PointGeometry } from '../../../common/geo/geojson';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Place, PlaceInput, PlaceRepository, PlaceSearch } from '../domain/place.entity';

interface PlaceRow {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  location: PointGeometry;
  distance_meters: number | null;
  is_favorite: boolean;
  alias: string | null;
  created_at: Date;
  updated_at: Date;
}

const toEntity = (row: PlaceRow): Place => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description,
  category: row.category,
  address: row.address,
  location: fromPoint(row.location),
  ...(row.distance_meters !== null ? { distanceMeters: Math.round(row.distance_meters) } : {}),
  favorite: row.is_favorite ? { alias: row.alias } : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

@Injectable()
export class PrismaPlaceRepository implements PlaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  private select(userId: string, distanceFrom?: { latitude: number; longitude: number }) {
    const distance = distanceFrom
      ? Prisma.sql`ST_Distance(p.location::geography,
          ST_SetSRID(ST_MakePoint(${distanceFrom.longitude}, ${distanceFrom.latitude}), 4326)::geography)`
      : Prisma.sql`NULL::double precision`;
    return Prisma.sql`
      SELECT p.id, p.user_id, p.name, p.description, p.category, p.address,
             ST_AsGeoJSON(p.location)::json AS location,
             ${distance} AS distance_meters,
             (f.id IS NOT NULL) AS is_favorite, f.alias,
             p.created_at, p.updated_at
      FROM places p
      LEFT JOIN favorite_places f ON f.place_id = p.id AND f.user_id = ${userId}::uuid`;
  }

  async create(userId: string, input: PlaceInput & { id?: string }): Promise<Place> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO places (id, user_id, name, description, category, address, location,
                          created_at, updated_at)
      VALUES (COALESCE(${input.id ?? null}::uuid, gen_random_uuid()), ${userId}::uuid,
              ${input.name}, ${input.description ?? null}, ${input.category ?? null},
              ${input.address ?? null},
              ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}), 4326),
              now(), now())
      RETURNING id`;
    return (await this.findVisible(userId, rows[0].id))!;
  }

  async update(userId: string, id: string, input: Partial<PlaceInput>): Promise<Place | null> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.description !== undefined) sets.push(Prisma.sql`description = ${input.description}`);
    if (input.category !== undefined) sets.push(Prisma.sql`category = ${input.category}`);
    if (input.address !== undefined) sets.push(Prisma.sql`address = ${input.address}`);
    if (input.location !== undefined) {
      sets.push(
        Prisma.sql`location = ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}), 4326)`,
      );
    }
    sets.push(Prisma.sql`updated_at = now()`);
    const updated = await this.prisma.$executeRaw`
      UPDATE places SET ${Prisma.join(sets, ', ')}
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
    return updated > 0 ? this.findVisible(userId, id) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.place.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }

  /** A place is visible to its owner, and shared places (user_id NULL) to everyone. */
  async findVisible(userId: string, id: string): Promise<Place | null> {
    const rows = await this.prisma.$queryRaw<PlaceRow[]>`${this.select(userId)}
      WHERE p.id = ${id}::uuid AND (p.user_id = ${userId}::uuid OR p.user_id IS NULL)`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async search(userId: string, search: PlaceSearch): Promise<Place[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(p.user_id = ${userId}::uuid OR p.user_id IS NULL)`,
    ];
    if (search.text) {
      const pattern = `%${search.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        Prisma.sql`(p.name ILIKE ${pattern} OR p.address ILIKE ${pattern} OR p.category ILIKE ${pattern})`,
      );
    }
    if (search.favoritesOnly) conditions.push(Prisma.sql`f.id IS NOT NULL`);
    if (search.near) {
      conditions.push(Prisma.sql`ST_DWithin(p.location::geography,
        ST_SetSRID(ST_MakePoint(${search.near.longitude}, ${search.near.latitude}), 4326)::geography,
        ${search.near.radiusMeters})`);
    }
    const order = search.near ? Prisma.sql`distance_meters ASC` : Prisma.sql`p.created_at DESC`;
    const rows = await this.prisma.$queryRaw<PlaceRow[]>`${this.select(userId, search.near)}
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${order}
      LIMIT ${search.limit} OFFSET ${search.offset}`;
    return rows.map(toEntity);
  }

  async setFavorite(userId: string, placeId: string, alias: string | null): Promise<void> {
    await this.prisma.favoritePlace.upsert({
      where: { userId_placeId: { userId, placeId } },
      create: { userId, placeId, alias },
      update: { alias },
    });
  }

  async removeFavorite(userId: string, placeId: string): Promise<boolean> {
    const result = await this.prisma.favoritePlace.deleteMany({ where: { userId, placeId } });
    return result.count > 0;
  }
}
