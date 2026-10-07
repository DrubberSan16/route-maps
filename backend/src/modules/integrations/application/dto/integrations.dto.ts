import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { API_SCOPES, type ApiScope } from '../../../../common/auth/api-scopes';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { toBoolean, trimLowerCase } from '../../../../common/dto/transforms';
import { IntegrationEventScope, WebhookDeliveryStatus } from '../../../../generated/prisma/enums';
import { ALL_EVENTS, PLATFORM_EVENT_TYPES } from '../../../events/domain/platform-event';

/** Highest per-integration quota the panel accepts (requests per minute). */
export const MAX_RATE_LIMIT_PER_MINUTE = 6000;
/** Quota of an integration created without one (the column default). */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
const WEBHOOK_EVENTS = [ALL_EVENTS, ...PLATFORM_EVENT_TYPES];
const EVENT_SCOPE_DESCRIPTION =
  'Whose events its webhooks and GET /events receive: those of the account it acts as (ACCOUNT) ' +
  'or those of every account (ALL_ACCOUNTS, for an ERP or a reporting tool of the whole fleet). ' +
  'Its API keys act as its own account either way.';

export class ListIntegrationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Name, description or account email' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class CreateIntegrationDto {
  @ApiProperty({ example: 'ERP de flota' })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ example: 'Recibe los viajes terminados y las entradas a bodegas' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'sistemas@empresa.com' })
  @IsOptional()
  @Transform(trimLowerCase)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional({
    default: DEFAULT_RATE_LIMIT_PER_MINUTE,
    maximum: MAX_RATE_LIMIT_PER_MINUTE,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RATE_LIMIT_PER_MINUTE)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Existing account the integration acts as (its trips, geofences, places and routes). ' +
      'When absent a new service account is created for the integration.',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    enum: IntegrationEventScope,
    default: IntegrationEventScope.ACCOUNT,
    description: EVENT_SCOPE_DESCRIPTION,
  })
  @IsOptional()
  @IsEnum(IntegrationEventScope)
  eventScope?: IntegrationEventScope;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimLowerCase)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;

  @ApiPropertyOptional({ maximum: MAX_RATE_LIMIT_PER_MINUTE })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RATE_LIMIT_PER_MINUTE)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({ enum: IntegrationEventScope, description: EVENT_SCOPE_DESCRIPTION })
  @IsOptional()
  @IsEnum(IntegrationEventScope)
  eventScope?: IntegrationEventScope;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Servidor de producción' })
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ enum: API_SCOPES, isArray: true, example: ['trips:read', 'events:read'] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(API_SCOPES.length)
  @IsIn(API_SCOPES, { each: true })
  scopes: ApiScope[];

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00Z',
    description: 'Never expires when absent',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://erp.empresa.com/webhooks/route-maps' })
  @IsString()
  @Length(8, 2048)
  url: string;

  @ApiPropertyOptional({ example: 'Viajes terminados', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({
    enum: WEBHOOK_EVENTS,
    isArray: true,
    description: `Event types delivered; "${ALL_EVENTS}" for all of them`,
    example: ['trip.finished', 'geofence.entered'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events: string[];
}

export class UpdateWebhookDto extends PartialType(CreateWebhookDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ListDeliveriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  webhookId?: string;

  @ApiPropertyOptional({ enum: WebhookDeliveryStatus })
  @IsOptional()
  @IsEnum(WebhookDeliveryStatus)
  status?: WebhookDeliveryStatus;
}

export class UsageQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 400 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(400)
  days = 30;
}
