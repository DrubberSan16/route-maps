import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PLATFORM_EVENT_TYPES } from '../../domain/platform-event';

/** "a,b" or repeated query parameters → ["a", "b"]. */
const toList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

export class EventsFeedQueryDto {
  @ApiPropertyOptional({
    default: '0',
    description: 'Position of the last event already processed (`next` of the previous page)',
  })
  @IsOptional()
  @Matches(/^\d{1,18}$/, { message: 'after must be a non-negative integer' })
  after = '0';

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;

  @ApiPropertyOptional({
    description: 'Comma-separated event types; all when absent',
    example: 'trip.finished,geofence.entered',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(PLATFORM_EVENT_TYPES.length)
  @IsIn(PLATFORM_EVENT_TYPES, { each: true })
  types?: string[];
}
