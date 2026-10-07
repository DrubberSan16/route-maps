import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { DevicePlatform, UserRole } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UserEntity } from '../domain/user.entity';

export interface RegisterDeviceInput {
  installationId: string;
  platform?: DevicePlatform;
  model?: string;
  appVersion?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async getById(id: string): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    return user;
  }

  create(input: {
    email: string;
    name: string;
    passwordHash: string;
    role?: UserRole;
    serviceAccount?: boolean;
  }): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role ?? UserRole.USER,
        serviceAccount: input.serviceAccount ?? false,
      },
    });
  }

  updateProfile(id: string, data: { name?: string }): Promise<UserEntity> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async recordLogin(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  /**
   * Replaces the password and closes every session of the account: its refresh tokens are
   * revoked and the access tokens issued until now stop being accepted.
   */
  async replacePassword(id: string, passwordHash: string): Promise<UserEntity> {
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, sessionsRevokedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return user;
  }

  /** Closes every session of the account without touching its password. */
  async revokeSessions(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { sessionsRevokedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Creates or refreshes the device record identified by its installation id. */
  registerDevice(userId: string, input: RegisterDeviceInput) {
    return this.prisma.device.upsert({
      where: { userId_installationId: { userId, installationId: input.installationId } },
      create: {
        userId,
        installationId: input.installationId,
        platform: input.platform ?? DevicePlatform.OTHER,
        model: input.model,
        appVersion: input.appVersion,
      },
      update: {
        platform: input.platform,
        model: input.model,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
      },
    });
  }

  listDevices(userId: string) {
    return this.prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
  }
}
