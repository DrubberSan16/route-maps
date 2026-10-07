import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import type { ApiScope } from '../auth/api-scopes';

export const API_SCOPES_KEY = 'apiScopes';

/**
 * Lets integrations call a route with an API key that has every listed scope. Routes without it
 * refuse API keys (administration, sessions, synchronization), except public routes, where a key
 * only identifies the integration for its quota. `@ApiScopes()` with no scope accepts any key.
 */
export const ApiScopes = (...scopes: ApiScope[]) =>
  applyDecorators(SetMetadata(API_SCOPES_KEY, scopes), ApiSecurity('api-key'));
