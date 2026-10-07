import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { ACCOUNT_ACCESS, type AccountAccessReader } from '../../../common/auth/auth-ports';
import { Paginated } from '../../../common/dto/pagination.dto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppConfigService } from '../../../config/app-config.service';
import { Prisma } from '../../../generated/prisma/client';
import { IntegrationEventScope, UserRole } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditActor, AuditService } from '../../audit/application/audit.service';
import { PASSWORD_HASHER, type PasswordHasher } from '../../auth/domain/password-hasher';
import { generateApiKey } from '../domain/api-key';
import { ApiKeyAuthenticatorService } from './api-key-authenticator.service';
import {
  CreateApiKeyDto,
  CreateIntegrationDto,
  ListIntegrationsQueryDto,
  UpdateIntegrationDto,
} from './dto/integrations.dto';

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  lastFour: string;
  scopes: string[];
  status: ApiKeyStatus;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdAt: Date;
}

export interface WebhookView {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationAccount {
  id: string;
  email: string;
  name: string;
  serviceAccount: boolean;
  active: boolean;
}

export interface IntegrationSummary {
  id: string;
  name: string;
  description: string | null;
  contactEmail: string | null;
  active: boolean;
  rateLimitPerMinute: number;
  eventScope: IntegrationEventScope;
  account: IntegrationAccount;
  activeKeys: number;
  webhookCount: number;
  requestsToday: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationDetail extends IntegrationSummary {
  keys: ApiKeyView[];
  webhooks: WebhookView[];
}

export interface UsageDay {
  day: string;
  requests: number;
  errors: number;
}

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  name: true,
  serviceAccount: true,
  active: true,
} satisfies Prisma.UserSelect;

/** Domain of the accounts created for integrations (reserved TLD, never a real mailbox). */
const SERVICE_ACCOUNT_DOMAIN = 'integrations.invalid';

export const toApiKeyView = (key: {
  id: string;
  name: string;
  prefix: string;
  lastFour: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdAt: Date;
}): ApiKeyView => ({
  id: key.id,
  name: key.name,
  prefix: key.prefix,
  lastFour: key.lastFour,
  scopes: key.scopes,
  status: key.revokedAt
    ? 'REVOKED'
    : key.expiresAt && key.expiresAt.getTime() <= Date.now()
      ? 'EXPIRED'
      : 'ACTIVE',
  expiresAt: key.expiresAt,
  revokedAt: key.revokedAt,
  lastUsedAt: key.lastUsedAt,
  lastUsedIp: key.lastUsedIp,
  createdAt: key.createdAt,
});

export const toWebhookView = (webhook: {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WebhookView => ({
  id: webhook.id,
  url: webhook.url,
  description: webhook.description,
  events: webhook.events,
  active: webhook.active,
  consecutiveFailures: webhook.consecutiveFailures,
  lastSuccessAt: webhook.lastSuccessAt,
  lastFailureAt: webhook.lastFailureAt,
  createdAt: webhook.createdAt,
  updatedAt: webhook.updatedAt,
});

/**
 * External applications connected to the platform (administration): each one acts as an account
 * through its API keys and receives that account's events through its webhooks.
 */
@Injectable()
export class IntegrationsService {
  private readonly dayFormat: Intl.DateTimeFormat;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authenticator: ApiKeyAuthenticatorService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ACCOUNT_ACCESS) private readonly accounts: AccountAccessReader,
    config: AppConfigService,
  ) {
    this.dayFormat = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.get('traffic').timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  async list(query: ListIntegrationsQueryDto): Promise<Paginated<IntegrationSummary>> {
    const where: Prisma.IntegrationWhereInput = {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { user: { email: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.integration.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
        include: {
          user: { select: ACCOUNT_SELECT },
          _count: { select: { webhooks: true } },
        },
      }),
      this.prisma.integration.count({ where }),
    ]);
    const ids = rows.map((row) => row.id);
    const [activeKeys, requestsToday] = await Promise.all([
      this.activeKeyCounts(ids),
      this.requestsToday(ids),
    ]);
    return {
      items: rows.map(({ user, _count, ...integration }) => ({
        ...integration,
        account: user,
        activeKeys: activeKeys.get(integration.id) ?? 0,
        webhookCount: _count.webhooks,
        requestsToday: requestsToday.get(integration.id) ?? 0,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<IntegrationDetail> {
    const integration = await this.prisma.integration.findUnique({
      where: { id },
      include: {
        user: { select: ACCOUNT_SELECT },
        apiKeys: { orderBy: { createdAt: 'desc' } },
        webhooks: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!integration) throw this.notFound();
    const { user, apiKeys, webhooks, ...rest } = integration;
    const keys = apiKeys.map(toApiKeyView);
    const requestsToday = await this.requestsToday([id]);
    return {
      ...rest,
      account: user,
      activeKeys: keys.filter((key) => key.status === 'ACTIVE').length,
      webhookCount: webhooks.length,
      requestsToday: requestsToday.get(id) ?? 0,
      keys,
      webhooks: webhooks.map(toWebhookView),
    };
  }

  /**
   * Creates the integration. Without `accountId` it gets its own service account, which cannot
   * log in and holds the trips, geofences, places and routes the integration creates.
   */
  async create(actor: AuditActor, dto: CreateIntegrationDto): Promise<IntegrationDetail> {
    if (dto.accountId) {
      const account = await this.prisma.user.findUnique({ where: { id: dto.accountId } });
      if (!account) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'Account not found');
    }
    const passwordHash = dto.accountId ? null : await this.hasher.hash(randomUUID());
    const integration = await this.prisma.$transaction(async (tx) => {
      const userId =
        dto.accountId ??
        (
          await tx.user.create({
            data: {
              email: `svc-${randomBytes(6).toString('hex')}@${SERVICE_ACCOUNT_DOMAIN}`,
              name: dto.name,
              passwordHash: passwordHash!,
              role: UserRole.USER,
              serviceAccount: true,
            },
          })
        ).id;
      return tx.integration.create({
        data: {
          name: dto.name,
          description: dto.description,
          contactEmail: dto.contactEmail,
          rateLimitPerMinute: dto.rateLimitPerMinute,
          eventScope: dto.eventScope,
          userId,
        },
      });
    });
    await this.audit.record(actor, {
      action: 'integration.create',
      targetType: 'integration',
      targetId: integration.id,
      summary: integration.name,
      details: {
        accountId: integration.userId,
        newServiceAccount: !dto.accountId,
        eventScope: integration.eventScope,
      },
    });
    return this.get(integration.id);
  }

  async update(
    actor: AuditActor,
    id: string,
    dto: UpdateIntegrationDto,
  ): Promise<IntegrationDetail> {
    await this.require(id);
    const integration = await this.prisma.integration.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        contactEmail: dto.contactEmail,
        active: dto.active,
        rateLimitPerMinute: dto.rateLimitPerMinute,
        eventScope: dto.eventScope,
      },
    });
    this.authenticator.invalidateIntegration(id);
    await this.audit.record(actor, {
      action:
        dto.active === false
          ? 'integration.disable'
          : dto.active === true
            ? 'integration.enable'
            : 'integration.update',
      targetType: 'integration',
      targetId: id,
      summary: integration.name,
      details: { ...dto },
    });
    return this.get(id);
  }

  /** Removes the integration with its keys and webhooks; its account and data stay. */
  async delete(actor: AuditActor, id: string): Promise<{ deleted: true }> {
    const integration = await this.require(id);
    await this.prisma.integration.delete({ where: { id } });
    this.authenticator.invalidateIntegration(id);
    this.accounts.invalidate(integration.userId);
    await this.audit.record(actor, {
      action: 'integration.delete',
      targetType: 'integration',
      targetId: id,
      summary: integration.name,
    });
    return { deleted: true };
  }

  /** Creates a key. The secret is returned here only once; only its SHA-256 is stored. */
  async createKey(
    actor: AuditActor,
    integrationId: string,
    dto: CreateApiKeyDto,
  ): Promise<{ key: string; apiKey: ApiKeyView }> {
    const integration = await this.require(integrationId);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'expiresAt must be in the future');
    }
    const generated = generateApiKey();
    const apiKey = await this.prisma.apiKey.create({
      data: {
        integrationId,
        name: dto.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        lastFour: generated.lastFour,
        scopes: dto.scopes,
        expiresAt,
      },
    });
    await this.audit.record(actor, {
      action: 'integration.key.create',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { keyId: apiKey.id, name: apiKey.name, prefix: apiKey.prefix, scopes: dto.scopes },
    });
    return { key: generated.key, apiKey: toApiKeyView(apiKey) };
  }

  async revokeKey(actor: AuditActor, integrationId: string, keyId: string): Promise<ApiKeyView> {
    const integration = await this.require(integrationId);
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, integrationId } });
    if (!key) throw AppException.notFound(ErrorCode.API_KEY_NOT_FOUND, 'API key not found');
    const revoked = key.revokedAt
      ? key
      : await this.prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    this.authenticator.invalidateIntegration(integrationId);
    if (!key.revokedAt) {
      await this.audit.record(actor, {
        action: 'integration.key.revoke',
        targetType: 'integration',
        targetId: integrationId,
        summary: integration.name,
        details: { keyId, name: key.name, prefix: key.prefix },
      });
    }
    return toApiKeyView(revoked);
  }

  /** Requests per day of the last `days` days (platform time zone), all keys together. */
  async usage(integrationId: string, days: number): Promise<{ days: UsageDay[] }> {
    await this.require(integrationId);
    const today = this.dayFormat.format(new Date());
    const rows = await this.prisma.$queryRaw<{ day: Date; requests: bigint; errors: bigint }[]>`
      SELECT u.day, sum(u.requests)::bigint AS requests, sum(u.errors)::bigint AS errors
      FROM api_usage_daily u JOIN api_keys k ON k.id = u.api_key_id
      WHERE k.integration_id = ${integrationId}::uuid
        AND u.day > ${today}::date - ${days}::int
      GROUP BY u.day`;
    const byDay = new Map(rows.map((row) => [row.day.toISOString().slice(0, 10), row] as const));
    const result: UsageDay[] = [];
    const end = Date.parse(`${today}T00:00:00Z`);
    for (let index = days - 1; index >= 0; index--) {
      const day = new Date(end - index * 86_400_000).toISOString().slice(0, 10);
      const row = byDay.get(day);
      result.push({ day, requests: Number(row?.requests ?? 0), errors: Number(row?.errors ?? 0) });
    }
    return { days: result };
  }

  /** The integration, or INTEGRATION_NOT_FOUND. */
  async require(id: string) {
    const integration = await this.prisma.integration.findUnique({ where: { id } });
    if (!integration) throw this.notFound();
    return integration;
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.INTEGRATION_NOT_FOUND,
      'Integration not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private async activeKeyCounts(integrationIds: string[]): Promise<Map<string, number>> {
    if (integrationIds.length === 0) return new Map();
    const groups = await this.prisma.apiKey.groupBy({
      by: ['integrationId'],
      where: {
        integrationId: { in: integrationIds },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.integrationId, group._count._all]));
  }

  private async requestsToday(integrationIds: string[]): Promise<Map<string, number>> {
    if (integrationIds.length === 0) return new Map();
    const today = this.dayFormat.format(new Date());
    const rows = await this.prisma.$queryRaw<{ integration_id: string; requests: bigint }[]>`
      SELECT k.integration_id, sum(u.requests)::bigint AS requests
      FROM api_usage_daily u JOIN api_keys k ON k.id = u.api_key_id
      WHERE u.day = ${today}::date
        AND k.integration_id IN (${Prisma.join(integrationIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY k.integration_id`;
    return new Map(rows.map((row) => [row.integration_id, Number(row.requests)]));
  }
}
