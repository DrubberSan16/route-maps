import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface NewRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: NewRefreshToken) {
    return this.prisma.refreshToken.create({ data });
  }

  findById(id: string) {
    return this.prisma.refreshToken.findUnique({ where: { id } });
  }

  /**
   * Replaces a refresh token with its successor in one transaction. The previous token is
   * claimed with a conditional update, so when the same token is presented twice at once
   * only one request gets a successor: the other gets `false` and nothing is stored.
   */
  rotate(previousId: string, next: NewRefreshToken): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: previousId, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      if (claimed.count !== 1) return false;
      await tx.refreshToken.create({ data: next });
      return true;
    });
  }

  revoke(id: string) {
    return this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
