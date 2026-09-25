import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { CacheProvider } from './cache.provider';

/**
 * Redis-backed cache. Commands fail fast (no offline queue, one retry) and
 * any error is logged and treated as a cache miss so the API keeps working
 * while Redis is unavailable.
 */
@Injectable()
export class RedisCacheProvider implements CacheProvider, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheProvider.name);
  private readonly client?: Redis;
  private lastErrorLog = 0;

  constructor(config: AppConfigService) {
    const redis = config.get('redis');
    if (!redis.enabled) {
      this.logger.warn('Redis cache disabled (REDIS_ENABLED=false)');
      return;
    }
    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      keyPrefix: redis.keyPrefix,
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 10000),
    });
    this.client.on('error', (error: Error) => this.logError('Redis connection error', error));
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.isReady()) return undefined;
    try {
      const raw = await this.client!.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.logError(`Cache get failed for ${key}`, error);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.isReady() || ttlSeconds <= 0) return;
    try {
      await this.client!.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logError(`Cache set failed for ${key}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isReady()) return;
    try {
      await this.client!.del(key);
    } catch (error) {
      this.logError(`Cache delete failed for ${key}`, error);
    }
  }

  async status(): Promise<'up' | 'down' | 'disabled'> {
    if (!this.client) return 'disabled';
    if (!this.isReady()) return 'down';
    try {
      return (await this.client.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => this.client?.disconnect());
  }

  private isReady(): boolean {
    return this.client?.status === 'ready';
  }

  /** Rate-limited error logging so an outage does not flood the logs. */
  private logError(message: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 30000) return;
    this.lastErrorLog = now;
    this.logger.warn({ err: error }, `${message}; continuing without cache`);
  }
}
