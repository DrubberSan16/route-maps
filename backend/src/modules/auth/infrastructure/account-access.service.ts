import { Injectable } from '@nestjs/common';
import type { AccountAccess, AccountAccessReader } from '../../../common/auth/auth-ports';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** How long the state of an account is reused before it is read again. */
const TTL_MS = 10_000;
const MAX_ENTRIES = 10_000;

/**
 * State of the accounts that send requests, read once every few seconds instead of on every
 * request. Changes made through this process (administration panel) apply at once because they
 * invalidate the entry; another backend replica sees them within TTL_MS.
 */
@Injectable()
export class AccountAccessService implements AccountAccessReader {
  private readonly cache = new Map<string, { value: AccountAccess | null; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<AccountAccess | null>>();

  constructor(private readonly prisma: PrismaService) {}

  get(userId: string): Promise<AccountAccess | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    const inFlight = this.pending.get(userId);
    if (inFlight) return inFlight;

    const read = this.read(userId);
    this.pending.set(userId, read);
    read.then(
      (value) => {
        // An invalidation while reading means the value may already be outdated: not kept.
        if (this.pending.get(userId) !== read) return;
        this.pending.delete(userId);
        this.cache.delete(userId);
        if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
      },
      () => {
        if (this.pending.get(userId) === read) this.pending.delete(userId);
      },
    );
    return read;
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
    this.pending.delete(userId);
  }

  private async read(userId: string): Promise<AccountAccess | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        serviceAccount: true,
        sessionsRevokedAt: true,
      },
    });
    return user && { ...user, sessionsRevokedAt: user.sessionsRevokedAt?.getTime() ?? null };
  }
}
