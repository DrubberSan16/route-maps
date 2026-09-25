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
import { MapRegion } from '../../domain/map-region.entity';
import { toBoolean } from '../../../../common/dto/transforms';

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
    example: '/maps/ecuador/guayaquil.pmtiles',
    description: 'Range-readable PMTiles URL for online rendering (pmtiles:// protocol)',
  })
  tilesUrl: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() updatedAt: Date;
}

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
  tilesUrl: `${publicTilesBaseUrl.replace(/\/$/, '')}/${region.fileName}`,
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
