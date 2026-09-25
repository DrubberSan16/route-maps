import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppConfigService } from '../../../config/app-config.service';
import { CACHE_PROVIDER, type CacheProvider } from '../../../infrastructure/cache/cache.provider';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
  GeocodingResult,
  GeocodingSearchQuery,
  GeocodingUnavailableError,
} from '../domain/geocoding-provider';

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(
    @Inject(GEOCODING_PROVIDER) private readonly provider: GeocodingProvider,
    @Inject(CACHE_PROVIDER) private readonly cache: CacheProvider,
    private readonly config: AppConfigService,
  ) {}

  async search(query: GeocodingSearchQuery): Promise<GeocodingResult[]> {
    const normalized = { ...query, text: query.text.trim().replace(/\s+/g, ' ') };
    return this.cached('search', normalized, () => this.provider.search(normalized));
  }

  async reverse(
    latitude: number,
    longitude: number,
    language?: string,
  ): Promise<GeocodingResult | null> {
    // ~1 m precision is enough to share cache entries between nearby taps.
    const lat = Number(latitude.toFixed(5));
    const lng = Number(longitude.toFixed(5));
    return this.cached('reverse', { lat, lng, language }, () =>
      this.provider.reverse(lat, lng, language),
    );
  }

  private async cached<T>(kind: string, key: unknown, load: () => Promise<T>): Promise<T> {
    const cacheKey = `geocode:v1:${kind}:${createHash('sha1')
      .update(JSON.stringify(key))
      .digest('hex')}`;
    const hit = await this.cache.get<T>(cacheKey);
    if (hit !== undefined) return hit;
    try {
      const value = await load();
      await this.cache.set(cacheKey, value, this.config.get('geocoding').cacheTtlSeconds);
      return value;
    } catch (error) {
      if (error instanceof GeocodingUnavailableError) {
        if (this.provider.enabled) this.logger.warn({ err: error }, 'Geocoding provider failed');
        throw AppException.unavailable(
          ErrorCode.GEOCODING_PROVIDER_UNAVAILABLE,
          error.message,
          error,
        );
      }
      throw error;
    }
  }
}
