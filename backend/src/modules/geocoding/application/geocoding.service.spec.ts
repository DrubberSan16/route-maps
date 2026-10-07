import { AppConfigService } from '../../../config/app-config.service';
import { CacheProvider } from '../../../infrastructure/cache/cache.provider';
import { GeocodingProvider, GeocodingResult } from '../domain/geocoding-provider';
import { GeocodingService } from './geocoding.service';

const lima: GeocodingResult = {
  displayName: 'Lima, Perú',
  name: 'Lima',
  latitude: -12.046,
  longitude: -77.043,
  category: 'place',
  type: 'capital',
  address: {},
  bbox: null,
  sourceId: null,
};

describe('GeocodingService', () => {
  const config = { get: () => ({ cacheTtlSeconds: 86400 }) } as unknown as AppConfigService;
  let cache: jest.Mocked<CacheProvider>;
  let provider: { -readonly [K in keyof GeocodingProvider]: GeocodingProvider[K] };

  beforeEach(() => {
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
      status: jest.fn(),
    };
    provider = {
      name: 'nominatim',
      enabled: true,
      degraded: false,
      search: jest.fn().mockResolvedValue([lima]),
      reverse: jest.fn(),
      health: jest.fn(),
    };
  });

  it('caches complete answers', async () => {
    const service = new GeocodingService(provider, cache, config);

    await expect(service.search({ text: '  Lima ', limit: 5 })).resolves.toEqual([lima]);
    expect(provider.search).toHaveBeenCalledWith({ text: 'Lima', limit: 5 });
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^geocode:v2:search:/),
      [lima],
      86400,
    );
  });

  it('keys the cache by the version of the data behind the answers', async () => {
    let version = 'index-1';
    provider.dataVersion = () => Promise.resolve(version);
    const service = new GeocodingService(provider, cache, config);

    await service.search({ text: 'Lima', limit: 5 });
    version = 'index-2';
    await service.search({ text: 'Lima', limit: 5 });

    const [first, second] = cache.set.mock.calls.map(([key]) => key);
    expect(first).not.toBe(second);
  });

  it('does not cache partial answers while a source is down', async () => {
    provider.degraded = true;
    const service = new GeocodingService(provider, cache, config);

    await expect(service.search({ text: 'Lima', limit: 5 })).resolves.toEqual([lima]);
    expect(cache.set).not.toHaveBeenCalled();
  });
});
