import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsJWT, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { trimLowerCase } from '../../../../common/dto/transforms';

export class RegisterDto {
  @ApiProperty({ example: 'demo@maps.local' })
  @Transform(trimLowerCase)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Demo1234!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'Usuario Demo' })
  @IsString()
  @Length(1, 120)
  name: string;
}

export class LoginDto {
  @ApiProperty({ example: 'demo@maps.local' })
  @Transform(trimLowerCase)
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Demo1234!' })
  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsJWT()
  refreshToken: string;
}

export class AuthTokensResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ example: 'Bearer' }) tokenType: 'Bearer';
  @ApiProperty({ example: 900 }) expiresIn: number;
  @ApiProperty({ example: 2592000 }) refreshExpiresIn: number;
}
