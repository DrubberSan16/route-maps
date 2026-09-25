import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthService } from './application/auth.service';
import { PASSWORD_HASHER } from './domain/password-hasher';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { RefreshTokenRepository } from './infrastructure/refresh-token.repository';
import { AuthController } from './presentation/auth.controller';

@Global()
@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenRepository,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
  ],
  exports: [JwtModule, PASSWORD_HASHER],
})
export class AuthModule {}
