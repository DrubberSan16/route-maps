import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { DevicePlatform, UserRole } from '../../../../generated/prisma/enums';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ana Pérez' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
}

export class RegisterDeviceDto {
  @ApiProperty({ example: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  installationId: string;

  @ApiPropertyOptional({ enum: DevicePlatform })
  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;

  @ApiPropertyOptional({ example: 'Pixel 8' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  model?: string;

  @ApiPropertyOptional({ example: '0.1.0+1' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  appVersion?: string;
}

export class UserProfileResponse {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty() createdAt: Date;
}

export class DeviceResponse {
  @ApiProperty() id: string;
  @ApiProperty() installationId: string;
  @ApiProperty({ enum: DevicePlatform }) platform: DevicePlatform;
  @ApiPropertyOptional() model?: string | null;
  @ApiPropertyOptional() appVersion?: string | null;
  @ApiProperty() lastSeenAt: Date;
}
