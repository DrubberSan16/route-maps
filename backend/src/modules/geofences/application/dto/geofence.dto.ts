import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from '../../../../common/dto/coordinate.dto';
import { PolygonDto } from '../../../../common/dto/geojson.dto';
import { GeofenceType } from '../../../../generated/prisma/enums';
import { GeofenceShape } from '../../domain/geofence.entity';
import { toBoolean } from '../../../../common/dto/transforms';

export class CreateGeofenceDto {
  @ApiProperty({ example: 'Bodega central' })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiProperty({ enum: GeofenceType })
  @IsEnum(GeofenceType)
  type: GeofenceType;

  @ApiPropertyOptional({ type: CoordinateDto, description: 'Required for CIRCLE' })
  @ValidateIf((dto: CreateGeofenceDto) => dto.type === GeofenceType.CIRCLE)
  @ValidateNested()
  @Type(() => CoordinateDto)
  center?: CoordinateDto;

  @ApiPropertyOptional({ example: 250, description: 'Required for CIRCLE (meters)' })
  @ValidateIf((dto: CreateGeofenceDto) => dto.type === GeofenceType.CIRCLE)
  @IsNumber()
  radiusMeters?: number;

  @ApiPropertyOptional({ type: PolygonDto, description: 'Required for POLYGON' })
  @ValidateIf((dto: CreateGeofenceDto) => dto.type === GeofenceType.POLYGON)
  @IsObject()
  polygon?: PolygonDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateGeofenceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) description?: string;

  @ApiPropertyOptional({ enum: GeofenceType })
  @IsOptional()
  @IsEnum(GeofenceType)
  type?: GeofenceType;

  @ApiPropertyOptional({ type: CoordinateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  center?: CoordinateDto;

  @ApiPropertyOptional() @IsOptional() @IsNumber() radiusMeters?: number;

  @ApiPropertyOptional({ type: PolygonDto })
  @IsOptional()
  @IsObject()
  polygon?: PolygonDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class GeofenceCheckQueryDto {
  @ApiProperty({ example: -2.19 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: -79.88 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

export class ListGeofencesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

/** Builds the domain shape from the DTO fields (type decides which fields apply). */
export const toShape = (dto: {
  type?: GeofenceType;
  center?: CoordinateDto;
  radiusMeters?: number;
  polygon?: PolygonDto;
}): GeofenceShape | undefined => {
  if (!dto.type) return undefined;
  if (dto.type === GeofenceType.CIRCLE) {
    return {
      type: 'CIRCLE',
      center: dto.center as CoordinateDto,
      radiusMeters: dto.radiusMeters as number,
    };
  }
  return { type: 'POLYGON', polygon: dto.polygon as PolygonDto };
};
