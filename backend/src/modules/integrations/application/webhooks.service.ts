import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Paginated } from '../../../common/dto/pagination.dto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppConfigService } from '../../../config/app-config.service';
import { Prisma } from '../../../generated/prisma/client';
import { WebhookDeliveryStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditActor, AuditService } from '../../audit/application/audit.service';
import { toEventView, WEBHOOK_TEST_EVENT } from '../../events/domain/platform-event';
import { generateWebhookSecret } from '../domain/webhook-signature';
import { checkWebhookUrl, WebhookUrlPolicy } from '../domain/webhook-url';
import { SecretBox } from '../infrastructure/secret-box';
import { CreateWebhookDto, ListDeliveriesQueryDto, UpdateWebhookDto } from './dto/integrations.dto';
import { IntegrationsService, toWebhookView, WebhookView } from './integrations.service';

export interface DeliveryView {
  id: string;
  webhookId: string;
  webhookUrl: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface DeliveryDetail extends DeliveryView {
  responseBody: string | null;
  event: ReturnType<typeof toEventView>;
}

const DELIVERY_INCLUDE = {
  endpoint: { select: { url: true } },
  event: true,
} satisfies Prisma.WebhookDeliveryInclude;

type DeliveryRow = Prisma.WebhookDeliveryGetPayload<{ include: typeof DELIVERY_INCLUDE }>;

const toDeliveryView = (row: DeliveryRow): DeliveryView => ({
  id: row.id,
  webhookId: row.endpointId,
  webhookUrl: row.endpoint.url,
  eventId: row.eventId,
  eventType: row.event.type,
  status: row.status,
  attempts: row.attempts,
  nextAttemptAt: row.nextAttemptAt,
  lastAttemptAt: row.lastAttemptAt,
  responseStatus: row.responseStatus,
  error: row.error,
  durationMs: row.durationMs,
  createdAt: row.createdAt,
});

/**
 * Webhook endpoints of the integrations (administration). The deliveries themselves are made by
 * the worker process (`dist/src/worker.js`), the only one with access to other servers.
 */
@Injectable()
export class WebhooksService {
  private readonly policy: WebhookUrlPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
    private readonly secrets: SecretBox,
    config: AppConfigService,
  ) {
    this.policy = config.get('integrations').webhooks;
  }

  /** Creates the endpoint. Its signing secret is returned here only once. */
  async create(
    actor: AuditActor,
    integrationId: string,
    dto: CreateWebhookDto,
  ): Promise<{ webhook: WebhookView; secret: string }> {
    const integration = await this.integrations.require(integrationId);
    const url = this.checkUrl(dto.url);
    const secret = generateWebhookSecret();
    const webhook = await this.prisma.webhookEndpoint.create({
      data: {
        integrationId,
        url,
        description: dto.description,
        events: dto.events,
        secret: this.secrets.seal(secret),
      },
    });
    await this.audit.record(actor, {
      action: 'integration.webhook.create',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { webhookId: webhook.id, url, events: dto.events },
    });
    return { webhook: toWebhookView(webhook), secret };
  }

