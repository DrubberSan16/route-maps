import {
  fetchJson,
  UpstreamHttpError,
  UpstreamUnavailableError,
} from '../../../infrastructure/http/fetch-json';
import {
  GeocodingProvider,
  GeocodingResult,
  GeocodingSearchQuery,
  GeocodingUnavailableError,
} from '../domain/geocoding-provider';

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  category?: string;
  type?: string;
  boundingbox?: [string, string, string, string];
  address?: NominatimAddress;
  error?: string;
}

export interface NominatimConfig {
  baseUrl: string;
  timeoutMs: number;
  defaultCountryCodes?: string;
}

/** Adapter for a self-hosted Nominatim instance (jsonv2 API). */
export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = 'nominatim';
  readonly enabled = true;

  constructor(private readonly config: NominatimConfig) {}

  async search(query: GeocodingSearchQuery): Promise<GeocodingResult[]> {
    const params = new URLSearchParams({
      q: query.text,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(query.limit),
    });
    const countries = query.countryCodes?.length
      ? query.countryCodes.join(',')
      : this.config.defaultCountryCodes;
    if (countries) params.set('countrycodes', countries.toLowerCase());
    if (query.language) params.set('accept-language', query.language);
    if (query.near) {
      // ~50 km viewbox around the bias point; bounded=0 keeps it a preference.
      const d = 0.45;
      const { latitude, longitude } = query.near;
      params.set(
        'viewbox',
        [longitude - d, latitude + d, longitude + d, latitude - d]
          .map((v) => v.toFixed(5))
          .join(','),
      );
    }
    const places = await this.get<NominatimPlace[]>(`/search?${params.toString()}`);
    return places.map((place) => this.toResult(place));
  }

  async reverse(
    latitude: number,
    longitude: number,
    language?: string,
  ): Promise<GeocodingResult | null> {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      addressdetails: '1',
    });
    if (language) params.set('accept-language', language);
    const place = await this.get<NominatimPlace>(`/reverse?${params.toString()}`);
    if (!place || place.error) return null;
    return this.toResult(place);
  }

  async health(): Promise<'up' | 'down'> {
    try {
      const status = await fetchJson<{ status: number }>(`${this.baseUrl}/status?format=json`, {
        timeoutMs: 3000,
      });
      return status.status === 0 ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  toResult(place: NominatimPlace): GeocodingResult {
    const address = place.address ?? {};
    const bbox = place.boundingbox?.map(Number);
    return {
      displayName: place.display_name,
      name: place.name?.trim() ? place.name : null,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      category: place.category ?? null,
      type: place.type ?? null,
      address: {
        road: address.road ?? address.pedestrian,
        houseNumber: address.house_number,
        neighbourhood: address.neighbourhood,
        suburb: address.suburb,
        city: address.city ?? address.town ?? address.village,
        state: address.state,
        postcode: address.postcode,
        country: address.country,
        countryCode: address.country_code?.toUpperCase(),
      },
      // Nominatim bbox order is [minLat, maxLat, minLon, maxLon].
      bbox: bbox && bbox.length === 4 ? [bbox[2], bbox[0], bbox[3], bbox[1]] : null,
      sourceId:
        place.osm_type && place.osm_id !== undefined
          ? `osm:${place.osm_type}:${place.osm_id}`
          : null,
    };
  }

  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  private async get<T>(path: string): Promise<T> {
    try {
      return await fetchJson<T>(`${this.baseUrl}${path}`, { timeoutMs: this.config.timeoutMs });
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.status < 500 && error.status !== 429) {
        throw new GeocodingUnavailableError(`Nominatim rejected the request (${error.status})`, {
          cause: error,
        });
      }
      if (error instanceof UpstreamHttpError || error instanceof UpstreamUnavailableError) {
        throw new GeocodingUnavailableError('Nominatim is unavailable', { cause: error });
      }
      throw error;
    }
  }
}
