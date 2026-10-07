import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { Prisma } from '../../../generated/prisma/client';
import { WebhookDeliveryStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { toEventView, WEBHOOK_TEST_EVENT } from '../../events/domain/platform-event';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from '../domain/webhook-retries';
import { SIGNATURE_HEADER, signatureHeader } from '../domain/webhook-signature';
import { SecretBox } from './secret-box';
import { WebhookResponse, WebhookSender } from './webhook-sender';

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 20;
/** Touched on every cycle; the container healthcheck reads its age. */
export const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/route-maps-worker.heartbeat';
const USER_AGENT = 'RouteMaps-Webhooks/1.0';

const DELIVERY_INCLUDE = {
  event: true,
  endpoint: true,
} satisfies Prisma.WebhookDeliveryInclude;

type ClaimedDelivery = Prisma.WebhookDeliveryGetPayload<{ include: typeof DELIVERY_INCLUDE }>;

/** Next state of a delivery after an attempt. */
export function nextState(
  attempts: number,
  response: WebhookResponse,
  options: { singleAttempt: boolean; now: number },
): { status: WebhookDeliveryStatus; nextAttemptAt: Date } {
  const delivered =
    response.status !== undefined && response.status >= 200 && response.status < 300;
  if (delivered) {
    return { status: WebhookDeliveryStatus.SUCCEEDED, nextAttemptAt: new Date(options.now) };
  }
  if (options.singleAttempt || attempts >= MAX_ATTEMPTS) {
    return { status: WebhookDeliveryStatus.FAILED, nextAttemptAt: new Date(options.now) };
  }
  return {
    status: WebhookDeliveryStatus.PENDING,
    nextAttemptAt: new Date(options.now + RETRY_DELAYS_MS[attempts - 1]),
  };
}

/**
 * Sends the queued webhook deliveries (worker process). Each request is a POST of the event as
 * JSON, signed with the endpoint's secret (`X-RouteMaps-Signature: t=..,v1=..`); any 2xx answer
 * counts as delivered, anything else is retried with growing waits (RETRY_DELAYS_MS). Deliveries
 * of disabled endpoints, integrations or accounts wait until they are enabled again. Several
 * workers can run at once: each delivery is claimed by one of them.
 */
@Injectable()
export class WebhookDispatcher implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private timer?: NodeJS.Timeout;
  private cycle?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WebhookSender,
    private readonly secrets: SecretBox,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log('Webhook deliveries started');
    this.schedule(0);
  }

  /** Lets the deliveries being sent finish while the database connection is still open. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.cycle;
  }

  /** One cycle: claims the deliveries that are due and sends them. Returns how many it sent. */
  async runOnce(): Promise<number> {
    const claimed = await this.claim();
    await Promise.all(
      claimed.map((delivery) =>
        this.deliver(delivery).catch((error: unknown) =>
          // Left SENDING: taken over again once its lock is old.
          this.logger.error({ err: error, deliveryId: delivery.id }, 'Could not record a delivery'),
        ),
      ),
    );
    return claimed.length;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.cycle = this.runOnce()
        .then((sent) => {
          void writeFile(HEARTBEAT_FILE, `${Date.now()}\n`).catch(() => undefined);
          // A full batch means more may be waiting: no pause.
          this.schedule(sent === BATCH_SIZE ? 0 : POLL_INTERVAL_MS);
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, 'Webhook delivery cycle failed');
          this.schedule(POLL_INTERVAL_MS * 5);
        });
    }, delayMs);
  }

  private async claim(): Promise<ClaimedDelivery[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE webhook_deliveries SET status = 'SENDING', locked_at = now(), updated_at = now()
      WHERE id IN (
        SELECT d.id FROM webhook_deliveries d
        JOIN webhook_endpoints w ON w.id = d.endpoint_id AND w.active
        JOIN integrations i ON i.id = w.integration_id AND i.active
        JOIN users u ON u.id = i.user_id AND u.active
        WHERE (d.status = 'PENDING' AND d.next_attempt_at <= now())
           -- Still sending after 5 minutes: its worker stopped, the delivery is taken over.
           OR (d.status = 'SENDING' AND d.locked_at < now() - interval '5 minutes')
        ORDER BY d.next_attempt_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF d SKIP LOCKED)
      RETURNING id`;
    if (rows.length === 0) return [];
    return this.prisma.webhookDelivery.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: DELIVERY_INCLUDE,
    });
  }

  private async deliver(delivery: ClaimedDelivery): Promise<void> {
    const attempts = delivery.attempts + 1;
    const body = JSON.stringify(toEventView(delivery.event));
    let response: WebhookResponse;
    try {
      const secret = this.secrets.open(delivery.endpoint.secret);
      const timestamp = Math.floor(Date.now() / 1000);
      response = await this.sender.send({
        url: delivery.endpoint.url,
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
          'x-routemaps-event': delivery.event.type,
          'x-routemaps-event-id': delivery.event.id,
          'x-routemaps-delivery': delivery.id,
          [SIGNATURE_HEADER]: signatureHeader(secret, timestamp, body),
        },
      });
    } catch (error) {
      response = {
        error:
          'The signing secret cannot be read (INTEGRATIONS_SECRET_KEY changed?): rotate it. ' +
          (error instanceof Error ? error.message : String(error)),
        durationMs: 0,
      };
    }

    const now = Date.now();
    const next = nextState(attempts, response, {
      singleAttempt: delivery.event.type === WEBHOOK_TEST_EVENT,
      now,
    });
    const succeeded = next.status === WebhookDeliveryStatus.SUCCEEDED;
    // updateMany: the endpoint may have been deleted (with its deliveries) in the meantime.
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.updateMany({
        where: { id: delivery.id, status: WebhookDeliveryStatus.SENDING },
        data: {
          status: next.status,
          attempts,
          nextAttemptAt: next.nextAttemptAt,
          lockedAt: null,
          lastAttemptAt: new Date(now),
          responseStatus: response.status ?? null,
          responseBody: response.body ?? null,
          error: succeeded ? null : (response.error ?? `HTTP ${response.status}`),
          durationMs: response.durationMs,
        },
      }),
      this.prisma.webhookEndpoint.updateMany({
        where: { id: delivery.endpointId },
        data: succeeded
          ? { consecutiveFailures: 0, lastSuccessAt: new Date(now) }
          : { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date(now) },
      }),
    ]);
    if (!succeeded) {
      this.logger.warn(
        {
          deliveryId: delivery.id,
          endpointId: delivery.endpointId,
          attempts,
          status: response.status,
          error: response.error,
        },
        next.status === WebhookDeliveryStatus.FAILED
          ? 'Webhook delivery failed for good'
          : 'Webhook delivery failed; will retry',
      );
    }
  }
}
