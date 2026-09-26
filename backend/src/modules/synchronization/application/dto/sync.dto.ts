import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SYNC_ENTITIES,
  SYNC_OPERATIONS,
  type SyncEntity,
  type SyncOperationType,
} from '../../domain/sync-operation';

export class SyncOperationDto {
  @ApiProperty({ example: '9b2b8d0e-6d6f-4c4e-9d0b-0c9f8f0f1a11' })
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  id: string;

  @ApiProperty({ enum: SYNC_ENTITIES })
  @IsIn(SYNC_ENTITIES)
  entity: SyncEntity;

  @ApiProperty({ enum: SYNC_OPERATIONS })
  @IsIn(SYNC_OPERATIONS)
  operation: SyncOperationType;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ example: '2026-09-25T12:00:00.000Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdAt?: string;
}

export class SyncPushDto {
  @ApiPropertyOptional({ description: 'Installation id of the pushing device' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  installationId?: string;

  @ApiProperty({ type: SyncOperationDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}

export class SyncPullQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    description: 'Changes at or after this time (or after `afterId` at this time)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'With `since`: continue after this route id (the `next` of the previous page)',
  })
  @IsOptional()
  @IsUUID()
  afterId?: string;

  @ApiPropertyOptional({ default: 200, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 200;
}