  async update(
    actor: AuditActor,
    integrationId: string,
    webhookId: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookView> {
    const { integration } = await this.require(integrationId, webhookId);
    const url = dto.url === undefined ? undefined : this.checkUrl(dto.url);
    const webhook = await this.prisma.webhookEndpoint.update({
      where: { id: webhookId },
      data: {
        url,
        description: dto.description,
        events: dto.events,
        active: dto.active,
        // A re-enabled endpoint starts over.
        ...(dto.active === true ? { consecutiveFailures: 0 } : {}),
      },
    });
    await this.audit.record(actor, {
      action: 'integration.webhook.update',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { webhookId, ...dto, ...(url ? { url } : {}) },
    });
    return toWebhookView(webhook);
  }

  async delete(
    actor: AuditActor,
    integrationId: string,
    webhookId: string,
  ): Promise<{ deleted: true }> {
    const { integration, webhook } = await this.require(integrationId, webhookId);
    await this.prisma.webhookEndpoint.delete({ where: { id: webhookId } });
    await this.audit.record(actor, {
      action: 'integration.webhook.delete',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { webhookId, url: webhook.url },
    });
    return { deleted: true };
  }

  /** Replaces the signing secret; the new one is returned only once. */
  async rotateSecret(
    actor: AuditActor,
    integrationId: string,
    webhookId: string,
  ): Promise<{ webhook: WebhookView; secret: string }> {
    const { integration } = await this.require(integrationId, webhookId);
    const secret = generateWebhookSecret();
    const webhook = await this.prisma.webhookEndpoint.update({
      where: { id: webhookId },
      data: { secret: this.secrets.seal(secret) },
    });
    await this.audit.record(actor, {
      action: 'integration.webhook.rotate_secret',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { webhookId },
    });
    return { webhook: toWebhookView(webhook), secret };
  }

  /**
   * Queues a `webhook.test` event for this endpoint only (one attempt, even when it fails), so the
   * receiver can check the signature. The worker sends it within a few seconds.
   */
  async test(
    actor: AuditActor,
    integrationId: string,
    webhookId: string,
  ): Promise<{ deliveryId: string }> {
    const { integration, webhook } = await this.require(integrationId, webhookId);
    const deliveryId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const event = await tx.platformEvent.create({
        data: {
          type: WEBHOOK_TEST_EVENT,
          accountId: integration.userId,
          data: {
            integration: { id: integration.id, name: integration.name },
            webhook: { id: webhook.id, url: webhook.url },
            message: 'Test event sent from the Route Maps administration panel',
          },
        },
      });
      await tx.webhookDelivery.create({
        data: { id: deliveryId, eventId: event.id, endpointId: webhookId },
      });
    });
    await this.audit.record(actor, {
      action: 'integration.webhook.test',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { webhookId, deliveryId },
    });
    return { deliveryId };
  }

  async deliveries(
    integrationId: string,
    query: ListDeliveriesQueryDto,
  ): Promise<Paginated<DeliveryView>> {
    await this.integrations.require(integrationId);
    const where: Prisma.WebhookDeliveryWhereInput = {
      endpoint: { integrationId },
      ...(query.webhookId ? { endpointId: query.webhookId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        include: DELIVERY_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return { items: rows.map(toDeliveryView), total, limit: query.limit, offset: query.offset };
  }

  async delivery(integrationId: string, deliveryId: string): Promise<DeliveryDetail> {
    const row = await this.findDelivery(integrationId, deliveryId);
    return {
      ...toDeliveryView(row),
      responseBody: row.responseBody,
      event: toEventView(row.event),
    };
  }

  /** Sends a delivery again as soon as possible (a failed one, or one already delivered). */
  async retry(actor: AuditActor, integrationId: string, deliveryId: string): Promise<DeliveryView> {
    const row = await this.findDelivery(integrationId, deliveryId);
    if (row.status === WebhookDeliveryStatus.SENDING) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'This delivery is being sent right now',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: new Date(), lockedAt: null },
      include: DELIVERY_INCLUDE,
    });
    const integration = await this.integrations.require(integrationId);
    await this.audit.record(actor, {
      action: 'integration.delivery.retry',
      targetType: 'integration',
      targetId: integrationId,
      summary: integration.name,
      details: { deliveryId, eventType: row.event.type },
    });
    return toDeliveryView(updated);
  }

  private async findDelivery(integrationId: string, deliveryId: string): Promise<DeliveryRow> {
    const row = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, endpoint: { integrationId } },
      include: DELIVERY_INCLUDE,
    });
    if (!row) {
      throw AppException.notFound(ErrorCode.WEBHOOK_DELIVERY_NOT_FOUND, 'Delivery not found');
    }
    return row;
  }

  private async require(integrationId: string, webhookId: string) {
    const integration = await this.integrations.require(integrationId);
    const webhook = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, integrationId },
    });
    if (!webhook) throw AppException.notFound(ErrorCode.WEBHOOK_NOT_FOUND, 'Webhook not found');
    return { integration, webhook };
  }

  private checkUrl(raw: string): string {
    const checked = checkWebhookUrl(raw.trim(), this.policy);
    if (checked.error !== undefined) {
      throw new AppException(ErrorCode.INVALID_WEBHOOK_URL, checked.error);
    }
    return checked.url.toString();
  }
}
