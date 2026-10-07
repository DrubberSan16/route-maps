import { UserRole } from '../../generated/prisma/enums';
import type { ApiKeyPrincipal } from '../auth/auth-ports';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  /** Present when the request came with an integration's API key (it acts as account `id`). */
  apiKey?: ApiKeyPrincipal;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access';
  /**
   * Session version: when the account's sessions were last closed (ms since epoch, 0 if never).
   * Tokens issued before a later "close sessions" are refused. Absent in tokens of older releases.
   */
  sv?: number;
}
