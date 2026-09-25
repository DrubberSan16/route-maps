import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { RoutingProfile, TripStatus } from '../../../../generated/prisma/enums';

export class StartTripDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Client generated id (idempotent)' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ example: 'Reparto zona norte' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ enum: RoutingProfile, default: RoutingProfile.CAR })
  @IsOptional()
  @IsEnum(RoutingProfile)
  profile?: RoutingProfile;

  @ApiPropertyOptional({ format: 'uuid', description: 'Saved route being followed' })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ description: 'Installation id of the device recording the trip' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  installationId?: string;

  @ApiPropertyOptional({ example: '2026-09-25T12:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startedAt?: string;
}

export class FinishTripDto {
  @ApiPropertyOptional({ example: '2026-09-25T12:45:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  endedAt?: string;
}

export class ListTripsQueryDto {
  @ApiPropertyOptional({ enum: TripStatus })
  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
