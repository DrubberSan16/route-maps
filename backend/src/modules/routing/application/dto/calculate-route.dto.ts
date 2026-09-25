import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from '../../../../common/dto/coordinate.dto';
import { LineStringDto } from '../../../../common/dto/geojson.dto';
import { ROUTING_PROFILES, type RoutingProfile } from '../../domain/value-objects/routing-profile';

export class RouteOptionsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() avoidTolls?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() avoidHighways?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() avoidFerries?: boolean;
}

export class CalculateRouteDto {
  @ApiProperty({ type: CoordinateDto, example: { latitude: -2.1709, longitude: -79.9224 } })
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin: CoordinateDto;

  @ApiProperty({ type: CoordinateDto, example: { latitude: -2.145, longitude: -79.89 } })
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination: CoordinateDto;

  @ApiPropertyOptional({
    type: CoordinateDto,
    isArray: true,
    description: 'Optional intermediate stops (multi-stop). Alternatives are disabled when set.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(23)
  @ValidateNested({ each: true })
  @Type(() => CoordinateDto)
  waypoints?: CoordinateDto[];

  @ApiPropertyOptional({ enum: ROUTING_PROFILES, default: 'CAR' })
  @IsOptional()
  @IsIn(ROUTING_PROFILES)
  profile: RoutingProfile = 'CAR';

  @ApiPropertyOptional({
    description: 'true = include alternative routes; a number = how many (max 3)',
    oneOf: [{ type: 'boolean' }, { type: 'integer', minimum: 0, maximum: 3 }],
    default: false,
  })
  @IsOptional()
  alternatives?: boolean | number;

  @ApiPropertyOptional({ example: 'es-ES', description: 'Instruction language (BCP-47)' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  language?: string;

  @ApiPropertyOptional({ type: RouteOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RouteOptionsDto)
  options?: RouteOptionsDto;
}

export class RouteStepResponse {
  @ApiProperty({ example: 'Continúe recto' }) instruction: string;
  @ApiProperty({ example: 300 }) distanceMeters: number;
  @ApiProperty({ example: 45 }) durationSeconds: number;
  @ApiProperty({ example: 'CONTINUE' }) maneuver: string;
  @ApiProperty({ example: [-79.9224, -2.1709] }) location: [number, number];
  @ApiProperty({ type: [String] }) streetNames: string[];
  @ApiProperty({ example: [0, 12] }) geometryIndex: [number, number];
}

export class RouteResponse {
  @ApiProperty({ format: 'uuid' }) routeId: string;
  @ApiProperty({ enum: ['PRIMARY', 'ALTERNATIVE'] }) type: 'PRIMARY' | 'ALTERNATIVE';
  @ApiProperty({ example: 8300 }) distanceMeters: number;
  @ApiProperty({ example: 1020 }) durationSeconds: number;
  @ApiProperty({ type: LineStringDto }) geometry: LineStringDto;
  @ApiProperty({ type: RouteStepResponse, isArray: true }) steps: RouteStepResponse[];
  @ApiProperty({ example: [-79.93, -2.18, -79.88, -2.14] }) bbox: [number, number, number, number];
}

export class CalculateRouteResponse extends RouteResponse {
  @ApiProperty({ enum: ROUTING_PROFILES }) profile: RoutingProfile;
  @ApiProperty({ example: 'valhalla' }) provider: string;
  @ApiProperty({ type: RouteResponse, isArray: true, description: 'Primary route first' })
  routes: RouteResponse[];
}

export class SaveRouteDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Client generated id (idempotent upsert, used by offline sync)',
  })
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  id?: string;

  @ApiProperty({ example: 'Casa → Oficina' })
  @IsString()
  @Matches(/^.{1,120}$/s)
  name: string;

  @ApiProperty({ enum: ROUTING_PROFILES })
  @IsIn(ROUTING_PROFILES)
  profile: RoutingProfile;

  @ApiProperty({ type: CoordinateDto })
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin: CoordinateDto;

  @ApiProperty({ type: CoordinateDto })
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination: CoordinateDto;

  @ApiProperty({ example: 8300 })
  @Type(() => Number)
  @Min(0)
  distanceMeters: number;

  @ApiProperty({ example: 1020 })
  @Type(() => Number)
  @Min(0)
  durationSeconds: number;

  @ApiProperty({ type: LineStringDto })
  @IsObject()
  geometry: LineStringDto;

  @ApiPropertyOptional({ type: RouteStepResponse, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  steps?: unknown[];

  @ApiPropertyOptional({ example: 'guayaquil' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,64}$/)
  regionCode?: string;

  @ApiPropertyOptional({ example: 'valhalla' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{1,32}$/)
  provider?: string;
}

export class ListRoutesQueryDto {
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
