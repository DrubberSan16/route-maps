import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { toBoolean, trimLowerCase } from '../../../../common/dto/transforms';
import {
  DevicePlatform,
  SyncEventStatus,
  TripStatus,
  UserRole,
} from '../../../../generated/prisma/enums';
import { CreateGeofenceDto } from '../../../geofences/application/dto/geofence.dto';
import { PLATFORM_EVENT_TYPES, WEBHOOK_TEST_EVENT } from '../../../events/domain/platform-event';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Free text filter shared by the lists (matched case-insensitively). */
class SearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Text to look for' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;
}

// --- Accounts -----------------------------------------------------------------------------------

export const ACCOUNT_KINDS = ['people', 'service', 'all'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export class ListUsersQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: ACCOUNT_KINDS,
    default: 'people',
    description: 'people: accounts that sign in; service: accounts of integrations',
  })
  @IsOptional()
  @IsIn(ACCOUNT_KINDS)
  kind: AccountKind = 'people';
}

export class CreateUserDto {
  @ApiProperty({ example: 'operador@empresa.com' })
  @Transform(trimLowerCase)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Ana Pérez' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.USER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    minLength: 8,
    description: 'When absent a temporary password is generated and returned once',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'false closes every session of the account' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({
    minLength: 8,
    description: 'When absent a temporary password is generated and returned once',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class ListDevicesQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({ enum: DevicePlatform })
  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// --- Operations ---------------------------------------------------------------------------------

export class ListAdminTripsQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({ enum: TripStatus })
  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Started at or after (ISO 8601)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Started before (ISO 8601)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class ListSyncEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SyncEventStatus })
  @IsOptional()
  @IsEnum(SyncEventStatus)
  status?: SyncEventStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({ example: 'trip' })
  @IsOptional()
  @Matches(/^[a-z_]{1,40}$/)
  entity?: string;
}

export class ListAdminEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [...PLATFORM_EVENT_TYPES, WEBHOOK_TEST_EVENT] })
  @IsOptional()
  @IsIn([...PLATFORM_EVENT_TYPES, WEBHOOK_TEST_EVENT])
  type?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class ListAuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'user.', description: 'Action or start of it' })
  @IsOptional()
  @Matches(/^[a-z_.]{1,60}$/)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @Matches(/^[a-z_]{1,40}$/)
  targetType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({ description: 'At or after (ISO 8601)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Before (ISO 8601)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

// --- Geographic data ----------------------------------------------------------------------------

export class ListAdminGeofencesQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class CreateAdminGeofenceDto extends CreateGeofenceDto {
  @ApiProperty({ format: 'uuid', description: 'Account the geofence belongs to' })
  @IsUUID()
  accountId: string;
}

export const PLACE_SCOPES = ['shared', 'private', 'all'] as const;
export type PlaceScope = (typeof PLACE_SCOPES)[number];

export class ListAdminPlacesQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({
    enum: PLACE_SCOPES,
    default: 'all',
    description: 'shared: places every account sees; private: places of one account',
  })
  @IsOptional()
  @IsIn(PLACE_SCOPES)
  scope: PlaceScope = 'all';

  @ApiPropertyOptional({ format: 'uuid', description: 'Private places of this account' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class ListAdminRoutesQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
