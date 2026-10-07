import { Injectable } from '@nestjs/common';
import { API_SCOPES } from '../../../common/auth/api-scopes';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { AppConfigService } from '../../../config/app-config.service';
import {
  DevicePlatform,
  RoutingProfile,
  SyncEventStatus,
  TripStatus,
  UserRole,
  WebhookDeliveryStatus,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PLATFORM_EVENT_TYPES, WEBHOOK_TEST_EVENT } from '../../events/domain/platform-event';
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  MAX_RATE_LIMIT_PER_MINUTE,
} from '../../integrations/application/dto/integrations.dto';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from '../../integrations/domain/webhook-retries';
import { UsersService } from '../../users/application/users.service';

/** Days of the activity series of the overview (today included). */
export const OVERVIEW_DAYS = 14;

export interface OverviewDay {
  /** YYYY-MM-DD in the platform time zone. */
  day: string;
  tripsStarted: number;
  /** Distance of the trips completed that day. */
  distanceMeters: number;
  apiRequests: number;
  apiErrors: number;
  events: number;
}

export interface AdminOverview {
  generatedAt: Date;
  timeZone: string;
  accounts: {
    people: number;
    active: number;
    administrators: number;
    operators: number;
    serviceAccounts: number;
    newLast7Days: number;
    signedInLast24h: number;
  };
  devices: { total: number; seenLast24h: number };
  trips: {
    active: number;
    startedToday: number;
    completedToday: number;
    distanceTodayMeters: number;
  };
  tracking: { fixesLastHour: number; lastFixAt: Date | null };
  geodata: {
    geofences: number;
    activeGeofences: number;
    sharedPlaces: number;
    privatePlaces: number;
    savedRoutes: number;
  };
  regions: { total: number; enabled: number; devicesWithRegions: number };
  integrations: { total: number; active: number; requestsToday: number; errorsToday: number };
  webhooks: {
    endpoints: number;
    active: number;
    /** Active endpoints whose last attempts failed. */
    failing: number;
    pending: number;
    failedLast24h: number;
    oldestPendingAt: Date | null;
  };
  sync: { operationsLast24h: number; failedLast24h: number };
  series: OverviewDay[];
}

export interface AdminMeta {
  user: { id: string; email: string; name: string; role: UserRole };
  version: string;
  timeZone: string;
  roles: UserRole[];
  scopes: readonly string[];
  eventTypes: readonly string[];
  testEventType: string;
  tripStatuses: TripStatus[];
  routingProfiles: RoutingProfile[];
  devicePlatforms: DevicePlatform[];
  syncStatuses: SyncEventStatus[];
  deliveryStatuses: WebhookDeliveryStatus[];
  integrations: { defaultRateLimitPerMinute: number; maxRateLimitPerMinute: number };
  webhooks: {
    allowInsecure: boolean;
    allowPrivateNetworks: boolean;
    timeoutMs: number;
    maxAttempts: number;
    retryDelaysMs: number[];
  };
  eventsRetentionDays: number;
}

type Count = bigint | number | null;
const num = (value: Count): number => Number(value ?? 0);

