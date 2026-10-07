/**
 * Events integrations receive (webhooks, `GET /events`) and the administration panel lists.
 * Account events go to that account's integrations and to those that receive every account's
 * events (event scope ALL_ACCOUNTS); region events (accountId null) go to all.
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

/** The account an event is about, as integrations see it. */
export interface EventAccount {
  id: string;
  email: string;
  name: string;
}

/** Prisma `select` of the account of an event (`include: { account: { select } }`). */
export const EVENT_ACCOUNT_SELECT = { id: true, email: true, name: true } as const;

/** An event as integrations receive it (webhook body, `GET /events`). */
export interface PlatformEventView {
  id: string;
  /** Increasing position (a decimal string): the cursor of `GET /events?after=`. */
  seq: string;
  type: string;
  accountId: string | null;
  /** Who the event is about; null for platform events (regions). */
  account: EventAccount | null;
  createdAt: Date;
  data: unknown;
}

export const toEventView = (row: {
  id: string;
  seq: bigint;
  type: string;
  accountId: string | null;
  account: EventAccount | null;
  createdAt: Date;
  data: unknown;
}): PlatformEventView => ({
  id: row.id,
  seq: row.seq.toString(),
  type: row.type,
  accountId: row.accountId,
  account: row.account && { id: row.account.id, email: row.account.email, name: row.account.name },
  createdAt: row.createdAt,
  data: row.data,
});
