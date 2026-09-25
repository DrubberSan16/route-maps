/**
 * Cache port. Implementations must be fail-soft: a cache outage must never
 * break a request, only make it slower. Redis is never the source of truth.
 */
export interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Returns 'up' | 'down' | 'disabled' for health reporting. */
  status(): Promise<'up' | 'down' | 'disabled'>;
}

export const CACHE_PROVIDER = Symbol('CACHE_PROVIDER');
