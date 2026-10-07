/**
 * Permissions an integration's API key can have. Public endpoints (maps, regions, routing,
 * geocoding, traffic) accept any valid key; the rest of what an account owns needs a scope.
 */
export const API_SCOPES = [
  'trips:read',
  'trips:write',
  'geofences:read',
  'geofences:write',
  'places:read',
  'places:write',
  'routes:read',
  'routes:write',
  'events:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];
