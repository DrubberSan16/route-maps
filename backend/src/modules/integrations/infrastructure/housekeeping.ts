import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const INTERVAL_MS = 60 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;
/** Rows deleted per statement, so that a large backlog never holds long locks. */
const BATCH = 5_000;
/** Daily API usage kept for the panel's charts. */
const USAGE_RETENTION_DAYS = 400;

/**
 * Hourly clean-up (worker process): platform events older than EVENTS_RETENTION_DAYS, with their
 * webhook deliveries, and API usage older than USAGE_RETENTION_DAYS. The audit log is kept. An
 * event a webhook has yet to receive (retries, paused endpoints) stays until it is delivered or
 * fails for good, whatever the retention.
 */
@Injectable()
export class Housekeeping implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(Housekeeping.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const run = () => {
      this.running = this.runOnce()
        .then((removed) => {
          if (removed.events > 0 || removed.usage > 0) {
            this.logger.log(removed, 'Old events and API usage removed');
          }
        })
        .catch((error: unknown) => this.logger.error({ err: error }, 'Housekeeping failed'));
    };
    this.timer = setTimeout(() => {
      run();
      this.timer = setInterval(run, INTERVAL_MS);
    }, FIRST_RUN_DELAY_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearTimeout(this.timer);
    clearInterval(this.timer);
    await this.running;
  }

  async runOnce(): Promise<{ events: number; usage: number }> {
    const days = this.config.get('integrations').eventsRetentionDays;
    let events = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM platform_events WHERE id IN (
          SELECT e.id FROM platform_events e
          WHERE e.created_at < now() - make_interval(days => ${days}::int)
            AND NOT EXISTS (
              SELECT 1 FROM webhook_deliveries d
              WHERE d.event_id = e.id AND d.status IN ('PENDING', 'SENDING'))
          LIMIT ${BATCH})`;
      events += deleted;
      if (deleted < BATCH) break;
    }
    const usage = await this.prisma.$executeRaw`
      DELETE FROM api_usage_daily WHERE day < current_date - ${USAGE_RETENTION_DAYS}::int`;
    return { events, usage };
  }
}
