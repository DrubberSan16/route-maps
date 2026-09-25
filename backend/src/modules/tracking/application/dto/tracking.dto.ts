import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class TrackLocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tripId: string;

  @ApiProperty({ example: -2.17 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -79.92 })
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ example: 8.4, description: 'Horizontal accuracy (m)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;

  @ApiPropertyOptional({ example: 10.1, description: 'Speed (m/s)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  speed?: number;

  @ApiPropertyOptional({ example: 180, description: 'Heading (degrees)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional({ example: 12.5, description: 'Altitude (m)' })
  @IsOptional()
  @IsNumber()
  @Min(-1000)
  @Max(20000)
  altitude?: number;

  @ApiProperty({ example: '2026-09-25T12:00:00.000Z', description: 'Device time of the fix' })
  @IsISO8601({ strict: true })
  timestamp: string;
}

export class TrackLocationBatchDto {
  @ApiProperty({ type: TrackLocationDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => TrackLocationDto)
  locations: TrackLocationDto[];
}

export const toLocationPoint = (dto: TrackLocationDto) => ({
  tripId: dto.tripId,
  latitude: dto.latitude,
  longitude: dto.longitude,
  accuracy: dto.accuracy,
  speed: dto.speed,
  heading: dto.heading,
  altitude: dto.altitude,
  recordedAt: new Date(dto.timestamp),
});