/** What the administration panel shows first, and the catalogues its forms use. */
@Injectable()
export class AdminOverviewService {
  private readonly timeZone: string;
  private readonly dayFormat: Intl.DateTimeFormat;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: AppConfigService,
  ) {
    this.timeZone = config.get('traffic').timeZone;
    this.dayFormat = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  async overview(): Promise<AdminOverview> {
    const now = new Date();
    const days = this.lastDays(now, OVERVIEW_DAYS);
    const tz = this.timeZone;
    const firstDay = days[0];
    const today = days[days.length - 1];

    const [totals, trips, distances, usage, events] = await Promise.all([
      this.prisma.$queryRaw<Record<string, Count | Date>[]>`
        WITH bounds AS (SELECT (${today}::date)::timestamp AT TIME ZONE ${tz} AS today)
        SELECT
          (SELECT count(*) FROM users WHERE NOT service_account) AS people,
          (SELECT count(*) FROM users WHERE NOT service_account AND active) AS people_active,
          (SELECT count(*) FROM users WHERE role = 'ADMIN' AND active) AS administrators,
          (SELECT count(*) FROM users WHERE role = 'OPERATOR' AND active) AS operators,
          (SELECT count(*) FROM users WHERE service_account) AS service_accounts,
          (SELECT count(*) FROM users
            WHERE NOT service_account AND created_at >= now() - interval '7 days') AS new_users,
          (SELECT count(*) FROM users
            WHERE last_login_at >= now() - interval '24 hours') AS signed_in,
          (SELECT count(*) FROM devices) AS devices,
          (SELECT count(*) FROM devices
            WHERE last_seen_at >= now() - interval '24 hours') AS devices_seen,
          (SELECT count(*) FROM trips WHERE status = 'ACTIVE') AS trips_active,
          (SELECT count(*) FROM trips, bounds WHERE started_at >= bounds.today) AS trips_started,
          (SELECT count(*) FROM trips, bounds
            WHERE status = 'COMPLETED' AND ended_at >= bounds.today) AS trips_completed,
          (SELECT COALESCE(sum(distance_meters), 0) FROM trips, bounds
            WHERE status = 'COMPLETED' AND ended_at >= bounds.today) AS distance_today,
          (SELECT count(*) FROM trip_points
            WHERE recorded_at >= now() - interval '1 hour') AS fixes_last_hour,
          (SELECT max(recorded_at) FROM trip_points) AS last_fix_at,
          (SELECT count(*) FROM geofences) AS geofences,
          (SELECT count(*) FROM geofences WHERE active) AS geofences_active,
          (SELECT count(*) FROM places WHERE user_id IS NULL) AS places_shared,
          (SELECT count(*) FROM places WHERE user_id IS NOT NULL) AS places_private,
          (SELECT count(*) FROM routes) AS routes,
          (SELECT count(*) FROM map_regions) AS regions,
          (SELECT count(*) FROM map_regions WHERE enabled) AS regions_enabled,
          (SELECT count(DISTINCT device_id) FROM downloaded_regions
            WHERE status = 'DOWNLOADED') AS devices_with_regions,
          (SELECT count(*) FROM integrations) AS integrations,
          (SELECT count(*) FROM integrations WHERE active) AS integrations_active,
          (SELECT COALESCE(sum(requests), 0) FROM api_usage_daily
            WHERE day = ${today}::date) AS requests_today,
          (SELECT COALESCE(sum(errors), 0) FROM api_usage_daily
            WHERE day = ${today}::date) AS errors_today,
          (SELECT count(*) FROM webhook_endpoints) AS endpoints,
          (SELECT count(*) FROM webhook_endpoints WHERE active) AS endpoints_active,
          (SELECT count(*) FROM webhook_endpoints
            WHERE active AND consecutive_failures > 0) AS endpoints_failing,
          (SELECT count(*) FROM webhook_deliveries
            WHERE status IN ('PENDING', 'SENDING')) AS deliveries_pending,
          (SELECT count(*) FROM webhook_deliveries
            WHERE status = 'FAILED' AND updated_at >= now() - interval '24 hours')
            AS deliveries_failed,
          (SELECT min(next_attempt_at) FROM webhook_deliveries
            WHERE status = 'PENDING') AS oldest_pending_at,
          (SELECT count(*) FROM synchronization_events
            WHERE processed_at >= now() - interval '24 hours') AS sync_operations,
          (SELECT count(*) FROM synchronization_events
            WHERE status = 'FAILED' AND processed_at >= now() - interval '24 hours') AS sync_failed`,
      this.prisma.$queryRaw<{ day: string; total: Count }[]>`
        SELECT to_char((started_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
               count(*) AS total
        FROM trips
        WHERE started_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ day: string; total: Count }[]>`
        SELECT to_char((ended_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
               COALESCE(sum(distance_meters), 0) AS total
        FROM trips
        WHERE status = 'COMPLETED'
          AND ended_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ day: string; requests: Count; errors: Count }[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(requests) AS requests,
               sum(errors) AS errors
        FROM api_usage_daily
        WHERE day >= ${firstDay}::date
        GROUP BY day`,
      this.prisma.$queryRaw<{ day: string; total: Count }[]>`
        SELECT to_char((created_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
               count(*) AS total
        FROM platform_events
        WHERE created_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}
          AND type <> ${WEBHOOK_TEST_EVENT}
        GROUP BY 1`,
    ]);

    const row = totals[0];
    const count = (key: string) => num(row[key] as Count);
    const byDay = (rows: { day: string; total: Count }[]) =>
      new Map(rows.map((item) => [item.day, num(item.total)]));
    const tripsByDay = byDay(trips);
    const distanceByDay = byDay(distances);
    const eventsByDay = byDay(events);
    const usageByDay = new Map(usage.map((item) => [item.day, item]));

    return {
      generatedAt: now,
      timeZone: tz,
      accounts: {
        people: count('people'),
        active: count('people_active'),
        administrators: count('administrators'),
        operators: count('operators'),
        serviceAccounts: count('service_accounts'),
        newLast7Days: count('new_users'),
        signedInLast24h: count('signed_in'),
      },
      devices: { total: count('devices'), seenLast24h: count('devices_seen') },
      trips: {
        active: count('trips_active'),
        startedToday: count('trips_started'),
        completedToday: count('trips_completed'),
        distanceTodayMeters: Math.round(count('distance_today')),
      },
      tracking: {
        fixesLastHour: count('fixes_last_hour'),
        lastFixAt: (row.last_fix_at as Date | null) ?? null,
      },
      geodata: {
        geofences: count('geofences'),
        activeGeofences: count('geofences_active'),
        sharedPlaces: count('places_shared'),
        privatePlaces: count('places_private'),
        savedRoutes: count('routes'),
      },
      regions: {
        total: count('regions'),
        enabled: count('regions_enabled'),
        devicesWithRegions: count('devices_with_regions'),
      },
      integrations: {
        total: count('integrations'),
        active: count('integrations_active'),
        requestsToday: count('requests_today'),
        errorsToday: count('errors_today'),
      },
      webhooks: {
        endpoints: count('endpoints'),
        active: count('endpoints_active'),
        failing: count('endpoints_failing'),
        pending: count('deliveries_pending'),
        failedLast24h: count('deliveries_failed'),
        oldestPendingAt: (row.oldest_pending_at as Date | null) ?? null,
      },
      sync: { operationsLast24h: count('sync_operations'), failedLast24h: count('sync_failed') },
      series: days.map((day) => ({
        day,
        tripsStarted: tripsByDay.get(day) ?? 0,
        distanceMeters: Math.round(distanceByDay.get(day) ?? 0),
        apiRequests: num(usageByDay.get(day)?.requests ?? 0),
        apiErrors: num(usageByDay.get(day)?.errors ?? 0),
        events: eventsByDay.get(day) ?? 0,
      })),
    };
  }

  async meta(current: AuthenticatedUser): Promise<AdminMeta> {
    const user = await this.users.getById(current.id);
    const webhooks = this.config.get('integrations').webhooks;
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      timeZone: this.timeZone,
      roles: Object.values(UserRole),
      scopes: API_SCOPES,
      eventTypes: PLATFORM_EVENT_TYPES,
      testEventType: WEBHOOK_TEST_EVENT,
      tripStatuses: Object.values(TripStatus),
      routingProfiles: Object.values(RoutingProfile),
      devicePlatforms: Object.values(DevicePlatform),
      syncStatuses: Object.values(SyncEventStatus),
      deliveryStatuses: Object.values(WebhookDeliveryStatus),
      integrations: {
        defaultRateLimitPerMinute: DEFAULT_RATE_LIMIT_PER_MINUTE,
        maxRateLimitPerMinute: MAX_RATE_LIMIT_PER_MINUTE,
      },
      webhooks: {
        allowInsecure: webhooks.allowInsecure,
        allowPrivateNetworks: webhooks.allowPrivateNetworks,
        timeoutMs: webhooks.timeoutMs,
        maxAttempts: MAX_ATTEMPTS,
        retryDelaysMs: RETRY_DELAYS_MS,
      },
      eventsRetentionDays: this.config.get('integrations').eventsRetentionDays,
    };
  }

  /** The last `count` days in the platform time zone, oldest first (YYYY-MM-DD). */
  private lastDays(now: Date, count: number): string[] {
    const end = Date.parse(`${this.dayFormat.format(now)}T00:00:00Z`);
    return Array.from({ length: count }, (_, index) =>
      new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
    );
  }
}
