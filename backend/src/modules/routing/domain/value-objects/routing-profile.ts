/** Transport profiles exposed by our API (independent from any routing engine). */
export const ROUTING_PROFILES = ['CAR', 'TRUCK', 'MOTORCYCLE', 'BICYCLE', 'PEDESTRIAN'] as const;

export type RoutingProfile = (typeof ROUTING_PROFILES)[number];

export const isRoutingProfile = (value: unknown): value is RoutingProfile =>
  typeof value === 'string' && (ROUTING_PROFILES as readonly string[]).includes(value);
