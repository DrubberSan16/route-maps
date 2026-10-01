import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { MapRegion, REGION_ASSET_KINDS, RegionAsset } from '../../domain/map-region.entity';
import { toBoolean } from '../../../../common/dto/transforms';

export class RegionAssetResponse {
  @ApiProperty({ enum: REGION_ASSET_KINDS, example: 'satellite' }) kind: string;
  @ApiProperty({ example: 'webp', description: 'Tile format: webp, png, jpg or pbf' })
  format: string;
  @ApiProperty({ example: 0 }) minZoom: number;
  @ApiProperty({ example: 14 }) maxZoom: number;
  @ApiProperty({ example: 5422330, description: 'Size in bytes' }) size: number;
  @ApiProperty({ example: 'sha256 hex' }) checksum: string;
  @ApiProperty({
    example: '/maps/ecuador/guayaquil.satellite.pmtiles?v=2026.09.30.1200',
    description: 'Range-readable PMTiles URL for online rendering (pmtiles:// protocol)',
  })
  tilesUrl: string;
  @ApiProperty({ example: '/api/v1/maps/regions/guayaquil/assets/satellite/download' })
  downloadUrl: string;
}

export class MapRegionResponse {
  @ApiProperty({ example: 'guayaquil', description: 'Public region identifier (code)' })
  id: string;
  @ApiProperty({ example: 'Guayaquil' }) name: string;
  @ApiProperty({ example: 'EC' }) country: string;
  @ApiPropertyOptional({ example: 'Guayas' }) province: string | null;
  @ApiPropertyOptional({ example: 'Guayaquil' }) city: string | null;
  @ApiProperty({ example: '2026.09.01' }) version: string;
  @ApiProperty({ example: 185420000, description: 'PMTiles size in bytes' }) mapSize: number;
  @ApiPropertyOptional({ example: 65200000, description: 'Routing package size in bytes' })
  routingSize: number | null;
  @ApiProperty({ example: 'sha256 hex' }) checksum: string;
  @ApiPropertyOptional() routingChecksum: string | null;
  @ApiPropertyOptional({ example: [-80.05, -2.3, -79.8, -2.05] })
  bbox: [number, number, number, number] | null;
  @ApiProperty({ example: 0 }) minZoom: number;
  @ApiProperty({ example: 14 }) maxZoom: number;
  @ApiProperty({ example: '/api/v1/maps/regions/guayaquil/download' }) mapDownloadUrl: string;
  @ApiPropertyOptional({ example: '/api/v1/maps/regions/guayaquil/routing/download' })
  routingDownloadUrl: string | null;
  @ApiProperty({
    example: '/maps/ecuador/guayaquil.pmtiles?v=3f5a0c9d1e2b4a67',
    description:
      'Range-readable PMTiles URL for online rendering (pmtiles:// protocol). The query string ' +
      'is the start of the SHA-256 of the file: it changes with the data, so the file can be ' +
      'cached for good.',
  })
  tilesUrl: string;
  @ApiProperty({
    type: RegionAssetResponse,
    isArray: true,
    description: 'Relief (terrain), satellite imagery and overlays of the region, when built',
  })
  assets: RegionAssetResponse[];
  @ApiProperty() enabled: boolean;
  @ApiProperty() updatedAt: Date;
}

/**
 * Public URL of a map file named by its content (start of the SHA-256), so that it can be cached
 * for good: a rebuilt file always gets a new URL, even when only one of its archives changed.
 */
const versionedTilesUrl = (base: string, file: string, checksum: string, version: string): string =>
  `${base.replace(/\/$/, '')}/${file}?v=${
    /^[0-9a-f]{16}/.test(checksum) ? checksum.slice(0, 16) : encodeURIComponent(version)
  }`;

const toAssetResponse = (
  region: MapRegion,
  asset: RegionAsset,
  publicTilesBaseUrl: string,
): RegionAssetResponse => ({
  kind: asset.kind,
  format: asset.format,
  minZoom: asset.minZoom,
  maxZoom: asset.maxZoom,
  size: asset.size,
  checksum: asset.checksum,
  tilesUrl: versionedTilesUrl(publicTilesBaseUrl, asset.file, asset.checksum, region.version),
  downloadUrl: `/api/v1/maps/regions/${region.code}/assets/${asset.kind}/download`,
});

export const toRegionResponse = (
  region: MapRegion,
  publicTilesBaseUrl: string,
): MapRegionResponse => ({
  id: region.code,
  name: region.name,
  country: region.country,
  province: region.province,
  city: region.city,
  version: region.version,
  mapSize: region.fileSize,
  routingSize: region.routingFileSize,
  checksum: region.checksum,
  routingChecksum: region.routingChecksum,
  bbox: region.bbox,
  minZoom: region.minZoom,
  maxZoom: region.maxZoom,
  mapDownloadUrl: region.downloadUrl ?? `/api/v1/maps/regions/${region.code}/download`,
  routingDownloadUrl: region.routingFile
    ? `/api/v1/maps/regions/${region.code}/routing/download`
    : null,
  tilesUrl: versionedTilesUrl(publicTilesBaseUrl, region.fileName, region.checksum, region.version),
  assets: region.assets.map((asset) => toAssetResponse(region, asset, publicTilesBaseUrl)),
  enabled: region.enabled,
  updatedAt: region.updatedAt,
});

export class ListRegionsQueryDto {
  @ApiPropertyOptional({ description: 'Admins only: include disabled regions' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeDisabled?: boolean;
}

export class RegionVersionQueryDto {
  @ApiPropertyOptional({ example: '2026.08', description: 'Version stored on the device' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  localVersion?: string;
}

export class VersionStatusResponse {
  @ApiProperty({ example: 'guayaquil' }) region: string;
  @ApiPropertyOptional({ example: '2026.08' }) localVersion: string | null;
  @ApiProperty({ example: '2026.09' }) latestVersion: string;
  @ApiProperty() checksum: string;
  @ApiProperty({ example: true }) updateAvailable: boolean;
}

export class LocalRegionVersionDto {
  @ApiProperty({ example: 'guayaquil' })
  @IsString()
  @Length(1, 64)
  id: string;

  @ApiProperty({ example: '2026.08' })
  @IsString()
  @Length(1, 40)
  version: string;
}

export class CheckUpdatesDto {
  @ApiProperty({ type: LocalRegionVersionDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LocalRegionVersionDto)
  regions: LocalRegionVersionDto[];
}

export class LocateQueryDto {
  @ApiProperty({ example: -2.1709 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: -79.9224 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

export class SetRegionEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class SyncRegionsDto {
  @ApiPropertyOptional({ description: 'Recompute checksums even if files look unchanged' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
