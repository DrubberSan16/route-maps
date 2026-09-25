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
    if (!user) throw AppException.notFound(ErrorCode.NOT_FOUND, 'User not found');
    return user;
  }

  create(input: {
    email: string;
    name: string;
    passwordHash: string;
    role?: UserRole;
  }): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role ?? UserRole.USER,
      },
    });
  }

  updateProfile(id: string, data: { name?: string }): Promise<UserEntity> {
    return this.prisma.user.update({ where: { id }, data });
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
