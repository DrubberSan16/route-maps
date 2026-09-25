import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { toLowerCase } from '../../../../common/dto/transforms';

export class GeocodingSearchQueryDto {
  @ApiProperty({ example: 'Malecón 2000, Guayaquil' })
  @IsString()
  @Length(2, 200)
  q: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;

  @ApiPropertyOptional({ description: 'Bias latitude', example: -2.19 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Bias longitude', example: -79.88 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ example: 'ec', description: 'Comma separated ISO country codes' })
  @IsOptional()
  @Transform(toLowerCase)
  @Matches(/^[a-z]{2}(,[a-z]{2})*$/)
  countryCodes?: string;

  @ApiPropertyOptional({ example: 'es' })
  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Za-z]{2})?$/)
  lang?: string;
}

export class ReverseGeocodingQueryDto {
  @ApiProperty({ example: -2.1709 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: -79.9224 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiPropertyOptional({ example: 'es' })
  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Za-z]{2})?$/)
  lang?: string;
}

export class GeocodingResultResponse {
  @ApiProperty({ example: 'Malecón 2000, Guayaquil, Guayas, Ecuador' }) displayName: string;
  @ApiPropertyOptional() name: string | null;
  @ApiProperty() latitude: number;
  @ApiProperty() longitude: number;
  @ApiPropertyOptional() category: string | null;
  @ApiPropertyOptional() type: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  address: Record<string, string | undefined>;
  @ApiPropertyOptional({ example: [-79.9, -2.2, -79.87, -2.18] })
  bbox: [number, number, number, number] | null;
  @ApiPropertyOptional({ example: 'osm:way:123' }) sourceId: string | null;
}
