import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Paginated } from '../../../common/dto/pagination.dto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { Prisma } from '../../../generated/prisma/client';
import { WebhookDeliveryStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ALL_EVENTS,
  EVENT_ACCOUNT_SELECT,
  PLATFORM_EVENT_TYPES,
  PlatformEventInput,
  PlatformEventView,
  toEventView,
} from '../domain/platform-event';

/** The transaction of the change an event describes. */
export type EventsSqlClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Advisory lock every transaction that adds events holds from the insert until it ends, so that
 * events become visible in the order of their `seq`. Without it a change that took a lower `seq`
 * but was saved later would be skipped by a `GET /events` reader already past it.
 */
const EVENT_ORDER_LOCK = 0x524d4556; // "RMEV"

export interface EventFeed {
  items: PlatformEventView[];
  /** Cursor for the next request (`after`): the last event returned, or the one received. */
  next: string;
  hasMore: boolean;
}

export type DeliveryCounts = Record<WebhookDeliveryStatus, number>;

export interface AdminEventView extends PlatformEventView {
  deliveries: DeliveryCounts;
}

export interface EventDeliveryView {
  id: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  responseStatus: number | null;
  error: string | null;
  webhook: { id: string; url: string };
  integration: { id: string; name: string };
}

export interface AdminEventDetail extends Omit<AdminEventView, 'deliveries'> {
  deliveries: EventDeliveryView[];
}

const emptyCounts = (): DeliveryCounts => ({ PENDING: 0, SENDING: 0, SUCCEEDED: 0, FAILED: 0 });

/**
 * Platform events: stored for `GET /events`, the administration panel and the webhooks of the
 * integrations, which the worker process delivers (the API itself never calls other servers).
 */
@Injectable()
export class PlatformEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores the event and, in the same statement, queues one delivery for every active webhook
   * subscribed to it: those of the account's integrations and of the integrations that receive
   * every account's events, or of every integration for platform events. Pass the transaction of
   * the change it describes so that both are kept or neither; without one the event gets its own.
   * Emit at the end of that transaction: the events of other changes wait until it ends.
   */
  async emit(event: PlatformEventInput, tx?: EventsSqlClient): Promise<string> {
    if (!tx) return this.prisma.$transaction((own) => this.emit(event, own));
    const id = randomUUID();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EVENT_ORDER_LOCK}::bigint)`;
    await tx.$executeRaw`
      WITH event AS (
        INSERT INTO platform_events (id, type, account_id, data)
        VALUES (${id}::uuid, ${event.type}, ${event.accountId}::uuid,
                ${JSON.stringify(event.data)}::jsonb)
        RETURNING id, type, account_id
      )
      INSERT INTO webhook_deliveries (id, event_id, endpoint_id, updated_at)
      SELECT gen_random_uuid(), event.id, w.id, now()
      FROM event
      JOIN webhook_endpoints w
        ON w.active AND (event.type = ANY (w.events) OR ${ALL_EVENTS} = ANY (w.events))
      JOIN integrations i ON i.id = w.integration_id AND i.active
      JOIN users u ON u.id = i.user_id AND u.active
      WHERE event.account_id IS NULL OR event.account_id = i.user_id
         OR i.event_scope = 'ALL_ACCOUNTS'`;
    return id;
  }

  /**
   * Events of an account and of the platform after a position, oldest first (`GET /events`).
   * `accountId` null: the events of every account (integrations with that event scope).
   */
  async feed(
    accountId: string | null,
    options: { after: bigint; limit: number; types?: string[] },
  ): Promise<EventFeed> {
    const rows = await this.prisma.platformEvent.findMany({
      where: {
        seq: { gt: options.after },
        ...(accountId === null ? {} : { OR: [{ accountId }, { accountId: null }] }),
        // Webhook tests are not part of the feed.
        type: { in: options.types?.length ? options.types : [...PLATFORM_EVENT_TYPES] },
      },
      include: { account: { select: EVENT_ACCOUNT_SELECT } },
      orderBy: { seq: 'asc' },
      take: options.limit + 1,
    });
    const items = rows.slice(0, options.limit).map(toEventView);
    return {
      items,
      next: items.at(-1)?.seq ?? options.after.toString(),
      hasMore: rows.length > options.limit,
    };
  }

  /** Every event, newest first, with how its webhook deliveries went (administration). */
  async list(query: {
    type?: string;
    accountId?: string;
    limit: number;
    offset: number;
  }): Promise<Paginated<AdminEventView>> {
    const where: Prisma.PlatformEventWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.platformEvent.findMany({
        where,
        orderBy: { seq: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: { account: { select: EVENT_ACCOUNT_SELECT } },
      }),
      this.prisma.platformEvent.count({ where }),
    ]);
    const counts = await this.deliveryCounts(rows.map((row) => row.id));
    return {
      items: rows.map((row) => ({
        ...toEventView(row),
        deliveries: counts.get(row.id) ?? emptyCounts(),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** One event with each webhook delivery it produced (administration). */
  async detail(id: string): Promise<AdminEventDetail> {
    const row = await this.prisma.platformEvent.findUnique({
      where: { id },
      include: {
        account: { select: EVENT_ACCOUNT_SELECT },
        deliveries: {
          orderBy: { createdAt: 'asc' },
          include: {
            endpoint: {
              select: { id: true, url: true, integration: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (!row) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Event not found');
    const { deliveries, ...event } = row;
    return {
      ...toEventView(event),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        status: delivery.status,
        attempts: delivery.attempts,
        nextAttemptAt: delivery.nextAttemptAt,
        lastAttemptAt: delivery.lastAttemptAt,
        responseStatus: delivery.responseStatus,
        error: delivery.error,
        webhook: { id: delivery.endpoint.id, url: delivery.endpoint.url },
        integration: delivery.endpoint.integration,
      })),
    };
  }

  private async deliveryCounts(eventIds: string[]): Promise<Map<string, DeliveryCounts>> {
    const counts = new Map<string, DeliveryCounts>();
    if (eventIds.length === 0) return counts;
    const groups = await this.prisma.webhookDelivery.groupBy({
      by: ['eventId', 'status'],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    });
    for (const group of groups) {
      const entry = counts.get(group.eventId) ?? emptyCounts();
      entry[group.status] = group._count._all;
      counts.set(group.eventId, entry);
    }
    return counts;
  }
}
