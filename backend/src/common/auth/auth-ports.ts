import { UserRole } from '../../generated/prisma/enums';

/**
 * What the authentication guard needs to know about an account on every request. Read from the
 * database and kept for a few seconds, so disabling an account, closing its sessions or changing
 * its role takes effect without waiting for its access tokens to expire.
 */
export interface AccountAccess {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  serviceAccount: boolean;
  /** Access tokens issued before this instant (ms since epoch) are refused. */
  sessionsRevokedAt: number | null;
}

export interface AccountAccessReader {
  get(userId: string): Promise<AccountAccess | null>;
  /** Forgets the cached state of an account after it changed. */
  invalidate(userId: string): void;
}

export const ACCOUNT_ACCESS = Symbol('ACCOUNT_ACCESS');

/** Integration and permissions of a request authenticated with an API key. */
export interface ApiKeyPrincipal {
  keyId: string;
  integrationId: string;
  integrationName: string;
  /** Account the integration acts as. */
  userId: string;
  userEmail: string;
  scopes: string[];
  /** Requests per minute shared by every key of the integration. */
  rateLimitPerMinute: number;
}

export interface ApiKeyAuthenticator {
  /** Resolves a presented key, or throws INVALID_API_KEY (401). */
  authenticate(rawKey: string): Promise<ApiKeyPrincipal>;
  /** Counts the request towards the key's usage once its response is sent. */
  track(principal: ApiKeyPrincipal, ip: string | undefined, response: ResponseLike): void;
}

/** The part of the HTTP response the usage counter listens to. */
export interface ResponseLike {
  statusCode: number;
  once(event: 'finish', listener: () => void): unknown;
}

export const API_KEY_AUTHENTICATOR = Symbol('API_KEY_AUTHENTICATOR');
