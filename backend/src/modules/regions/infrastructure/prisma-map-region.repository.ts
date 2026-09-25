import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BoundingBox } from '../../../common/geo/geojson';
import { MapRegion, MapRegionRepository, UpsertMapRegion } from '../domain/map-region.entity';

interface MapRegionRow {
  id: string;
  code: string;
  name: string;
  country: string;
  province: string | null;
  city: string | null;
  version: string;
  file_name: string;
  file_size: bigint;
  checksum: string;
  min_zoom: number;
  max_zoom: number;
  download_url: string | null;
  routing_file: string | null;
  routing_file_size: bigint | null;
  routing_checksum: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  bbox: BoundingBox | null;
}

const SELECT = Prisma.sql`
  SELECT id, code, name, country, province, city, version, file_name, file_size, checksum,
         min_zoom, max_zoom, download_url, routing_file, routing_file_size, routing_checksum,
         enabled, created_at, updated_at,
         CASE WHEN bounding_box IS NULL THEN NULL ELSE json_build_array(
           ST_XMin(bounding_box), ST_YMin(bounding_box), ST_XMax(bounding_box), ST_YMax(bounding_box)
         ) END AS bbox
  FROM map_regions`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toEntity = (row: MapRegionRow): MapRegion => ({
  id: row.id,
  code: row.code,
  name: row.name,
  country: row.country,
  province: row.province,
  city: row.city,
  version: row.version,
  fileName: row.file_name,
  fileSize: Number(row.file_size),
  checksum: row.checksum,
  bbox: row.bbox,
  minZoom: row.min_zoom,
  maxZoom: row.max_zoom,
  downloadUrl: row.download_url,
  routingFile: row.routing_file,
  routingFileSize: row.routing_file_size === null ? null : Number(row.routing_file_size),
  routingChecksum: row.routing_checksum,
  enabled: row.enabled,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

@Injectable()
export class PrismaMapRegionRepository implements MapRegionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({ includeDisabled }: { includeDisabled: boolean }): Promise<MapRegion[]> {
    const where = includeDisabled ? Prisma.empty : Prisma.sql`WHERE enabled = true`;
    const rows = await this.prisma.$queryRaw<MapRegionRow[]>`${SELECT} ${where}
      ORDER BY country, name`;
    return rows.map(toEntity);
  }

  async findByCodeOrId(idOrCode: string): Promise<MapRegion | null> {
    const condition = UUID_PATTERN.test(idOrCode)
      ? Prisma.sql`WHERE id = ${idOrCode}::uuid OR code = ${idOrCode}`
      : Prisma.sql`WHERE code = ${idOrCode}`;
    const rows = await this.prisma.$queryRaw<MapRegionRow[]>`${SELECT} ${condition} LIMIT 1`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  /** Enabled regions whose bounding box contains the point, most specific (smallest) first. */
  async findContaining(latitude: number, longitude: number): Promise<MapRegion[]> {
    const rows = await this.prisma.$queryRaw<MapRegionRow[]>`${SELECT}
      WHERE enabled = true
        AND bounding_box IS NOT NULL
        AND ST_Contains(bounding_box, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326))
      ORDER BY ST_Area(bounding_box) ASC`;
    return rows.map(toEntity);
  }

  async upsert(region: UpsertMapRegion): Promise<MapRegion> {
    const data = {
      name: region.name,
      country: region.country.toUpperCase(),
      province: region.province ?? null,
      city: region.city ?? null,
      version: region.version,
      fileName: region.fileName,
      fileSize: BigInt(region.fileSize),
      checksum: region.checksum,
      minZoom: region.minZoom,
      maxZoom: region.maxZoom,
      routingFile: region.routingFile ?? null,
      routingFileSize: region.routingFileSize == null ? null : BigInt(region.routingFileSize),
      routingChecksum: region.routingChecksum ?? null,
      enabled: region.enabled,
    };
    const [minLng, minLat, maxLng, maxLat] = region.bbox;
    await this.prisma.$transaction([
      this.prisma.mapRegion.upsert({
        where: { code: region.code },
        create: { code: region.code, ...data },
        update: data,
      }),
      this.prisma.$executeRaw`
        UPDATE map_regions
        SET bounding_box = ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
        WHERE code = ${region.code}`,
    ]);
    const saved = await this.findByCodeOrId(region.code);
    if (!saved) throw new Error(`Region ${region.code} vanished after upsert`);
    return saved;
  }

  async setEnabled(code: string, enabled: boolean): Promise<void> {
    await this.prisma.mapRegion.update({ where: { code }, data: { enabled } });
  }
}
