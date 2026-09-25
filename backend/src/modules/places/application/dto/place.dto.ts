import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from '../../../../common/dto/coordinate.dto';
import { toBoolean } from '../../../../common/dto/transforms';

export class CreatePlaceDto {
  @ApiProperty({ example: 'Oficina' })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiPropertyOptional({ example: 'work' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  category?: string;

  @ApiPropertyOptional({ example: 'Av. 9 de Octubre, Guayaquil' })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  address?: string;

  @ApiProperty({ type: CoordinateDto })
  @ValidateNested()
  @Type(() => CoordinateDto)
  location: CoordinateDto;
}

export class UpdatePlaceDto extends PartialType(CreatePlaceDto) {}

export class SearchPlacesQueryDto {
  @ApiPropertyOptional({ example: 'ofi' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;

  @ApiPropertyOptional({ example: -2.19 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: -79.88 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ default: 5000, description: 'Search radius in meters (with lat/lng)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200000)
  radius = 5000;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  favorites?: boolean;

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

export class FavoriteDto {
  @ApiPropertyOptional({ example: 'Casa' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  alias?: string;
}
