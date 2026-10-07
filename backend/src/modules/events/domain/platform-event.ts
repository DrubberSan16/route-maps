/**
 * Events integrations receive (webhooks, `GET /events`) and the administration panel lists.
 * Account events go to that account's integrations; region events (accountId null) to all.
 */
export const PLATFORM_EVENT_TYPES = [
  'trip.started',
  'trip.finished',
  'trip.cancelled',
  'geofence.entered',
  'geofence.exited',
  'region.published',
  'region.disabled',
] as const;

export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number];

/** Sent only to one endpoint, by the "send test" action of the panel. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

/** Subscription to every event type, present and future. */
export const ALL_EVENTS = '*';

export interface PlatformEventInput {
  type: PlatformEventType;
  /** Account the event is about; null for platform events (regions). */
  accountId: string | null;
  data: Record<string, unknown>;
}

/** An event as integrations receive it (webhook body, `GET /events`). */
export interface PlatformEventView {
  id: string;
  /** Increasing position (a decimal string): the cursor of `GET /events?after=`. */
  seq: string;
  type: string;
  accountId: string | null;
  createdAt: Date;
  data: unknown;
}

export const toEventView = (row: {
  id: string;
  seq: bigint;
  type: string;
  accountId: string | null;
  createdAt: Date;
  data: unknown;
}): PlatformEventView => ({
  id: row.id,
  seq: row.seq.toString(),
  type: row.type,
  accountId: row.accountId,
  createdAt: row.createdAt,
  data: row.data,
});
