import {
  HttpStatus,
  Injectable,
  Logger,
  BeforeApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import type {
  ApiKeyAuthenticator,
  ApiKeyPrincipal,
  ResponseLike,
} from '../../../common/auth/auth-ports';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppConfigService } from '../../../config/app-config.service';
import { Prisma } from '../../../generated/prisma/client';
import { IntegrationEventScope } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { apiKeyMatches, apiKeyPrefix } from '../domain/api-key';

/** How long a key (or the absence of one) is reused before it is read again. */
const CACHE_TTL_MS = 30_000;
const MAX_CACHED_KEYS = 10_000;
/** Usage counters and last-use times are written in batches. */
const FLUSH_INTERVAL_MS = 10_000;
/** The last use of a key is saved at most this often. */
const LAST_USE_INTERVAL_MS = 60_000;

interface CachedKey {
  keyHash: string;
  expiresAt: number | null;
  revoked: boolean;
  integrationActive: boolean;
  principal: ApiKeyPrincipal;
}

interface UsageCounter {
  keyId: string;
  day: string;
  requests: number;
  errors: number;
}

const invalidKey = (message: string) =>
  new AppException(ErrorCode.INVALID_API_KEY, message, HttpStatus.UNAUTHORIZED);

/**
 * Authenticates the `X-API-Key` of integrations and counts their requests per key and day
 * (in TRAFFIC_TIME_ZONE, the platform's day). Keys are read from the database once every
 * CACHE_TTL_MS; changes made through the administration panel invalidate them at once.
 */
@Injectable()
export class ApiKeyAuthenticatorService
  implements ApiKeyAuthenticator, OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ApiKeyAuthenticatorService.name);
  private readonly cache = new Map<string, { entry: CachedKey | null; until: number }>();
  private readonly usage = new Map<string, UsageCounter>();
  private readonly lastUses = new Map<string, { at: Date; ip: string | null }>();
  private readonly lastUseSaved = new Map<string, number>();
  private readonly dayFormat: Intl.DateTimeFormat;
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.dayFormat = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.get('traffic').timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  /** Saves what is pending while the database connection is still open. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flushing;
    await this.write();
  }

  async authenticate(rawKey: string): Promise<ApiKeyPrincipal> {
    const prefix = apiKeyPrefix(rawKey);
    if (!prefix) throw invalidKey('Malformed API key');
    const entry = await this.lookup(prefix);
    if (!entry || !apiKeyMatches(rawKey, entry.keyHash)) throw invalidKey('Invalid API key');
    if (entry.revoked) throw invalidKey('This API key was revoked');
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      throw invalidKey('This API key has expired');
    }
    if (!entry.integrationActive) throw invalidKey('The integration of this API key is disabled');
    return entry.principal;
  }

  track(principal: ApiKeyPrincipal, ip: string | undefined, response: ResponseLike): void {
    const day = this.dayFormat.format(new Date());
    response.once('finish', () => {
      const id = `${principal.keyId}|${day}`;
      const counter = this.usage.get(id) ?? { keyId: principal.keyId, day, requests: 0, errors: 0 };
      counter.requests += 1;
      if (response.statusCode >= 400) counter.errors += 1;
      this.usage.set(id, counter);
    });
    const now = Date.now();
    if (now - (this.lastUseSaved.get(principal.keyId) ?? 0) >= LAST_USE_INTERVAL_MS) {
      this.lastUseSaved.set(principal.keyId, now);
      this.lastUses.set(principal.keyId, { at: new Date(now), ip: ip ?? null });
    }
  }

  /** Forgets the cached keys of an integration after it or one of its keys changed. */
  invalidateIntegration(integrationId: string): void {
    for (const [prefix, cached] of this.cache) {
      if (cached.entry?.principal.integrationId === integrationId) this.cache.delete(prefix);
    }
  }

  /** Writes the pending usage counters and last-use times (also on shutdown). */
  flush(): Promise<void> {
    this.flushing ??= this.write().finally(() => (this.flushing = undefined));
    return this.flushing;
  }

  private async write(): Promise<void> {
    const counters = [...this.usage.values()];
    const uses = [...this.lastUses.entries()];
    this.usage.clear();
    this.lastUses.clear();
    const statements: Prisma.PrismaPromise<number>[] = [];
    if (counters.length > 0) {
      // Keys deleted in the meantime (their integration was removed) are skipped by the join.
      const rows = counters.map(
        (counter) =>
          Prisma.sql`(${counter.keyId}::uuid, ${counter.day}::date, ${counter.requests}::int, ${counter.errors}::int)`,
      );
      statements.push(this.prisma.$executeRaw`
        INSERT INTO api_usage_daily (api_key_id, day, requests, errors)
        SELECT v.key_id, v.day, v.requests, v.errors
        FROM (VALUES ${Prisma.join(rows)}) AS v (key_id, day, requests, errors)
        JOIN api_keys k ON k.id = v.key_id
        ON CONFLICT (api_key_id, day) DO UPDATE
          SET requests = api_usage_daily.requests + EXCLUDED.requests,
              errors = api_usage_daily.errors + EXCLUDED.errors`);
    }
    if (uses.length > 0) {
      const rows = uses.map(
        ([keyId, use]) => Prisma.sql`(${keyId}::uuid, ${use.at}::timestamptz, ${use.ip}::text)`,
      );
      statements.push(this.prisma.$executeRaw`
        UPDATE api_keys k SET last_used_at = v.at, last_used_ip = v.ip
        FROM (VALUES ${Prisma.join(rows)}) AS v (id, at, ip)
        WHERE k.id = v.id`);
    }
    if (statements.length === 0) return;
    try {
      // One transaction: when it fails nothing was counted, so the counters can be put back.
      await this.prisma.$transaction(statements);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not save API key usage; it will be retried');
      for (const counter of counters) {
        const id = `${counter.keyId}|${counter.day}`;
        const current = this.usage.get(id);
        this.usage.set(
          id,
          current
            ? {
                ...current,
                requests: current.requests + counter.requests,
                errors: current.errors + counter.errors,
              }
            : counter,
        );
      }
    }
  }

  private async lookup(prefix: string): Promise<CachedKey | null> {
    const cached = this.cache.get(prefix);
    if (cached && cached.until > Date.now()) return cached.entry;
    const key = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: {
        integration: {
          select: {
            id: true,
            name: true,
            active: true,
            rateLimitPerMinute: true,
            eventScope: true,
            user: { select: { id: true, email: true } },
          },
        },
      },
    });
    const entry: CachedKey | null = key && {
      keyHash: key.keyHash,
      expiresAt: key.expiresAt?.getTime() ?? null,
      revoked: key.revokedAt !== null,
      integrationActive: key.integration.active,
      principal: {
        keyId: key.id,
        integrationId: key.integration.id,
        integrationName: key.integration.name,
        userId: key.integration.user.id,
        userEmail: key.integration.user.email,
        scopes: key.scopes,
        rateLimitPerMinute: key.integration.rateLimitPerMinute,
        allAccountEvents: key.integration.eventScope === IntegrationEventScope.ALL_ACCOUNTS,
      },
    };
    this.cache.delete(prefix);
    if (this.cache.size >= MAX_CACHED_KEYS) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(prefix, { entry, until: Date.now() + CACHE_TTL_MS });
    return entry;
  }
}
